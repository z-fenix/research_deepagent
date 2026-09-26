"""子 Agent 结构化阶段报告 schema（Pydantic v2）。

三个具名子 Agent（prd-agent / bdd-agent / sdd-agent）通过
``response_format`` 声明各自阶段完成时的结构化报告；deepagents 会把结构化
响应序列化为 JSON 放入主图 task 工具的 ToolMessage，编排者据此做阶段汇报。

契约：本模块的字段名与语义必须与 ``research_deepagent.prompts`` 中对应
sub-agent 指令的「完成标准」一节保持同步 —— prompts 描述模型要返回什么，
这里定义它如何被校验与回传。修改任一侧时必须同步另一侧
（``tests/test_subagent_delegation.py::test_subagent_prompts_declare_schema_fields``
锁定关键字段名）。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class PrdRequirement(BaseModel):
    """PRD 功能需求条目。"""

    id: str = Field(description="需求 ID，格式 REQ-<三位数字>，如 REQ-001")
    title: str = Field(description="需求标题")
    priority: str = Field(description="优先级：P0 / P1 / P2")


class PrdPhaseReport(BaseModel):
    """prd-agent 的 PRD 阶段结构化报告。"""

    direction: str = Field(description="选定的产品方向，一句话总结")
    requirements: list[PrdRequirement] = Field(
        description="功能需求清单（REQ ID + 标题 + 优先级）"
    )
    glossary_terms: int = Field(description="术语表条目数")
    open_questions: list[str] = Field(description="未决问题列表")
    brainstorm_path: str = Field(description="头脑风暴记录路径，如 <slug>/prd/brainstorm.md")
    prd_path: str = Field(description="正式 PRD 路径，如 <slug>/prd/prd.md")


class BddStorySummary(BaseModel):
    """BDD 用户故事条目。"""

    id: str = Field(description="故事 ID，格式 US-<epic>-<三位序号>，如 US-auth-001")
    title: str = Field(description="故事标题")
    covers: list[str] = Field(description="该故事覆盖的 REQ ID 列表")


class BddPhaseReport(BaseModel):
    """bdd-agent 的 BDD 阶段结构化报告。"""

    stories: list[BddStorySummary] = Field(description="用户故事清单（US ID + 标题 + 覆盖的 REQ）")
    scenario_count: int = Field(description="用户故事场景总数")
    validation_summary: str = Field(description="validate_user_stories 校验结果摘要")
    unresolved_violations: list[str] = Field(
        description="3 轮修复后仍未闭合的违规清单（原样罗列）；已全部闭合则为空列表"
    )


class SddPhaseReport(BaseModel):
    """sdd-agent 的 SDD 阶段结构化报告。"""

    sdd_files: list[str] = Field(description="产出的 SDD 文档路径清单（含追溯矩阵）")
    test_case_count: int = Field(description="测试用例总数")
    test_cases_by_type: dict[str, int] = Field(
        description="测试用例按 type 的分布（单元 / 集成 / 端到端 → 数量）"
    )
    validation_summary: str = Field(description="validate_traceability 校验结果摘要")
    unresolved_violations: list[str] = Field(
        description="3 轮修复后仍未闭合的违规清单（原样罗列）；已全部闭合则为空列表"
    )
