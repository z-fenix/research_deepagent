# PRD→BDD→SDD 文档生成 Deep Agent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 Research DeepAgent 改造为 PRD→BDD→SDD 文档生成 Deep Agent：编排者 + 三个阶段 subagent、真实磁盘工作区、确定性校验工具、pencli MCP 接入、回合制阶段门禁。

**Architecture:** 单个 `create_deep_agent` 编排者挂 `FilesystemBackend`（文档直接落盘），通过 `task()` 委派 prd-agent / bdd-agent / sdd-agent 三个 subagent；每阶段产出后编排者结束回合等用户确认（门禁），状态记录在 `00_meta/project_state.md`。BDD/SDD 阶段各配一个纯 Python 确定性校验器强制执行闭合规则。

**Tech Stack:** Python 3.12、deepagents 0.5.3、LangGraph（agentseek-api 托管）、langchain-core、langchain-mcp-adapters（streamable-http MCP）、pytest。前端零改动。

**Spec:** `docs/superpowers/specs/2026-09-16-prd-bdd-sdd-deepagent-design.md`

## Global Constraints

- `langgraph.json` 的 graph 符号必须保持 `./src/research_deepagent/agent.py:graph` 不变。
- AgentSeek 运行在 **sync checkpoint 模式**：graph 内不得依赖 async 执行；MCP 工具必须提供同步包装（内部 `asyncio.run`，含事件循环线程内降级）。
- Agent 文件操作通过 `FilesystemBackend(root_dir=WORKSPACE_ROOT)`，`WORKSPACE_ROOT` 来自 `DOCS_WORKSPACE_DIR`（默认 `./workspace`），backend 已阻止路径逃逸，工具不得自行放宽。
- 所有提示词与文档模板用中文书写；REQ ID 格式固定 `REQ-\d{3}`，US ID 格式固定 `US-<epic>-<序号三位>`（epic 为小写字母/数字/连字符），TC ID 格式固定 `TC-\d{3}`。校验器的正则必须与提示词中的模板逐字一致。
- 校验器是纯函数（输入字符串、输出数据类），不碰文件系统；文件读写只在 LangChain 工具包装层做。
- 前端 `frontend/` 目录零改动。
- 环境为 WSL Ubuntu-24.04，所有 python/uv 命令通过 `wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "<cmd>"` 执行。
- 项目目前不是 git 仓库，Task 1 先 `git init`，之后每个任务按模板提交。

---

### Task 1: 项目基建（git、pytest、工作区目录约定）

**Files:**
- Modify: `.gitignore`（追加一行）
- Modify: `pyproject.toml`（dev 依赖 pytest）
- Create: `tests/__init__.py`、`tests/test_scaffold.py`

**Interfaces:**
- Produces: `uv run pytest` 可用的测试基座；后续任务的测试文件都放 `tests/`。

- [ ] **Step 1: 初始化 git 并提交当前基线**

```bash
cd /home/zhang/workplace/research_deepagent
git init
git add -A && git commit -m "chore: baseline before prd-bdd-sdd rework"
```

- [ ] **Step 2: .gitignore 追加 workspace 目录**

在 `.gitignore` 的 `# Env` 段之前追加：

```gitignore
# Generated documents (per-project workspaces)
workspace/
```

- [ ] **Step 3: 添加 pytest dev 依赖**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv add --dev pytest"
```

- [ ] **Step 4: 写冒烟测试**

`tests/__init__.py` 为空文件。`tests/test_scaffold.py`：

```python
def test_pytest_runs():
    assert True
```

- [ ] **Step 5: 运行测试**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest -q"
```

Expected: `1 passed`

- [ ] **Step 6: Commit**

```bash
git add .gitignore pyproject.toml uv.lock tests/
git commit -m "chore: init git, add pytest dev dependency and tests scaffold"
```

---

### Task 2: BDD 文档解析器（`validators/bdd_parser.py`）

**Files:**
- Create: `src/research_deepagent/validators/__init__.py`、`src/research_deepagent/validators/models.py`、`src/research_deepagent/validators/bdd_parser.py`
- Test: `tests/test_bdd_parser.py`

**Interfaces:**
- Produces:
  - `models.py`：`@dataclass Violation(rule: str, story_id: str | None, message: str)`；`@dataclass ValidationResult(violations: list[Violation])` 带 `ok: bool` 属性和 `summary() -> str` 方法。
  - `bdd_parser.py`：`@dataclass Scenario(name: str, tags: list[str], given: bool, when: bool, then: bool)`；`@dataclass Story(story_id: str, covers: list[str], as_a: str | None, i_want: str | None, so_that: str | None, scenarios: list[Scenario], text: str)`；`parse_stories(bdd_text: str) -> list[Story]`；常量 `BRANCH_TAGS`、`FORBIDDEN_WORDS`。

- [ ] **Step 1: 写 models.py（无需测试，纯数据类）**

`src/research_deepagent/validators/__init__.py` 为空。`models.py`：

```python
"""Shared data types for the deterministic document validators."""


from dataclasses import dataclass, field


@dataclass
class Violation:
    rule: str  # "B1".."B7" | "T1".."T6"
    story_id: str | None
    message: str


@dataclass
class ValidationResult:
    violations: list[Violation] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.violations

    def summary(self) -> str:
        if self.ok:
            return "✅ 校验通过，无违规项。"
        lines = [f"❌ 共 {len(self.violations)} 条违规："]
        for v in self.violations:
            loc = f"[{v.story_id}] " if v.story_id else ""
            lines.append(f"- ({v.rule}) {loc}{v.message}")
        return "\n".join(lines)
```

- [ ] **Step 2: 写失败测试**

`tests/test_bdd_parser.py`：

```python
from research_deepagent.validators.bdd_parser import (
    BRANCH_TAGS,
    FORBIDDEN_WORDS,
    parse_stories,
)

SAMPLE = """# 用户故事

## US-auth-001
- **Covers**: REQ-001, REQ-002
- **As a** 注册用户
- **I want** 使用邮箱和密码登录
- **So that** 我能访问我的账户

#### @normal 正确密码登录成功
Given 已存在账户 "user@example.com"
When 我提交正确密码
Then 我看到仪表盘

#### @exception 密码错误登录失败
Given 已存在账户 "user@example.com"
When 我提交错误密码
Then 我看到错误提示 "用户名或密码错误"

#### @alternative 未注册邮箱走注册引导
Given 邮箱 "n@example.com" 未注册
When 我提交登录表单
Then 我被引导到注册页

#### @boundary 密码长度为边界值 64
Given 已存在账户 "b@example.com"
When 我提交长度为 64 的密码
Then 登录成功

## US-auth-002
- **Covers**: REQ-003
- **As a** 注册用户
- **I want** 找回密码
- **So that** 我能重新登录
"""


def test_parses_two_stories():
    stories = parse_stories(SAMPLE)
    assert [s.story_id for s in stories] == ["US-auth-001", "US-auth-002"]


def test_parses_covers_req_ids():
    stories = parse_stories(SAMPLE)
    assert stories[0].covers == ["REQ-001", "REQ-002"]
    assert stories[1].covers == ["REQ-003"]


def test_parses_three_part_story():
    stories = parse_stories(SAMPLE)
    assert stories[0].as_a == "注册用户"
    assert stories[0].i_want == "使用邮箱和密码登录"
    assert stories[0].so_that == "我能访问我的账户"


def test_parses_scenarios_with_tags_and_steps():
    stories = parse_stories(SAMPLE)
    scenarios = stories[0].scenarios
    assert [sc.name for sc in scenarios] == [
        "正确密码登录成功",
        "密码错误登录失败",
        "未注册邮箱走注册引导",
        "密码长度为边界值 64",
    ]
    assert scenarios[0].tags == ["@normal"]
    assert scenarios[0].given and scenarios[0].when and scenarios[0].then
    assert scenarios[1].tags == ["@exception"]


def test_incomplete_story_fields_are_none():
    text = "## US-x-001\n- **Covers**: REQ-001\n"
    story = parse_stories(text)[0]
    assert story.as_a is None and story.i_want is None and story.so_that is None


def test_scenario_without_then():
    text = """## US-x-001
- **Covers**: REQ-001

#### @normal 正常路径
Given 有输入
When 提交
"""
    scenarios = parse_stories(text)[0].scenarios
    assert scenarios[0].given and scenarios[0].when and not scenarios[0].then


def test_constants():
    assert set(BRANCH_TAGS) == {"@normal", "@alternative", "@exception", "@boundary"}
    assert "TBD" in FORBIDDEN_WORDS and "等等" in FORBIDDEN_WORDS
```

- [ ] **Step 3: 运行测试确认失败**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest tests/test_bdd_parser.py -v"
```

Expected: FAIL（`ModuleNotFoundError: research_deepagent.validators`）

- [ ] **Step 4: 实现 bdd_parser.py**

```python
"""Parser for ``bdd/user_stories.md``.

The authoritative document format lives in ``prompts.BDD_AGENT_INSTRUCTIONS`` —
keep the regexes here in sync with that template.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

STORY_HEADER_RE = re.compile(r"^##\s+(US-[A-Za-z0-9]+-\d{3})\s*$", re.MULTILINE)
COVERS_RE = re.compile(r"^- \*\*Covers\*\*[：:]\s*(.+)$", re.MULTILINE)
REQ_REF_RE = re.compile(r"REQ-\d{3}")
AS_A_RE = re.compile(r"^- \*\*As a\*\*[：:]\s*(.+)$", re.MULTILINE)
I_WANT_RE = re.compile(r"^- \*\*I want\*\*[：:]\s*(.+)$", re.MULTILINE)
SO_THAT_RE = re.compile(r"^- \*\*So that\*\*[：:]\s*(.+)$", re.MULTILINE)
SCENARIO_RE = re.compile(r"^####\s+((?:@[\w-]+\s+)*)(.+?)\s*$", re.MULTILINE)
STEP_RE = re.compile(r"^(Given|When|Then|And|But)\s", re.MULTILINE)

BRANCH_TAGS = ("@normal", "@alternative", "@exception", "@boundary")
FORBIDDEN_WORDS = ("TBD", "TODO", "待定", "等等", "如有必要", "必要时", "optionally", "视情况")


@dataclass
class Scenario:
    name: str
    tags: list[str] = field(default_factory=list)
    given: bool = False
    when: bool = False
    then: bool = False


@dataclass
class Story:
    story_id: str
    covers: list[str] = field(default_factory=list)
    as_a: str | None = None
    i_want: str | None = None
    so_that: str | None = None
    scenarios: list[Scenario] = field(default_factory=list)
    text: str = ""


def _split_chunks(bdd_text: str) -> list[tuple[str, str]]:
    """Return (story_id, chunk_text) pairs in document order."""
    matches = list(STORY_HEADER_RE.finditer(bdd_text))
    chunks = []
    for idx, match in enumerate(matches):
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(bdd_text)
        chunks.append((match.group(1), bdd_text[match.start():end]))
    return chunks


def parse_stories(bdd_text: str) -> list[Story]:
    stories: list[Story] = []
    for story_id, chunk in _split_chunks(bdd_text):
        covers_match = COVERS_RE.search(chunk)
        scenario_matches = list(SCENARIO_RE.finditer(chunk))
        scenarios: list[Scenario] = []
        for idx, sm in enumerate(scenario_matches):
            block_end = (
                scenario_matches[idx + 1].start()
                if idx + 1 < len(scenario_matches)
                else len(chunk)
            )
            block = chunk[sm.start():block_end]
            steps = STEP_RE.findall(block)
            scenarios.append(
                Scenario(
                    name=sm.group(2).strip(),
                    tags=sm.group(1).split(),
                    given="Given" in steps,
                    when="When" in steps,
                    then="Then" in steps,
                )
            )
        as_a = AS_A_RE.search(chunk)
        i_want = I_WANT_RE.search(chunk)
        so_that = SO_THAT_RE.search(chunk)
        stories.append(
            Story(
                story_id=story_id,
                covers=REQ_REF_RE.findall(covers_match.group(1)) if covers_match else [],
                as_a=as_a.group(1).strip() if as_a else None,
                i_want=i_want.group(1).strip() if i_want else None,
                so_that=so_that.group(1).strip() if so_that else None,
                scenarios=scenarios,
                text=chunk,
            )
        )
    return stories
```

注意：`As a` 模板用 `- **As a**：注册用户`（全角冒号或半角均可，正则 `[：:]` 兼容）。

- [ ] **Step 5: 运行测试确认通过**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest tests/test_bdd_parser.py -v"
```

Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/research_deepagent/validators/ tests/test_bdd_parser.py
git commit -m "feat: BDD user-stories parser with closure-rule primitives"
```

---

### Task 3: PRD 解析器（`validators/prd_parser.py`）

**Files:**
- Create: `src/research_deepagent/validators/prd_parser.py`
- Test: `tests/test_prd_parser.py`

**Interfaces:**
- Consumes: 无（独立纯函数）
- Produces: `parse_requirements(prd_text: str) -> list[str]`（REQ ID 列表）、`parse_glossary(prd_text: str) -> list[str]`（术语名列表）、`find_forbidden_words(text: str) -> list[str]`（命中词列表）。

- [ ] **Step 1: 写失败测试**

```python
from research_deepagent.validators.prd_parser import (
    find_forbidden_words,
    parse_glossary,
    parse_requirements,
)

SAMPLE = """# PRD

## 功能需求

### REQ-001：用户登录
支持邮箱密码登录。

### REQ-002：记住我
登录态保持两周。

### REQ-003：找回密码

## 术语表
- **注册用户**：已完成邮箱验证的账户持有人
- **仪表盘**：登录后的首屏页面

## 未决问题
- TBD：是否支持手机号登录
"""


def test_parse_requirements():
    assert parse_requirements(SAMPLE) == ["REQ-001", "REQ-002", "REQ-003"]


def test_parse_glossary_scoped_to_section():
    terms = parse_glossary(SAMPLE)
    assert "注册用户" in terms and "仪表盘" in terms


def test_glossary_excludes_bold_outside_section():
    text = "## 功能需求\n- **REQ-001**：标题\n\n## 术语表\n- **术语A**：定义\n"
    assert parse_glossary(text) == ["术语A"]


def test_find_forbidden_words():
    assert find_forbidden_words("这里 TBD 一下") == ["TBD"]
    assert find_forbidden_words("干净文本") == []
```

- [ ] **Step 2: 运行测试确认失败**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest tests/test_prd_parser.py -v"
```

Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现 prd_parser.py**

```python
"""Parser for ``prd/prd.md`` requirements and glossary.

The authoritative PRD format lives in ``prompts.PRD_AGENT_INSTRUCTIONS`` —
keep the regexes here in sync with that template.
"""

from __future__ import annotations

import re

from research_deepagent.validators.bdd_parser import FORBIDDEN_WORDS

REQ_HEADING_RE = re.compile(r"^###\s+(REQ-\d{3})\b", re.MULTILINE)
GLOSSARY_HEADING_RE = re.compile(r"^##\s+术语表\s*$", re.MULTILINE)
SECTION_HEADING_RE = re.compile(r"^##\s+", re.MULTILINE)
TERM_RE = re.compile(r"^-\s+\*\*(.+?)\*\*", re.MULTILINE)


def parse_requirements(prd_text: str) -> list[str]:
    return REQ_HEADING_RE.findall(prd_text)


def parse_glossary(prd_text: str) -> list[str]:
    heading = GLOSSARY_HEADING_RE.search(prd_text)
    if heading is None:
        return []
    section_rest = prd_text[heading.end():]
    next_section = SECTION_HEADING_RE.search(section_rest)
    section = section_rest[: next_section.start()] if next_section else section_rest
    return TERM_RE.findall(section)


def find_forbidden_words(text: str) -> list[str]:
    return [w for w in FORBIDDEN_WORDS if re.search(re.escape(w), text, re.IGNORECASE)]
```

- [ ] **Step 4: 运行测试确认通过**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest tests/test_prd_parser.py -v"
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/research_deepagent/validators/prd_parser.py tests/test_prd_parser.py
git commit -m "feat: PRD requirement and glossary parser"
```

---

### Task 4: `validate_user_stories` 校验逻辑 + LangChain 工具

**Files:**
- Create: `src/research_deepagent/validators/user_stories.py`
- Create: `src/research_deepagent/validators/lc_tools.py`（LangChain 工具包装层，命名避开主 `tools.py`）
- Test: `tests/test_user_stories_validator.py`

**Interfaces:**
- Consumes: Task 2 `parse_stories/BRANCH_TAGS/FORBIDDEN_WORDS`、Task 3 `parse_requirements/parse_glossary/find_forbidden_words`、Task 2 `Violation/ValidationResult`
- Produces:
  - `user_stories.py`：`validate_user_stories_docs(prd_text: str, bdd_text: str) -> ValidationResult`
  - `lc_tools.py`：`resolve_workspace_path(path: str) -> Path`、LangChain 工具 `validate_user_stories(prd_path: str, bdd_path: str) -> str`（返回 `summary()` 文本）、`read_text(path: str) -> str` 工具函数（供 Task 5 复用）

- [ ] **Step 1: 写失败测试**

```python
from research_deepagent.validators.user_stories import validate_user_stories_docs

PRD = """# PRD
## 功能需求
### REQ-001：用户登录
### REQ-002：找回密码

## 术语表
- **注册用户**：已完成邮箱验证的账户持有人
"""

GOOD_BDD = """## US-auth-001
- **Covers**: REQ-001
- **As a** 注册用户
- **I want** 登录
- **So that** 访问账户

#### @normal 登录成功
Given 有账户
When 提交正确密码
Then 看到仪表盘

#### @alternative 未注册
Given 无账户
When 提交
Then 引导注册

#### @exception 密码错误
Given 有账户
When 提交错误密码
Then 提示错误

#### @boundary 空密码
Given 登录页
When 密码为空提交
Then 提示必填
"""


def test_valid_bdd_passes():
    result = validate_user_stories_docs(PRD, GOOD_BDD)
    assert result.ok, result.summary()


def test_missing_branch_tag_is_violation():
    bad = GOOD_BDD.replace("#### @boundary 空密码", "#### 空密码").split("## US-auth-002")[0]
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B5" for v in result.violations)


def test_unknown_req_reference():
    bad = GOOD_BDD.replace("- **Covers**: REQ-001", "- **Covers**: REQ-999")
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B2" and "REQ-999" in v.message for v in result.violations)


def test_uncovered_req():
    prd = PRD + "\n### REQ-009：孤儿需求\n"
    result = validate_user_stories_docs(prd, GOOD_BDD)
    assert any(v.rule == "B3" and "REQ-009" in v.message for v in result.violations)


def test_missing_three_part():
    bad = GOOD_BDD.replace("- **So that** 访问账户\n", "")
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B1" for v in result.violations)


def test_missing_gwt():
    bad = GOOD_BDD.replace("Then 看到仪表盘", "")
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B4" for v in result.violations)


def test_role_not_in_glossary():
    bad = GOOD_BDD.replace("- **As a** 注册用户", "- **As a** 管理员")
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B7" for v in result.violations)


def test_forbidden_word():
    bad = GOOD_BDD + "\n此故事 TBD。\n"
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B6" for v in result.violations)
```

- [ ] **Step 2: 运行测试确认失败**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest tests/test_user_stories_validator.py -v"
```

Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现 user_stories.py**

```python
"""Closure rules for BDD user stories, enforced against the PRD.

Rule IDs:
- B1 三段式缺失（As a / I want / So that）
- B2 Covers 缺失或引用不存在的 REQ
- B3 REQ 未被任何 US 覆盖
- B4 场景缺 Given/When/Then 或没有场景
- B5 分支标签不全（@normal/@alternative/@exception/@boundary）
- B6 出现禁止的开放词汇
- B7 "As a" 角色不在 PRD 术语表
"""

from __future__ import annotations

from research_deepagent.validators.bdd_parser import BRANCH_TAGS, parse_stories
from research_deepagent.validators.models import ValidationResult, Violation
from research_deepagent.validators.prd_parser import (
    find_forbidden_words,
    parse_glossary,
    parse_requirements,
)


def validate_user_stories_docs(prd_text: str, bdd_text: str) -> ValidationResult:
    reqs = set(parse_requirements(prd_text))
    glossary = parse_glossary(prd_text)
    stories = parse_stories(bdd_text)
    violations: list[Violation] = []
    covered: set[str] = set()

    if not stories:
        violations.append(Violation("B4", None, "BDD 文档中没有解析到任何用户故事"))

    for story in stories:
        if not (story.as_a and story.i_want and story.so_that):
            violations.append(Violation("B1", story.story_id, "缺少 As a / I want / So that 三段式"))
        if not story.covers:
            violations.append(Violation("B2", story.story_id, "缺少 Covers 需求 ID"))
        for req in story.covers:
            if req not in reqs:
                violations.append(Violation("B2", story.story_id, f"引用了 PRD 中不存在的 {req}"))
            covered.add(req)
        if story.as_a and glossary and not any(term in story.as_a for term in glossary):
            violations.append(
                Violation("B7", story.story_id, f"角色 '{story.as_a}' 不在 PRD 术语表中")
            )
        if not story.scenarios:
            violations.append(Violation("B4", story.story_id, "没有任何 Scenario"))
        tags_seen: set[str] = set()
        for scenario in story.scenarios:
            if not (scenario.given and scenario.when and scenario.then):
                violations.append(
                    Violation("B4", story.story_id, f"场景 '{scenario.name}' 缺少完整的 Given/When/Then")
                )
            tags_seen |= {t for t in scenario.tags if t in BRANCH_TAGS}
        missing_tags = [t for t in BRANCH_TAGS if t not in tags_seen]
        if missing_tags:
            violations.append(
                Violation("B5", story.story_id, f"分支标签缺失: {', '.join(missing_tags)}")
            )
        for word in find_forbidden_words(story.text):
            violations.append(Violation("B6", story.story_id, f"出现开放词汇 '{word}'"))

    for req in sorted(reqs - covered):
        violations.append(Violation("B3", None, f"{req} 未被任何用户故事覆盖"))

    return ValidationResult(violations=violations)
```

- [ ] **Step 4: 运行测试确认通过**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest tests/test_user_stories_validator.py -v"
```

Expected: 全部 PASS

- [ ] **Step 5: 实现 lc_tools.py（LangChain 工具包装）**

```python
"""LangChain tool wrappers around the pure validators.

Paths given by the agent are resolved against DOCS_WORKSPACE_DIR (the
FilesystemBackend root), so the agent can pass its usual relative paths.
"""

from __future__ import annotations

import os
from pathlib import Path

from langchain_core.tools import tool

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
```

- [ ] **Step 6: 快速验证工具包装**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run python -c \"from research_deepagent.validators.lc_tools import validate_user_stories; print(validate_user_stories.name, validate_user_stories.description[:30])\""
```

Expected: `validate_user_stories 校验 BDD 用户故事是否...`

- [ ] **Step 7: Commit**

```bash
git add src/research_deepagent/validators/ tests/test_user_stories_validator.py
git commit -m "feat: user-stories closure validator with LangChain tool wrapper"
```

---

### Task 5: `validate_traceability` 追溯校验 + 工具

**Files:**
- Create: `src/research_deepagent/validators/traceability.py`
- Modify: `src/research_deepagent/validators/lc_tools.py`（追加工具）
- Test: `tests/test_traceability_validator.py`

**Interfaces:**
- Consumes: Task 2 `parse_stories`、Task 3 `parse_requirements`、Task 4 `resolve_workspace_path/read_text`
- Produces:
  - `traceability.py`：`SddRef`（`@dataclass(tc_id: str, scenario_name: str)`）、`validate_traceability_docs(prd_text: str, bdd_text: str, sdd_texts: dict[str, str], trace_text: str | None) -> ValidationResult`（`sdd_texts` 键为 story_id，如 `"US-auth-001"`）
  - `lc_tools.py` 追加：LangChain 工具 `validate_traceability(workspace_dir: str) -> str`

- [ ] **Step 1: 写失败测试**

```python
from research_deepagent.validators.traceability import validate_traceability_docs

PRD = """## 功能需求
### REQ-001：登录
"""

BDD = """## US-auth-001
- **Covers**: REQ-001
- **As a** 注册用户
- **I want** 登录
- **So that** 访问账户

#### @normal 登录成功
Given 有账户
When 提交正确密码
Then 看到仪表盘

#### @exception 密码错误
Given 有账户
When 提交错误密码
Then 提示错误

#### @alternative 未注册
Given 无账户
When 提交
Then 引导注册

#### @boundary 空密码
Given 登录页
When 密码为空
Then 提示必填
"""

GOOD_SDD = {
    "US-auth-001": """# SDD: US-auth-001
## 边界定义
...
### 测试审查定义
- **TC-001** [scenario: @normal 登录成功] type=集成 priority=P0 pass=仪表盘可见
- **TC-002** [scenario: @exception 密码错误] type=单元 priority=P0 pass=提示错误
- **TC-003** [scenario: @alternative 未注册] type=单元 priority=P1 pass=跳转注册页
- **TC-004** [scenario: @boundary 空密码] type=单元 priority=P1 pass=提示必填
""",
}

GOOD_TRACE = """| REQ | US | Scenario | TestCase |
|---|---|---|---|
| REQ-001 | US-auth-001 | @normal 登录成功 | TC-001 |
| REQ-001 | US-auth-001 | @exception 密码错误 | TC-002 |
| REQ-001 | US-auth-001 | @alternative 未注册 | TC-003 |
| REQ-001 | US-auth-001 | @boundary 空密码 | TC-004 |
"""


def test_valid_traceability_passes():
    result = validate_traceability_docs(PRD, BDD, GOOD_SDD, GOOD_TRACE)
    assert result.ok, result.summary()


def test_missing_sdd_file():
    result = validate_traceability_docs(PRD, BDD, {}, GOOD_TRACE)
    assert any(v.rule == "T1" for v in result.violations)


def test_scenario_without_test_case():
    sdd = {"US-auth-001": GOOD_SDD["US-auth-001"].replace("- **TC-002** [scenario: @exception 密码错误] type=单元 priority=P0 pass=提示错误\n", "")}
    result = validate_traceability_docs(PRD, BDD, sdd, GOOD_TRACE)
    assert any(v.rule == "T3" and "密码错误" in v.message for v in result.violations)


def test_orphan_scenario_reference():
    sdd = {
        "US-auth-001": GOOD_SDD["US-auth-001"]
        + "- **TC-009** [scenario: @exception 不存在的场景] type=单元 priority=P2 pass=x\n"
    }
    result = validate_traceability_docs(PRD, BDD, sdd, GOOD_TRACE)
    assert any(v.rule == "T4" for v in result.violations)


def test_trace_row_unknown_story():
    bad_trace = GOOD_TRACE.replace("US-auth-001 | @normal", "US-nope-001 | @normal")
    result = validate_traceability_docs(PRD, BDD, GOOD_SDD, bad_trace)
    assert any(v.rule == "T5" for v in result.violations)


def test_missing_trace_file():
    result = validate_traceability_docs(PRD, BDD, GOOD_SDD, None)
    assert any(v.rule == "T5" for v in result.violations)
```

- [ ] **Step 2: 运行测试确认失败**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest tests/test_traceability_validator.py -v"
```

Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现 traceability.py**

```python
"""REQ↔US↔Scenario↔TestCase four-layer traceability checks.

SDD file naming: ``sdd-<US-id>.md``. Test-case line format (see
``prompts.SDD_AGENT_INSTRUCTIONS``): ``- **TC-001** [scenario: <scenario name>]
type=... priority=... pass=...``. Traceability matrix rows:
``| REQ-001 | US-auth-001 | <scenario name> | TC-001 |``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from research_deepagent.validators.bdd_parser import parse_stories
from research_deepagent.validators.models import ValidationResult, Violation
from research_deepagent.validators.prd_parser import parse_requirements

SDD_STORY_ID_RE = re.compile(r"^(US-[A-Za-z0-9]+-\d{3})$")
TC_RE = re.compile(r"TC-\d{3}")
SCENARIO_REF_RE = re.compile(r"\[scenario:\s*([^\]]+)\]")
TRACE_ROW_RE = re.compile(
    r"^\|\s*(REQ-\d{3})\s*\|\s*(US-[A-Za-z0-9]+-\d{3})\s*\|\s*([^|]+?)\s*\|\s*(TC-\d{3})\s*\|",
    re.MULTILINE,
)


@dataclass
class SddRef:
    tc_id: str
    scenario_name: str


def parse_sdd_text(sdd_text: str) -> list[SddRef]:
    refs: list[SddRef] = []
    for line in sdd_text.splitlines():
        tc = TC_RE.search(line)
        scenario = SCENARIO_REF_RE.search(line)
        if tc and scenario:
            refs.append(SddRef(tc_id=tc.group(0), scenario_name=scenario.group(1).strip()))
    return refs


def validate_traceability_docs(
    prd_text: str,
    bdd_text: str,
    sdd_texts: dict[str, str],
    trace_text: str | None,
) -> ValidationResult:
    violations: list[Violation] = []
    reqs = set(parse_requirements(prd_text))
    stories = parse_stories(bdd_text)
    scenarios_by_story = {
        s.story_id: [sc.name for sc in s.scenarios] for s in stories
    }
    story_ids = set(scenarios_by_story)

    # T1: every US has an SDD file
    for story_id in sorted(story_ids - set(sdd_texts)):
        violations.append(Violation("T1", story_id, "缺少对应的 sdd 文件"))

    sdd_refs = {sid: parse_sdd_text(t) for sid, t in sdd_texts.items()}

    for story_id, refs in sdd_refs.items():
        if story_id not in story_ids:
            violations.append(Violation("T4", story_id, "SDD 文件没有对应的用户故事"))
            continue
        known = set(scenarios_by_story[story_id])
        covered_scenarios: set[str] = set()
        tc_ids: set[str] = set()
        for ref in refs:
            if ref.scenario_name not in known:
                violations.append(
                    Violation(
                        "T4",
                        story_id,
                        f"测试用例 {ref.tc_id} 引用了不存在的场景 '{ref.scenario_name}'",
                    )
                )
            else:
                covered_scenarios.add(ref.scenario_name)
            if ref.tc_id in tc_ids:
                violations.append(
                    Violation("T4", story_id, f"测试用例编号重复: {ref.tc_id}")
                )
            tc_ids.add(ref.tc_id)
        # T3: every scenario has at least one test case
        for name in known - covered_scenarios:
            violations.append(Violation("T3", story_id, f"场景 '{name}' 没有对应测试用例"))

    # T5: traceability matrix exists and its references resolve
    if trace_text is None:
        violations.append(Violation("T5", None, "缺少 sdd/traceability.md 追溯矩阵"))
    else:
        req_covered_by_tc = False
        for req, story_id, scenario_name, tc in TRACE_ROW_RE.findall(trace_text):
            if story_id not in story_ids:
                violations.append(Violation("T5", story_id, f"追溯矩阵引用了不存在的 {story_id}"))
                continue
            if scenario_name not in scenarios_by_story.get(story_id, []):
                violations.append(
                    Violation("T5", story_id, f"追溯矩阵引用了不存在的场景 '{scenario_name}'")
                )
            if tc not in {r.tc_id for r in sdd_refs.get(story_id, [])}:
                violations.append(Violation("T5", story_id, f"追溯矩阵引用了不存在的 {tc}"))
            if req in reqs:
                req_covered_by_tc = True
        for row_req in set(re.findall(r"REQ-\d{3}", trace_text)):
            if row_req not in reqs:
                violations.append(Violation("T5", None, f"追溯矩阵引用了不存在的 {row_req}"))
        # T6: every REQ reaches at least one TestCase through the matrix
        if reqs and not req_covered_by_tc:
            violations.append(Violation("T6", None, "没有任何 REQ 通过追溯矩阵关联到测试用例"))

    return ValidationResult(violations=violations)
```

- [ ] **Step 4: 运行测试确认通过**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest tests/test_traceability_validator.py -v"
```

Expected: 全部 PASS

- [ ] **Step 5: lc_tools.py 追加工具**

在 `lc_tools.py` 末尾追加：

```python
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
        match = re.fullmatch(r"sdd-(US-[A-Za-z0-9]+-\d{3})\.md", sdd_file.name)
        if match:
            sdd_texts[match.group(1)] = sdd_file.read_text(encoding="utf-8")
    trace_path = base / "sdd" / "traceability.md"
    trace_text = trace_path.read_text(encoding="utf-8") if trace_path.exists() else None
    result = validate_traceability_docs(prd_text, bdd_text, sdd_texts, trace_text)
    return result.summary()
```

文件顶部补 `import re`。

- [ ] **Step 6: 全量回归**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest -q"
```

Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add src/research_deepagent/validators/ tests/test_traceability_validator.py
git commit -m "feat: four-layer traceability validator with LangChain tool wrapper"
```

---

### Task 6: pencli MCP 接入（`mcp_tools.py`）

**Files:**
- Create: `src/research_deepagent/mcp_tools.py`
- Modify: `pyproject.toml`（`uv add langchain-mcp-adapters`）
- Test: `tests/test_mcp_tools.py`

**Interfaces:**
- Produces: `load_pencli_tools() -> list[BaseTool]` — 同步函数；`PENCLI_MCP_URL` 未设置或连接失败时返回 `[]` 并记 warning（降级不抛异常）；成功时每个远端工具包装为 `pencli_<name>` 的同步 `StructuredTool`。

- [ ] **Step 1: 添加依赖**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv add langchain-mcp-adapters"
```

- [ ] **Step 2: 写失败测试**

```python
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
```

- [ ] **Step 3: 运行测试确认失败**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest tests/test_mcp_tools.py -v"
```

Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 4: 实现 mcp_tools.py**

```python
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
    from langchain_mcp_adapters.client import MultiServerMCPClient

    for transport in TRANSPORT_CANDIDATES:
        try:
            client = MultiServerMCPClient(
                {"pencli": {"url": PENCLI_MCP_URL, "transport": transport}}
            )
            tools = await client.get_tools()
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
                    args_schema=remote.args_schema,
                    func=lambda **kwargs, _name=remote.name: run_coro_sync(
                        _call_remote(_name, kwargs)
                    ),
                )
            )
        logger.info("Loaded %d pencli MCP tool(s) via %s", len(wrapped), transport)
        return wrapped
    logger.warning("pencli MCP unavailable; degrading to no pencli tools.")
    return []
```

- [ ] **Step 5: 运行测试确认通过**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest tests/test_mcp_tools.py -v"
```

Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/research_deepagent/mcp_tools.py tests/test_mcp_tools.py pyproject.toml uv.lock
git commit -m "feat: pencli MCP integration with sync wrappers and graceful degradation"
```

---

### Task 7: 提示词重写（`prompts.py`）

**Files:**
- Modify: `src/research_deepagent/prompts.py`（整文件替换）

**Interfaces:**
- Produces: 四个常量，Task 8 使用：`ORCHESTRATOR_INSTRUCTIONS`、`PRD_AGENT_INSTRUCTIONS`、`BDD_AGENT_INSTRUCTIONS`、`SDD_AGENT_INSTRUCTIONS`。模板内的 markdown 格式必须与 Task 2–5 的正则逐字一致（`### REQ-001：标题`、`- **Covers**: REQ-001`、`#### @normal 场景名`、`- **TC-001** [scenario: 场景名] type=... priority=... pass=...`、`| REQ-001 | US-auth-001 | 场景名 | TC-001 |`）。

- [ ] **Step 1: 整文件替换 prompts.py**

```python
"""Prompt templates for the PRD→BDD→SDD document-generation deepagent.

The markdown formats embedded in BDD/SDD instructions are parsed by
``research_deepagent.validators`` — keep them in sync with the parser regexes.
"""

ORCHESTRATOR_INSTRUCTIONS = """# PRD→BDD→SDD 文档生成编排者

你是一个文档生成流水线的编排者。你不自己写文档，而是把工作委派给三个专职 sub-agent，
并在每个阶段之间设置人工确认门禁。

## 工作区

所有文件都写在以项目 slug 命名的目录下（slug 由需求标题生成：小写字母/数字/连字符，
如 `login-redesign`）。目录结构：

```
<slug>/
  00_meta/project_state.md      # 阶段状态（必须首先创建/读取）
  prd/brainstorm.md             # 头脑风暴记录
  prd/prd.md                    # 正式 PRD
  bdd/user_stories.md           # 用户故事
  sdd/sdd-US-xxx.md             # 每个用户故事一份
  sdd/traceability.md           # 追溯矩阵
```

## project_state.md 格式（严格遵守）

```markdown
# Project State
slug: <slug>
title: <需求标题>
phase: prd | bdd | sdd | done
gate: awaiting | approved | revise

## Gate Log
- <日期> <阶段>: <事件描述>
```

## 流程

1. **开场**：收到新需求时，先检查是否已有 `project_state.md`（列目录找同 slug 目录）。
   - 不存在 → 创建目录与 `project_state.md`（phase=prd, gate=awaiting），写 todos
     （PRD / BDD / SDD 三项），委派 prd-agent。
   - 已存在 → 读取它恢复现场：phase 指示下一步；gate=revise 时把用户的修改意见
     传给对应阶段重新执行；gate=approved 时推进到下一阶段。
2. **阶段产出后（门禁）**：向用户汇报该阶段的核心产出摘要（PRD 摘要方向与需求列表、
   BDD 摘要故事与场景数量、SDD 摘要覆盖情况），更新 `project_state.md`
   （gate=awaiting），**然后结束回合等待用户回复**。绝不在未获用户明确确认时
   自行推进到下一阶段。
3. **用户回复后**：
   - 确认/同意 → gate=approved，写 Gate Log，委派下一阶段 sub-agent。
   - 修改意见 → gate=revise，把意见原文传给当前阶段 sub-agent 修订，修订完成
     后再次回到门禁。
4. **SDD 完成**：更新 phase=done，输出全部文档路径清单，结束。

## 汇报要求

- 用中文汇报。
- 摘要要具体：列出关键条目（需求 ID、故事 ID、场景数、校验结果），不要空话。
- 校验器报错且 sub-agent 无法修复时，如实向用户展示违规清单并请求人工裁决。
"""

PRD_AGENT_INSTRUCTIONS = """# PRD Agent：头脑风暴驱动的产品需求文档

你负责一个项目的 PRD 阶段。项目目录为 `<slug>/`（由委派消息给出），所有文件写在该目录下。

## 第一步：头脑风暴（发散）

围绕用户需求生成 **至少 3 个**候选产品方向，每个方向包含：目标用户、核心价值、
差异化点、主要风险。把完整思考写入 `prd/brainstorm.md`：

```markdown
# 头脑风暴：<需求标题>

## 需求理解
<用户需求的复述与关键假设>

## 候选方向
### 方向 A：<名称>
- 目标用户：...
- 核心价值：...
- 差异化点：...
- 主要风险：...

### 方向 B：...（同上）

### 方向 C：...（同上）

## 调研发现
<可选：用 tavily_search 检索的市场/竞品信息，注明来源 URL；用 pencli 工具生成的设计产出也记录在此>

## 取舍与结论
<选定方向及理由；被放弃方向的放弃原因>
```

需要市场/竞品佐证时使用 `tavily_search`（2-3 次检索即可，不要过度搜索）。
`pencli_*` 工具是设计类 MCP 工具，能辅助设计产出时使用；工具不可用时直接跳过并在
brainstorm.md 中注明。

## 第二步：撰写正式 PRD（收敛）

选定方向后写 `prd/prd.md`，结构固定如下（格式被校验器解析，**必须逐字遵守**）：

```markdown
# PRD：<产品名>

## 背景与目标
<段落>

## 用户画像
<段落或列表>

## 范围
- In scope：...
- Out of scope：...

## 功能需求

### REQ-001：<需求标题>
- 优先级：P0|P1|P2
- 描述：<一句话>
- 验收要点：<可检验的要点>

### REQ-002：<需求标题>
...

## 非功能需求
<列表>

## 术语表
- **注册用户**：已完成邮箱验证的账户持有人
- **仪表盘**：登录后的首屏页面
<所有 BDD 阶段会用到的实体与角色都必须在此定义>

## 未决问题
<列表，可为空>
```

**硬性要求**：
- 每条功能需求的标题行必须是 `### REQ-<三位数字>：<标题>`，编号从 REQ-001 连续递增。
- 术语表使用 `## 术语表` 标题，每条 `- **术语**：定义`。
- 用户故事的角色（"As a" 的主语）必须是术语表中定义的术语，所以术语表要完整覆盖角色与核心实体。

## 完成标准

brainstorm.md 与 prd.md 均已写入后，返回：选定方向一句话总结 + 需求清单
（REQ ID + 标题 + 优先级）+ 术语表条目数 + 未决问题列表。
"""

BDD_AGENT_INSTRUCTIONS = """# BDD Agent：严格且闭合的用户故事

你负责一个项目的 BDD 阶段。先读 `<slug>/prd/prd.md`（委派消息给出 slug），特别是
功能需求（REQ-xxx）和术语表。

## 产出：`bdd/user_stories.md`

每条需求至少一条用户故事。每条故事必须满足**闭合规则**（`validate_user_stories`
工具强制校验，见下）。文档格式**必须逐字遵守**（格式被校验器解析）：

```markdown
# 用户故事

## US-auth-001
- **Covers**: REQ-001, REQ-002
- **As a** 注册用户
- **I want** 使用邮箱和密码登录
- **So that** 我能访问我的账户

#### @normal 正确密码登录成功
Given 已存在账户 "user@example.com"
When 我提交正确密码
Then 我看到仪表盘

#### @exception 密码错误登录失败
Given 已存在账户 "user@example.com"
When 我提交错误密码
Then 我看到错误提示 "用户名或密码错误"

#### @alternative 未注册邮箱走注册引导
Given 邮箱 "n@example.com" 未注册
When 我提交登录表单
Then 我被引导到注册页

#### @boundary 密码长度为边界值 64
Given 已存在账户 "b@example.com"
When 我提交长度为 64 的密码
Then 登录成功
```

## 闭合规则（校验器逐条检查，违规 ID 括号内）

1. **三段式**（B1）：`- **As a**：`、`- **I want**：`、`- **So that**：` 三行缺一不可
   （冒号可用半角或全角）。
2. **可追溯**（B2/B3）：`- **Covers**: REQ-001, ...` 必须引用 PRD 中真实存在的
   REQ ID；每条 REQ 至少被一条 US 覆盖。
3. **场景完整**（B4）：每个验收标准一个 `#### <标签> <场景名>` 场景，Given/When/Then
   三种步骤缺一不可，Then 必须写可断言的结果（不能只写"成功处理"这类空话）。
4. **分支闭合**（B5）：每条故事必须覆盖四种分支并打标签：`@normal` 正常路径、
   `@alternative` 替代路径、`@exception` 异常路径、`@boundary` 边界值。
5. **词汇闭合**（B6）：全文禁止出现：TBD、TODO、待定、等等、如有必要、必要时、
   optionally、视情况。
6. **角色闭合**（B7）：`As a` 的角色必须是 PRD 术语表中定义的术语。

## 工作循环

1. 写出全部故事到 `bdd/user_stories.md`。
2. 调用 `validate_user_stories(prd_path="<slug>/prd/prd.md",
   bdd_path="<slug>/bdd/user_stories.md")`。
3. 若有违规：逐条修复文档，重新校验。**最多 3 轮**。
4. 3 轮后仍有违规：停止修复，把违规清单原样返回，由编排者上报用户。

## 完成标准

返回：故事清单（US ID + 标题 + 覆盖的 REQ）+ 场景总数 + 校验结果摘要。
"""

SDD_AGENT_INSTRUCTIONS = """# SDD Agent：按用户故事的系统设计文档

你负责一个项目的 SDD 阶段。先读 `<slug>/prd/prd.md` 与 `<slug>/bdd/user_stories.md`
（委派消息给出 slug）。

## 产出 1：每个用户故事一份 `sdd/sdd-<US-ID>.md`

如 `sdd/sdd-US-auth-001.md`。模板固定（`测试审查定义` 一节的行格式被校验器解析，
**必须逐字遵守**）：

```markdown
# SDD：US-auth-001 <故事标题>

## 边界定义
- In scope：<本故事实现的内容>
- Out of scope：<明确不做的>
- 输入域：<输入及其取值范围>
- 前置条件：<触发前必须成立的状态>

## 接口与数据契约
| 字段 | 类型 | 约束 |
|---|---|---|
| ... | ... | ... |

## 校验逻辑
| 规则 | 触发条件 | 错误码 | 错误信息 |
|---|---|---|---|
| ... | ... | ... | ... |
<每条规则必须能对应到一个 @exception 场景>

## 异常与边界处理
<逐一对应 BDD 的 @exception 与 @boundary 场景，给出处理方式>

### 测试审查定义
- **TC-001** [scenario: @normal 正确密码登录成功] type=集成 priority=P0 pass=仪表盘可见
- **TC-002** [scenario: @exception 密码错误登录失败] type=单元 priority=P0 pass=提示错误
<每个 BDD 场景至少一条测试用例；TC 编号从 TC-001 起连续，全局唯一；
type ∈ 单元|集成|端到端；pass 必须写具体可判定的通过标准>
```

## 产出 2：`sdd/traceability.md` 追溯矩阵

全部故事完成后写矩阵，行格式**必须逐字遵守**：

```markdown
# 追溯矩阵

| REQ | US | Scenario | TestCase |
|---|---|---|---|
| REQ-001 | US-auth-001 | @normal 正确密码登录成功 | TC-001 |
| REQ-001 | US-auth-001 | @exception 密码错误登录失败 | TC-002 |
| REQ-002 | US-auth-002 | @normal 找回邮件发送 | TC-005 |
```

要求：每条 REQ 至少一行；Scenario 名与 BDD 中完全一致；TestCase 必须真实存在于
对应 sdd 文件。

## 工作循环

1. 逐故事写 `sdd/sdd-<US-ID>.md`，再写 `sdd/traceability.md`。
2. 调用 `validate_traceability(workspace_dir="<slug>")`。
3. 若有违规：逐条修复，重新校验。**最多 3 轮**。
4. 3 轮后仍有违规：停止修复，把违规清单原样返回，由编排者上报用户。

## 完成标准

返回：SDD 文件清单 + 测试用例总数（按 type 分布）+ 校验结果摘要。
"""

TASK_DESCRIPTION_PREFIX = """Delegate a task to a specialized sub-agent with isolated context. Available agents for delegation are:
{other_agents}
"""
```

- [ ] **Step 2: 验证模块可导入**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run python -c \"import importlib, research_deepagent.prompts as p; importlib.reload(p); assert all(hasattr(p, n) for n in ['ORCHESTRATOR_INSTRUCTIONS','PRD_AGENT_INSTRUCTIONS','BDD_AGENT_INSTRUCTIONS','SDD_AGENT_INSTRUCTIONS']); print('ok')\""
```

Expected: `ok`

- [ ] **Step 3: 格式一致性快测（防止提示词与正则漂移）**

在 `tests/test_prompt_format_sync.py` 追加一个轻量测试（把提示词中的模板片段喂给校验器）：

```python
from research_deepagent.prompts import BDD_AGENT_INSTRUCTIONS, SDD_AGENT_INSTRUCTIONS
from research_deepagent.validators.traceability import parse_sdd_text
from research_deepagent.validators.bdd_parser import parse_stories


def test_bdd_prompt_example_story_is_parseable():
    # 取提示词中 markdown 代码块里的示例故事
    start = BDD_AGENT_INSTRUCTIONS.index("## US-auth-001")
    end = BDD_AGENT_INSTRUCTIONS.index("## 闭合规则")
    snippet = BDD_AGENT_INSTRUCTIONS[start:end]
    stories = parse_stories(snippet)
    assert stories[0].story_id == "US-auth-001"
    assert len(stories[0].scenarios) == 4


def test_sdd_prompt_test_case_lines_are_parseable():
    refs = parse_sdd_text(SDD_AGENT_INSTRUCTIONS)
    assert any(r.tc_id == "TC-001" and r.scenario_name == "@normal 正确密码登录成功" for r in refs)
```

- [ ] **Step 4: 运行全部测试**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest -q"
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/research_deepagent/prompts.py tests/test_prompt_format_sync.py
git commit -m "feat: rewrite prompts for orchestrator and three phase agents"
```

---

### Task 8: `agent.py` 重写（backend、subagents、graph 装配）

**Files:**
- Modify: `src/research_deepagent/agent.py`
- Test: `tests/test_graph_build.py`

**Interfaces:**
- Consumes: Task 4 `validate_user_stories`、Task 5 `validate_traceability`、Task 6 `load_pencli_tools`、Task 7 四个指令常量、现有 `tools.py` 的 `tavily_search`
- Produces: 模块级 `graph`（供 langgraph.json 加载）、常量 `WORKSPACE_ROOT: Path`。模型初始化段（provider 解析、`MODEL_INIT_KWARGS`、`model = init_chat_model(...)`）原样保留。

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest tests/test_graph_build.py -v"
```

Expected: FAIL（`agent.py` 尚无 `WORKSPACE_ROOT`，reload 后属性缺失）

- [ ] **Step 3: 重写 agent.py（保留模型初始化段）**

`agent.py` 中 31-153 行（`SUPPORTED_MODEL_PROVIDERS` 到 `model = init_chat_model(...)`）原样保留，模块头部与尾部替换为：

```python
"""PRD→BDD→SDD document-generation graph, served by `agentseek-api dev`.

Pure deepagents + LangChain. The orchestrator delegates to three phase
sub-agents (PRD / BDD / SDD); documents land on the real disk under
DOCS_WORKSPACE_DIR via FilesystemBackend.
"""

from __future__ import annotations

import os
import warnings
from datetime import datetime
from pathlib import Path

from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model

from research_deepagent.mcp_tools import load_pencli_tools
from research_deepagent.prompts import (
    BDD_AGENT_INSTRUCTIONS,
    ORCHESTRATOR_INSTRUCTIONS,
    PRD_AGENT_INSTRUCTIONS,
    SDD_AGENT_INSTRUCTIONS,
    TASK_DESCRIPTION_PREFIX,
)
from research_deepagent.tools import tavily_search
from research_deepagent.validators.lc_tools import (
    validate_traceability,
    validate_user_stories,
)

load_dotenv()

# ... SUPPORTED_MODEL_PROVIDERS ... model = init_chat_model(**MODEL_INIT_KWARGS)
# （这段原样保留，不要动）

WORKSPACE_ROOT = Path(os.getenv("DOCS_WORKSPACE_DIR", "./workspace")).resolve()
WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)

pencli_tools = load_pencli_tools()
if pencli_tools:
    print(f"[agent] pencli MCP tools loaded: {[t.name for t in pencli_tools]}")
else:
    print("[agent] running without pencli MCP tools (degraded)")

prd_agent = {
    "name": "prd-agent",
    "description": (
        "PRD 阶段 sub-agent：根据用户需求做头脑风暴并产出正式 PRD。"
        "委派时必须提供项目 slug 和用户需求（或修改意见）。"
    ),
    "system_prompt": PRD_AGENT_INSTRUCTIONS,
    "tools": [tavily_search, *pencli_tools],
}

bdd_agent = {
    "name": "bdd-agent",
    "description": (
        "BDD 阶段 sub-agent：依据已确认的 PRD 产出严格闭合的用户故事并用"
        "校验器强制闭合规则。委派时必须提供项目 slug。"
    ),
    "system_prompt": BDD_AGENT_INSTRUCTIONS,
    "tools": [validate_user_stories],
}

sdd_agent = {
    "name": "sdd-agent",
    "description": (
        "SDD 阶段 sub-agent：依据已确认的 BDD 用户故事逐条产出系统设计文档"
        "与追溯矩阵并用校验器检查。委派时必须提供项目 slug。"
    ),
    "system_prompt": SDD_AGENT_INSTRUCTIONS,
    "tools": [validate_traceability],
}

graph = create_deep_agent(
    model=model,
    tools=[],
    system_prompt=ORCHESTRATOR_INSTRUCTIONS,
    subagents=[prd_agent, bdd_agent, sdd_agent],
    backend=FilesystemBackend(root_dir=WORKSPACE_ROOT),
)
```

注意：`validate_user_stories` / `validate_traceability` 是 LangChain `@tool` 对象，
sub-agent 的 `tools` 列表直接引用即可（与现有 `tavily_search` 用法一致）。

- [ ] **Step 4: 运行测试确认通过 + 全量回归**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uv run pytest -q"
```

Expected: 全部 PASS（含 Task 1–7 的测试）

- [ ] **Step 5: dry-run 校验服务能加载 graph**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uvx agentseek dev --dry-run"
```

Expected: 无报错（graph 符号仍从 `./src/research_deepagent/agent.py:graph` 加载）

- [ ] **Step 6: Commit**

```bash
git add src/research_deepagent/agent.py tests/test_graph_build.py
git commit -m "feat: assemble PRD/BDD/SDD deep agent with filesystem backend and phase subagents"
```

---

### Task 9: 配置示例与 README 更新

**Files:**
- Modify: `.env.example`（追加两个变量）
- Modify: `README.md`（重写为文档生成 Agent 说明）

**Interfaces:**
- Consumes: 无
- Produces: `DOCS_WORKSPACE_DIR`、`PENCLI_MCP_URL` 环境变量文档。

- [ ] **Step 1: .env.example 末尾追加**

```bash
# --- Document generation workspace ----------------------------------------
# Real on-disk root for generated PRD/BDD/SDD documents (FilesystemBackend).
DOCS_WORKSPACE_DIR=./workspace

# --- pencli MCP ------------------------------------------------------------
# Streamable-HTTP MCP endpoint for the pencli design MCP service. Leave empty
# to run without pencli tools (graceful degradation).
PENCLI_MCP_URL=
```

- [ ] **Step 2: 重写 README.md**

```markdown
# PRD→BDD→SDD DeepAgent

基于 DeepAgents 的文档生成 Agent：用户提出产品需求后，按 **PRD → BDD → SDD** 三阶段
生成设计文档，阶段之间有人工确认门禁。文档直接写入 `DOCS_WORKSPACE_DIR`（默认
`./workspace`）下的真实磁盘目录。

- **PRD**：头脑风暴（≥3 个候选方向 + 取舍记录）→ 正式 PRD（REQ-xxx 需求 ID + 术语表）
- **BDD**：严格闭合的用户故事 —— 可追溯、三段式、Gherkin 四分支全覆盖（@normal/
  @alternative/@exception/@boundary）、词汇闭合，由确定性校验器强制执行
- **SDD**：每条用户故事一份设计文档（边界定义 / 接口契约 / 校验逻辑 / 异常边界处理 /
  测试审查定义）+ REQ↔US↔Scenario↔TestCase 四层追溯矩阵

后端为 `create_deep_agent(...)` 图，经 `agentseek-api dev` 托管；前端流式展示
todos、工具卡片与最终 markdown 回复。AgentSeek 仅作为外部模板与生命周期工具，
本项目行为声明在 `.agentseek/lifecycle.toml`。

## 快速开始

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
$EDITOR .env          # 填模型凭据；可选填 PENCLI_MCP_URL

uvx agentseek task sync
uvx agentseek task frontend
uvx agentseek dev
```

- LangGraph 后端默认 `http://127.0.0.1:2024`
- 前端默认 `http://127.0.0.1:5174`

## 冒烟测试

打开 `http://127.0.0.1:5174`，输入：

```text
我想做一个团队任务看板应用
```

预期行为：

- 出现 **PRD / BDD / SDD** 三个 todo 项
- prd-agent 产出 `workspace/team-task-board/prd/brainstorm.md` 与 `prd.md` 后，
  agent 汇报摘要并停下等待确认
- 回复「确认」→ bdd-agent 产出用户故事（校验通过）→ 再次门禁
- 回复「确认」→ sdd-agent 产出各故事 SDD 与追溯矩阵 → 完成清单
- 任何阶段回复修改意见 → 仅该阶段重跑修订

## 环境变量

| 变量 | 说明 |
|---|---|
| `DOCS_WORKSPACE_DIR` | 文档工作区根目录，默认 `./workspace` |
| `PENCLI_MCP_URL` | pencli 设计 MCP 的 streamable-http 地址；留空则降级运行 |
| 其余 | 模型 provider 与凭据、Tavily key 同原模板（见 `.env.example`） |

## 测试

```bash
uv run pytest -q
```
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: update env example and README for document-generation agent"
```

---

### Task 10: 端到端手动冒烟（需用户配合）

**Files:** 无代码改动；产出验证记录。

**Interfaces:**
- Consumes: Task 8 的 graph、Task 9 的配置
- Produces: 端到端验证结论；发现问题则回修。

- [ ] **Step 1: 启动服务**

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uvx agentseek dev"
```

另开终端确认：

```bash
wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "uvx agentseek doctor --live"
```

Expected: langgraph 与 frontend 两个 check 通过。

- [ ] **Step 2: 浏览器走三阶段**

在 `http://127.0.0.1:5174` 输入需求（建议一个简单真实需求），验证：

1. todos 面板出现 PRD/BDD/SDD 三项
2. PRD 产出后 agent 停下汇报（检查 `workspace/<slug>/prd/` 两个文件真实存在）
3. 回复修改意见 → 仅 PRD 重跑；回复确认 → BDD 开始
4. BDD 产出后停下；故意让校验器抓到问题时 agent 能自修复（观察工具卡片多次调用 validate_user_stories 属正常）
5. SDD 产出后 traceability 通过，收到文档清单
6. `workspace/<slug>/sdd/traceability.md` 存在且 REQ 覆盖完整

- [ ] **Step 3: 降级路径验证（可选但建议）**

把 `PENCLI_MCP_URL` 设为一个不可达地址重启，确认启动日志出现降级 warning，PRD 阶段仍可完成。

- [ ] **Step 4: 记录结论**

把冒烟结果（通过/发现的问题与回修 commit）汇报给用户；若有回修，按任务模板单独提交。

---

## Self-Review 结论

- **Spec 覆盖**：§3 架构（Task 8）、§4 目录布局（Task 7/8 提示词与 backend）、§5 门禁（Task 7 编排者指令 + Task 10 验证）、§6.1 PRD（Task 7 PRD 指令）、§6.2 BDD 五条闭合规则 ↔ 校验规则 B1–B7（Task 2/3/4）、§6.3 SDD 五节模板 + 追溯矩阵（Task 5/7）、§7 工具（Task 4/5/6）、§8 错误处理（校验 3 轮上限、MCP 降级、断点恢复 — Task 7/8）、§9 测试（各任务 TDD + Task 10）、§10 实施范围全覆盖；无缺口。
- **占位符扫描**：无 TBD/TODO 类占位；所有代码步骤给出完整代码。
- **类型一致性**：`parse_stories/Story/Scenario`（Task 2）→ Task 4/5 引用一致；`ValidationResult.summary()`（Task 2）→ Task 4/5 工具返回一致；`resolve_workspace_path/read_text`（Task 4）→ Task 5 工具复用一致；`load_pencli_tools`（Task 6）→ Task 8 调用一致；`WORKSPACE_ROOT`（Task 8）→ Task 8 测试断言一致。
