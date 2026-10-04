"""Default long-term-memory Store for production wiring.

Regression (2026-10-04): the module-level graph was built with ``store=None``
on the assumption that the serving platform injects a store. agentseek dev
does not: ``get_store()`` returns ``None`` (it merely reads
``runtime.store``), and ``StoreBackend.download_files`` then crashes with
``AttributeError("'NoneType' object has no attribute 'get'")`` inside
``MemoryMiddleware.before_agent`` — on every run, before the model call.
Production wiring therefore passes an explicit store (see ``default_store``).

Why the dual-mode adapter: StoreBackend reaches the store through both sync
paths (``before_agent`` → ``download_files``) and async paths (file tools
under an async runtime → ``aget``/``asearch``/``aput``). Upstream
``SqliteStore`` only serves sync (async raises ``NotImplementedError``) while
``AsyncSqliteStore`` requires a running event loop at construction time — so
neither can serve both from one build-time instance. ``DualModeSqliteStore``
keeps one sync ``SqliteStore`` over a persistent file and delegates the async
surface to worker threads.
"""

import asyncio
import os
import sqlite3
import threading
from pathlib import Path

from langgraph.store.base import BaseStore, Op, Result
from langgraph.store.memory import InMemoryStore
from langgraph.store.sqlite import SqliteStore

def _default_path() -> Path:
    """Resolve at call time (not import) so tests can monkeypatch the env."""
    return Path(
        os.getenv(
            "AGENTSEEK_STORE_PATH",
            "~/.agentseek/research_deepagent/store.db",
        )
    ).expanduser()


class DualModeSqliteStore(BaseStore):
    """A single persistent store serving both sync and async StoreBackend paths.

    All operations funnel through ``batch``/``abatch`` (the BaseStore core);
    ``abatch`` delegates the sync sqlite store to a worker thread. A lock
    serializes access because one ``sqlite3.Connection`` is shared across the
    caller thread and ``asyncio.to_thread``'s pool.
    """

    def __init__(self, path: str | Path) -> None:
        super().__init__()
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(
            str(self._path), check_same_thread=False, isolation_level=None
        )
        self._store = SqliteStore(self._conn)
        self._lock = threading.Lock()

    def setup(self) -> None:
        """Create the store tables (idempotent)."""
        self._store.setup()

    def batch(self, ops: list[Op]) -> list[Result]:
        with self._lock:
            return self._store.batch(ops)

    async def abatch(self, ops: list[Op]) -> list[Result]:
        return await asyncio.to_thread(self.batch, ops)


def default_store(path: str | Path | None = None) -> BaseStore:
    """Build the production default store.

    ``AGENTSEEK_STORE=memory`` switches to ``InMemoryStore`` (non-persistent,
    for tests/ephemeral runs). The default is a persistent dual-mode sqlite
    store so long-term memory survives server restarts without any external
    infrastructure; PostgresStore remains the multi-node upgrade path.
    """
    if os.getenv("AGENTSEEK_STORE", "sqlite").lower() == "memory":
        return InMemoryStore()
    return DualModeSqliteStore(path or _default_path())
