import pytest

import research_deepagent.mcp_tools as mcp_tools
from research_deepagent.mcp_tools import load_pencli_tools, run_coro_sync


def test_run_coro_sync_outside_loop():
    async def add():
        return 1 + 1

    assert run_coro_sync(add()) == 2


def test_run_coro_sync_inside_loop():
    import asyncio

    async def add():
        return 1 + 1

    async def in_loop():
        # simulate being called from inside a running event loop's thread
        return await asyncio.to_thread(run_coro_sync, add())

    assert asyncio.run(in_loop()) == 2


def test_no_url_returns_empty(monkeypatch):
    monkeypatch.setattr(mcp_tools, "PENCLI_MCP_URL", "")
    assert load_pencli_tools() == []


class FakeRemoteTool:
    def __init__(self, name):
        self.name = name
        self.description = "fake tool"

    async def coroutine(self, **kwargs):
        return f"called {self.name} {kwargs}"


def test_load_wraps_remote_tools(monkeypatch):
    monkeypatch.setattr(mcp_tools, "PENCLI_MCP_URL", "http://127.0.0.1:9/mcp")

    async def fake_discover(transport):
        return [FakeRemoteTool("draw")]

    monkeypatch.setattr(mcp_tools, "_discover_tools", fake_discover)
    tools = load_pencli_tools()
    assert [t.name for t in tools] == ["pencli_draw"]
    # sync invocation path works
    assert tools[0].invoke({}) == "called draw {}"


def test_unreachable_returns_empty(monkeypatch):
    monkeypatch.setattr(mcp_tools, "PENCLI_MCP_URL", "http://127.0.0.1:9/mcp")

    async def boom(transport):
        raise ConnectionError("down")

    monkeypatch.setattr(mcp_tools, "_discover_tools", boom)
    assert load_pencli_tools() == []
