"""Parser for ``bdd/user_stories.md``.

The authoritative document format lives in ``prompts.BDD_AGENT_INSTRUCTIONS`` —
keep the regexes here in sync with that template.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

STORY_HEADER_RE = re.compile(r"^##\s+(US-[a-z0-9]+(?:-[a-z0-9]+)*-\d{3})\s*$", re.MULTILINE)
COVERS_RE = re.compile(r"^- \*\*Covers\*\*[：:]\s*(.+)$", re.MULTILINE)
REQ_REF_RE = re.compile(r"REQ-\d{3}")
AS_A_RE = re.compile(r"^- \*\*As a\*\*[：:]?\s*(.+)$", re.MULTILINE)
I_WANT_RE = re.compile(r"^- \*\*I want\*\*[：:]?\s*(.+)$", re.MULTILINE)
SO_THAT_RE = re.compile(r"^- \*\*So that\*\*[：:]?\s*(.+)$", re.MULTILINE)
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
