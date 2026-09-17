"""pencli MCP integration.

AgentSeek runs graphs in sync checkpoint mode, so MCP tools must be exposed as
*synchronous* LangChain tools. We discover remote tools once at startup (via
``asyncio.run``) and wrap each as a sync ``StructuredTool``. Each invocation
opens a short-lived streamable-http session — acceptable overhead for the
low-frequency design operations pencli performs; a long-lived background-loop
session is out of scope (YAGNI).

Degradation contract: no ``PENCLI_MCP_URL``, unreachable server, or transport
mismatch → return ``[]`` and log a warning; the pipeline continues without
pencli tools.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading

from langchain_core.tools import BaseTool, StructuredTool

logger = logging.getLogger(__name__)

PENCLI_MCP_URL = os.getenv("PENCLI_MCP_URL", "").strip()
TRANSPORT_CANDIDATES = ("streamable_http", "streamable-http")


def run_coro_sync(coro):
    """Run a coroutine from sync code, even if we're on a loop's thread."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    box: dict = {}

    def _runner():
        try:
            box["value"] = asyncio.run(coro)
        except BaseException as exc:  # noqa: BLE001 - propagate to caller
            box["error"] = exc

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    thread.join()
    if "error" in box:
        raise box["error"]
    return box["value"]


async def _discover_tools(transport: str) -> list[BaseTool]:
    from langchain_mcp_adapters.client import MultiServerMCPClient

    client = MultiServerMCPClient({"pencli": {"url": PENCLI_MCP_URL, "transport": transport}})
    return await client.get_tools()


async def _call_remote(tool_name: str, arguments: dict) -> str:
    for transport in TRANSPORT_CANDIDATES:
        try:
            tools = await _discover_tools(transport)
        except Exception as exc:  # noqa: BLE001 - try next transport
            logger.debug("pencli call via %s failed: %s", transport, exc)
            continue
        for remote in tools:
            if remote.name == tool_name:
                return await remote.coroutine(**arguments)
        raise ValueError(f"pencli tool not found: {tool_name}")
    raise ConnectionError("pencli MCP unreachable")


def load_pencli_tools() -> list[BaseTool]:
    if not PENCLI_MCP_URL:
        logger.warning("PENCLI_MCP_URL not set; running without pencli MCP tools.")
        return []
    for transport in TRANSPORT_CANDIDATES:
        try:
            remote_tools = run_coro_sync(_discover_tools(transport))
        except Exception as exc:  # noqa: BLE001 - degradation path
            logger.warning("pencli MCP connect failed via %s: %s", transport, exc)
            continue
        wrapped: list[BaseTool] = []
        for remote in remote_tools:
            wrapped.append(
                StructuredTool(
                    name=f"pencli_{remote.name}",
                    description=f"[pencli MCP] {remote.description}",
                    args_schema=getattr(remote, "args_schema", None),
                    func=lambda _name=remote.name, **kwargs: run_coro_sync(
                        _call_remote(_name, kwargs)
                    ),
                )
            )
        logger.info("Loaded %d pencli MCP tool(s) via %s", len(wrapped), transport)
        return wrapped
    logger.warning("pencli MCP unavailable; degrading to no pencli tools.")
    return []
