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
