"""REQ↔US↔Scenario↔TestCase four-layer traceability checks.

SDD file naming: ``sdd-<US-id>.md``. Test-case line format (see
``prompts.SDD_AGENT_INSTRUCTIONS``): ``- **TC-001** [scenario: <scenario name>]
type=... priority=... pass=...``. Traceability matrix rows:
``| REQ-001 | US-auth-001 | <scenario name> | TC-001 |``.

Scenario references in SDD lines and traceability rows may carry the branch
tag prefix (e.g. ``@normal 登录成功``); the tag is stripped before comparing
against parsed scenario names.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from research_deepagent.validators.bdd_parser import parse_stories
from research_deepagent.validators.models import ValidationResult, Violation
from research_deepagent.validators.prd_parser import parse_requirements

SDD_STORY_ID_RE = re.compile(r"^(US-[a-z0-9]+(?:-[a-z0-9]+)*-\d{3})$")
TC_RE = re.compile(r"TC-\d{3}")
SCENARIO_REF_RE = re.compile(r"\[scenario:\s*([^\]]+)\]")
SCENARIO_TAG_PREFIX_RE = re.compile(r"^(?:@[\w-]+\s+)+")
TRACE_ROW_RE = re.compile(
    r"^\|\s*(REQ-\d{3})\s*\|\s*(US-[a-z0-9]+(?:-[a-z0-9]+)*-\d{3})\s*\|\s*([^|]+?)\s*\|\s*(TC-\d{3})\s*\|",
    re.MULTILINE,
)


@dataclass
class SddRef:
    tc_id: str
    scenario_name: str


def strip_scenario_tags(name: str) -> str:
    """Remove leading ``@tag`` tokens: ``@normal 登录成功`` → ``登录成功``."""
    return SCENARIO_TAG_PREFIX_RE.sub("", name).strip()


def parse_sdd_text(sdd_text: str) -> list[SddRef]:
    refs: list[SddRef] = []
    for line in sdd_text.splitlines():
        tc = TC_RE.search(line)
        scenario = SCENARIO_REF_RE.search(line)
        if tc and scenario:
            refs.append(
                SddRef(
                    tc_id=tc.group(0),
                    scenario_name=strip_scenario_tags(scenario.group(1)),
                )
            )
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
        matrix_reqs: set[str] = set()
        for req, story_id, scenario_name, tc in TRACE_ROW_RE.findall(trace_text):
            row_valid = True
            if story_id not in story_ids:
                violations.append(Violation("T5", story_id, f"追溯矩阵引用了不存在的 {story_id}"))
                row_valid = False
            else:
                scenario_name = strip_scenario_tags(scenario_name)
                if scenario_name not in scenarios_by_story.get(story_id, []):
                    violations.append(
                        Violation("T5", story_id, f"追溯矩阵引用了不存在的场景 '{scenario_name}'")
                    )
                    row_valid = False
                if tc not in {r.tc_id for r in sdd_refs.get(story_id, [])}:
                    violations.append(Violation("T5", story_id, f"追溯矩阵引用了不存在的 {tc}"))
                    row_valid = False
            if row_valid and req in reqs:
                matrix_reqs.add(req)
        for row_req in set(re.findall(r"REQ-\d{3}", trace_text)):
            if row_req not in reqs:
                violations.append(Violation("T5", None, f"追溯矩阵引用了不存在的 {row_req}"))
        # T6: every REQ reaches at least one TestCase through the matrix
        for req in sorted(reqs - matrix_reqs):
            violations.append(Violation("T6", None, f"{req} 在追溯矩阵中没有关联到测试用例的行"))

    return ValidationResult(violations=violations)
