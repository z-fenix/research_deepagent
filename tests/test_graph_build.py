"""Graph assembly smoke tests. Model construction must not require network."""

import os


def test_graph_builds_with_env(monkeypatch, tmp_path):
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    assert agent_module.graph is not None
    assert agent_module.WORKSPACE_ROOT == (tmp_path / "workspace").resolve()
    assert (tmp_path / "workspace").exists()


def test_workspace_root_created(monkeypatch, tmp_path):
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "ws2"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    assert (tmp_path / "ws2").is_dir()
