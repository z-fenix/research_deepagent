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

    if not glossary:
        violations.append(
            Violation("B7", None, "PRD 缺少术语表或术语表为空，无法校验角色闭合")
        )

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
