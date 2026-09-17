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
