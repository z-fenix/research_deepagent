# Task 1 Brief: 项目基建（git、pytest、工作区目录约定）

> 以下为实现计划中 Task 1 的完整原文，逐字遵守。执行环境为 WSL Ubuntu-24.04，工作目录 `/home/zhang/workplace/research_deepagent`。从 Windows Git Bash 调用 WSL 的命令模板：`wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "<cmd>"`；在 WSL 内部直接执行的命令直接写。

**Files:**
- Modify: `.gitignore`（追加一行）
- Modify: `pyproject.toml`（dev 依赖 pytest）
- Create: `tests/__init__.py`、`tests/test_scaffold.py`

**Interfaces:**
- Produces: `uv run pytest` 可用的测试基座；后续任务的测试文件都放 `tests/`。

**Step 1: 初始化 git 并提交当前基线**

```bash
cd /home/zhang/workplace/research_deepagent
git init
git add -A && git commit -m "chore: baseline before prd-bdd-sdd rework"
```

**Step 2: .gitignore 追加 workspace 目录**

在 `.gitignore` 的 `# Env` 段之前追加：

```gitignore
# Generated documents (per-project workspaces)
workspace/
```

**Step 3: 添加 pytest dev 依赖**

```bash
uv add --dev pytest
```

**Step 4: 写冒烟测试**

`tests/__init__.py` 为空文件。`tests/test_scaffold.py`：

```python
def test_pytest_runs():
    assert True
```

**Step 5: 运行测试**

```bash
uv run pytest -q
```

Expected: `1 passed`

**Step 6: Commit**

```bash
git add .gitignore pyproject.toml uv.lock tests/
git commit -m "chore: init git, add pytest dev dependency and tests scaffold"
```
