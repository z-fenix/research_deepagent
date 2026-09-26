# task05 实施计划：子 Agent 与上下文隔离（第 5 章落地）

> Spec：对话中确认的 task05 设计（2026-09-26）。本章对应《Deep Agents》第 5 章
> 「子 Agent 与上下文隔离」。本仓库已有 prd/bdd/sdd 三个具名字典式 sub-agent，
> 本计划按第 5 章补齐三件事：禁用 general-purpose 后门、引入 `response_format`
> 结构化返回、沉淀委派纪律提示词与隔离验证，最后产出开发文档。

## Global Constraints

- TDD：每个任务先写测试再实现；测试不得触发真实模型调用（沿用
  `tests/test_todos_planning.py` 的 `GenericFakeChatModel` + `bind_tools` 模式；
  `tests/conftest.py` 已禁 LangSmith，不得绕过）。
- deepagents 0.7.13 / langchain>=1.0；涉及框架内省（task 工具位置、
  response_format 回传形态）的断言，实现者须先在 `.venv` 中实证 API 再落笔，
  计划给出的探查路径是线索而非保证。
- 不修改 `research_deepagent/validators/`，不动 `frontend/`。
- 图不自带 Checkpointer（持久化归 AgentSeek 平台），不得引入。
- 全量测试保持通过（基线 181 passed）；提交信息用 conventional commits，
  与仓库历史风格一致。
- 提示词为中文，代码标识符/docstring 风格与现有文件一致。

## Task 1: 禁用 general-purpose 子 Agent

**目标**：`task` 工具只暴露 `prd-agent` / `bdd-agent` / `sdd-agent`。

1. `src/research_deepagent/agent.py`：
   - `from deepagents.profiles import GeneralPurposeSubagentProfile, HarnessProfile, register_harness_profile`；
   - 在模块层（`model` 定义之后）注册：
     ```python
     register_harness_profile(
         MODEL_PROVIDER,
         HarnessProfile(general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False)),
     )
     ```
   - 该注册是**全局且可加（additive/merge）**的：测试 reload `agent_module`
     会重复注册，语义上幂等，无需去重处理。
   - 顺手清理死代码：`agent.py` import 了但从未使用的 `TASK_DESCRIPTION_PREFIX`
     （`prompts.py:298` 的常量随之删除；已确认无其他引用）。
2. `tests/test_subagent_delegation.py`（新文件，本任务起建）：
   - 从 built graph 内省 `task` 工具（线索：`graph.builder.nodes["tools"]`
     上的 ToolNode 及其 `tools_by_name`；实现者须实证）；
   - 断言 task 工具描述包含三个具名 agent、不包含 `general-purpose`；
   - 断言 `build_deep_agent` 返回的图仍然可构建（冒烟）。
3. 运行 `uv run pytest tests/test_subagent_delegation.py tests/test_todos_planning.py -q`。

**提交**：`feat(agent): disable default general-purpose subagent via harness profile`

## Task 2: 子 Agent 结构化返回（response_format）

**目标**：三个 sub-agent 的「完成标准」从自由文本改为 schema 化 JSON。

1. 新文件 `src/research_deepagent/schemas.py`（Pydantic v2，字段中文 description）：

   | 模型 | 字段 |
   |---|---|
   | `PrdRequirement` | `id: str`、`title: str`、`priority: str`（P0/P1/P2） |
   | `PrdPhaseReport` | `direction: str`（选定方向一句话）、`requirements: list[PrdRequirement]`、`glossary_terms: int`、`open_questions: list[str]`、`brainstorm_path: str`、`prd_path: str` |
   | `BddStorySummary` | `id: str`、`title: str`、`covers: list[str]`（REQ ID） |
   | `BddPhaseReport` | `stories: list[BddStorySummary]`、`scenario_count: int`、`validation_summary: str`、`unresolved_violations: list[str]` |
   | `SddPhaseReport` | `sdd_files: list[str]`、`test_case_count: int`、`test_cases_by_type: dict[str, int]`、`validation_summary: str`、`unresolved_violations: list[str]` |

2. `src/research_deepagent/agent.py`：三个 sub-agent 字典各加
   `"response_format": XxxPhaseReport`。
3. `src/research_deepagent/prompts.py`：仅改三个 sub-agent 的「完成标准」一节，
   改为逐字段说明 JSON 返回内容（含 `unresolved_violations` 语义：3 轮修复后
   仍有违规时原样上抛）；**不得触碰**校验器解析的文档格式段。
4. 测试（追加到 `tests/test_subagent_delegation.py`）：
   - fake 模型脚本化：主图回合发起 `task(name="prd-agent", ...)` →
     子 Agent 最终返回符合 `PrdPhaseReport` 的 JSON 文本 → 主图收尾；
     断言主图 messages 中 task 的 ToolMessage 内容能被
     `PrdPhaseReport.model_validate_json` 解析（验证接线，不验证模型能力）；
   - 提示词契约：三个 INSTRUCTIONS 的「完成标准」含对应 schema 关键字段名。
5. 运行全量 `uv run pytest tests/ -q`。

**提交**：`feat(agent): structured sub-agent phase reports via response_format`

## Task 3: 委派纪律提示词 + 上下文隔离验证

1. `src/research_deepagent/prompts.py` 的 `ORCHESTRATOR_INSTRUCTIONS`
   新增「委派纪律（task）」一节，约定：
   - 只通过 `task` 工具委派给 `prd-agent` / `bdd-agent` / `sdd-agent`，
     绝不自行撰写阶段文档；
   - 委派消息必须自带完整上下文：项目 slug、阶段、（修订时）用户意见原文；
   - 子 Agent 在隔离上下文中工作，编排者只消费其返回的（结构化）摘要，
     不复述、不重复其内部工作。
2. 测试（追加到 `tests/test_subagent_delegation.py`）：
   - **隔离脚本**：主图发起 `task(name="prd-agent", ...)` → 子 Agent 内部
     发起 `write_file` 工具调用 → 子 Agent 返回最终 JSON → 主图收尾。
     断言：主图 result 的 messages 中不存在 `write_file` 的 AIMessage /
     ToolMessage；文件确实写入 VFS backend；恰好一条 task 对应的 ToolMessage。
   - `test_orchestrator_prompt_declares_delegation_conventions`：提示词含
     委派纪律关键约定（与 Task 1 同款契约测试风格）。
3. 运行全量 `uv run pytest tests/ -q`。

**提交**：`feat(agent): delegation discipline in orchestrator prompt with isolation tests`

## Task 4: 开发文档 docs/dev/subagents.md

对照 `docs/dev/todo-planning.md` 的结构撰写：

1. 能力概述：Context Quarantine 在本流水线的形态（阶段隔离 + 结构化回报）；
2. 设计决策表：禁用 general-purpose 的理由、response_format 的理由、
   委派纪律写入提示词的理由、provider 级 HarnessProfile 注册；
3. 架构与数据流图 + 关键文件表；
4. 后端实现：harness profile、`schemas.py` 三个报告模型、sub-agent 接线、
   「完成标准」与 schema 的同步关系（类似 todo-planning 的漂移提醒：
   改字段须同步 prompts + 测试断言）；
5. 测试一节（用例表 + 运行命令）；
6. 扩展指南与故障排查。

**提交**：`docs: add development guide for subagent isolation`

## 任务间关系（预检扫描）

| 任务对 | 共享面 | 结论 |
|---|---|---|
| T1→T2 | `agent.py`（T1 改模块头部/harness 注册，T2 改 sub-agent 字典）| 不同区域，顺序执行无冲突 |
| T2→T3 | `prompts.py`（T2 改 sub-agent 完成标准，T3 改 ORCHESTRATOR）+ 同一测试文件 | 分节编辑；T3 复用 T2 的 fake 模型脚本模式，T2 须把 helper 命名稳定下来 |
| T3→T4 | 文档消费最终形态 | T4 最后执行 |

每个任务自洽性：测试均基于已验证的 `GenericFakeChatModel` 模式；
task 工具内省路径与 response_format 回传形态为实现期须实证的假设（已写入约束）。
