"""LangChain tool wrappers around the pure validators.

Paths given by the agent are resolved against DOCS_WORKSPACE_DIR (the
FilesystemBackend root), so the agent can pass its usual relative paths.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from langchain_core.tools import tool

from research_deepagent.validators.traceability import validate_traceability_docs
from research_deepagent.validators.user_stories import validate_user_stories_docs


def resolve_workspace_path(path: str) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    root = Path(os.getenv("DOCS_WORKSPACE_DIR", "./workspace")).resolve()
    return root / candidate


def read_text(path: str) -> str:
    return resolve_workspace_path(path).read_text(encoding="utf-8")


@tool(parse_docstring=True)
def validate_user_stories(prd_path: str, bdd_path: str) -> str:
    """校验 BDD 用户故事是否满足闭合规则，返回结构化违规列表。

    Args:
        prd_path: PRD 文档路径（相对工作区根，如 <slug>/prd/prd.md）。
        bdd_path: BDD 文档路径（相对工作区根，如 <slug>/bdd/user_stories.md）。

    Returns:
        校验结果摘要：通过则 ✅，否则逐条列出 (规则, 位置, 说明)。
    """
    result = validate_user_stories_docs(read_text(prd_path), read_text(bdd_path))
    return result.summary()


@tool(parse_docstring=True)
def validate_traceability(workspace_dir: str) -> str:
    """校验 REQ↔US↔Scenario↔TestCase 四层追溯完整性，返回结构化违规列表。

    Args:
        workspace_dir: 项目工作目录（相对工作区根，如 <slug>）。

    Returns:
        校验结果摘要：通过则 ✅，否则逐条列出 (规则, 位置, 说明)。
    """
    base = resolve_workspace_path(workspace_dir)
    prd_text = (base / "prd" / "prd.md").read_text(encoding="utf-8")
    bdd_text = (base / "bdd" / "user_stories.md").read_text(encoding="utf-8")
    sdd_texts: dict[str, str] = {}
    for sdd_file in sorted((base / "sdd").glob("sdd-*.md")):
        match = re.fullmatch(r"sdd-(US-[a-z0-9]+(?:-[a-z0-9]+)*-\d{3})\.md", sdd_file.name)
        if match:
            sdd_texts[match.group(1)] = sdd_file.read_text(encoding="utf-8")
    trace_path = base / "sdd" / "traceability.md"
    trace_text = trace_path.read_text(encoding="utf-8") if trace_path.exists() else None
    result = validate_traceability_docs(prd_text, bdd_text, sdd_texts, trace_text)
    return result.summary()
