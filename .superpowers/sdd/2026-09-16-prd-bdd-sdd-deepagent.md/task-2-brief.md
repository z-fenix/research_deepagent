# Task 2 Brief: BDD 文档解析器（`validators/bdd_parser.py`）

> 以下为实现计划中 Task 2 的完整原文，逐字遵守。执行环境为 WSL Ubuntu-24.04，工作目录 `/home/zhang/workplace/research_deepagent`。WSL 命令经 `wsl.exe -d Ubuntu-24.04 --cd /home/zhang/workplace/research_deepagent -- bash -lc "<cmd>"` 执行（git/uv/pytest）。文件编辑用 UNC 路径 `//wsl.localhost/Ubuntu-24.04/home/zhang/workplace/research_deepagent/...`。

**Files:**
- Create: `src/research_deepagent/validators/__init__.py`、`src/research_deepagent/validators/models.py`、`src/research_deepagent/validators/bdd_parser.py`
- Test: `tests/test_bdd_parser.py`

**Interfaces:**
- Produces:
  - `models.py`：`@dataclass Violation(rule: str, story_id: str | None, message: str)`；`@dataclass ValidationResult(violations: list[Violation])` 带 `ok: bool` 属性和 `summary() -> str` 方法。
  - `bdd_parser.py`：`@dataclass Scenario(name: str, tags: list[str], given: bool, when: bool, then: bool)`；`@dataclass Story(story_id: str, covers: list[str], as_a: str | None, i_want: str | None, so_that: str | None, scenarios: list[Scenario], text: str)`；`parse_stories(bdd_text: str) -> list[Story]`；常量 `BRANCH_TAGS`、`FORBIDDEN_WORDS`。

**Step 1: 写 models.py（无需测试，纯数据类）**

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

**Step 2: 写失败测试**

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

**Step 3: 运行测试确认失败**

```bash
uv run pytest tests/test_bdd_parser.py -v
```

Expected: FAIL（`ModuleNotFoundError: research_deepagent.validators`）

**Step 4: 实现 bdd_parser.py**

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

**Step 5: 运行测试确认通过**

```bash
uv run pytest tests/test_bdd_parser.py -v
```

Expected: 全部 PASS

**Step 6: Commit**

```bash
git add src/research_deepagent/validators/ tests/test_bdd_parser.py
git commit -m "feat: BDD user-stories parser with closure-rule primitives"
```
