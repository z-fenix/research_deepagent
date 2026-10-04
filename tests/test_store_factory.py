"""默认长期记忆 Store 的工厂与双模式适配器验证。

回归背景（2026-10-04 生产事故）：生产模块级 graph 以 store=None 构建，
假设 agentseek 平台注入 store；实际 runtime.store 为 None 时
StoreBackend.download_files 的 ``store.get`` 抛
AttributeError("'NoneType' object has no attribute 'get'")，
MemoryMiddleware 在每次运行开始加载记忆，任何消息都会崩。

契约：
1. 生产接线（不显式传 store）必须开箱可用——不再依赖运行时注入；
2. 默认 store 为本地持久化 Sqlite（跨进程重启保留），可经
   AGENTSEEK_STORE=memory 切回内存模式；
3. 同一实例必须同时服务同步路径（before_agent 的 download_files）与
   异步路径（文件工具的 aget/asearch/aput）——上游 SqliteStore 只支持
   同步，AsyncSqliteStore 构造期要求事件循环，故由适配器补异步委派。
"""

import sqlite3
from pathlib import Path

import pytest

from research_deepagent.store import DualModeSqliteStore, default_store


class TestDefaultStoreFactory:
    def test_default_is_persistent_sqlite(self, tmp_path):
        store = default_store(path=tmp_path / "store.db")
        assert isinstance(store, DualModeSqliteStore)

    def test_sqlite_persists_across_instances(self, tmp_path):
        path = tmp_path / "store.db"
        first = default_store(path=path)
        first.setup()
        first.put(("u", "memories"), "/preferences.md",
                  {"content": "# 偏好", "encoding": "utf-8"})
        # 模拟进程重启：全新实例打开同一文件
        second = default_store(path=path)
        second.setup()
        item = second.get(("u", "memories"), "/preferences.md")
        assert item is not None
        assert "偏好" in item.value["content"]

    def test_memory_mode_env_override(self, tmp_path, monkeypatch):
        from langgraph.store.memory import InMemoryStore

        monkeypatch.setenv("AGENTSEEK_STORE", "memory")
        store = default_store(path=tmp_path / "unused.db")
        assert isinstance(store, InMemoryStore)


class TestDualModeAdapter:
    @pytest.fixture()
    def store(self, tmp_path):
        store = DualModeSqliteStore(tmp_path / "store.db")
        store.setup()
        return store

    def test_serves_sync_and_async_against_same_instance(self, store):
        import asyncio

        store.put(("u", "memories"), "/preferences.md",
                  {"content": "# 偏好\n- 注释用中文", "encoding": "utf-8"})

        async def main():
            got = await store.aget(("u", "memories"), "/preferences.md")
            await store.aput(("u", "memories"), "/other.md",
                             {"content": "x", "encoding": "utf-8"})
            hits = await store.asearch(("u", "memories"), limit=10)
            return got, hits

        got, hits = asyncio.run(main())
        assert got is not None and "注释用中文" in got.value["content"]
        assert len(hits) == 2  # preferences.md + other.md

    def test_sync_search_works(self, store):
        store.put(("u", "memories"), "/a.md", {"content": "a", "encoding": "utf-8"})
        hits = store.search(("u", "memories"), limit=5)
        assert len(hits) == 1

    def test_connection_survives_concurrent_threads(self, tmp_path):
        # to_thread 线程池可能并发进 batch：sqlite 连接须串行化保护
        import threading

        store = DualModeSqliteStore(tmp_path / "store.db")
        store.setup()
        errors: list[Exception] = []

        def worker(i: int) -> None:
            try:
                for j in range(5):
                    store.put((f"ns{i}",), f"/k{j}",
                              {"content": str(j), "encoding": "utf-8"})
            except Exception as e:  # noqa: BLE001
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert errors == []
