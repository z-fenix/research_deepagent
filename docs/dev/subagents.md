# 开发文档：子 Agent 隔离与结构化回报（task / SubAgentMiddleware）

> 对应《Deep Agents》第 5 章「子 Agent 与上下文隔离」。本文面向本仓库的开发者，
> 说明 Context Quarantine 能力在 PRD→BDD→SDD 文档生成流水线中的接线方式、
> 设计决策、数据流、测试与扩展点。

## 1. 能力概述

Context Quarantine 在本流水线中的形态是**阶段隔离 + 结构化回报**：

- 编排者（Orchestrator）通过 `task` 工具把 PRD / BDD / SDD 三个阶段分别委派给
  具名子 Agent（`prd-agent` / `bdd-agent` / `sdd-agent`）；
- 子 Agent 在**隔离上下文**中工作：它收到的初始消息只有一条包含委派描述的
  HumanMessage，编排者的中间工具调用与消息历史不会进入子 Agent 上下文，
  子 Agent 的中间工具调用（搜索、写文件、校验等）也不会回流到编排者上下文；
- 子 Agent 结束时通过 `response_format` 声明的 Pydantic 模型返回**结构化阶段
  报告**（JSON），编排者只消费这份 JSON 摘要并据此向用户做阶段汇报。

效果：每个阶段的探索性工作（头脑风暴、检索、多轮校验修复）的 token 成本被
隔离在子 Agent 上下文内，主图上下文里每个阶段只增加一条紧凑的 ToolMessage。

## 2. 设计决策

| 决策 | 理由 |
|---|---|
| 禁用默认 general-purpose 子 Agent（`HarnessProfile`，provider 级 key，`GeneralPurposeSubagentProfile(enabled=False)`） | deepagents 默认会给主图附加一个通用 general-purpose 子 Agent，等于给编排者留了绕过 PRD→BDD→SDD 阶段结构的后门（直接把阶段工作丢给通用 Agent）。关闭后 `task` 工具的可委派列表只剩三个具名阶段子 Agent，阶段结构由工具面强制 |
| 三个子 Agent 声明 `response_format` 结构化返回 | 编排者做门禁汇报需要规整的摘要（方向、需求清单、场景数、校验结果）；`unresolved_violations` 字段把「3 轮修复后仍未闭合的违规」显式上抛给编排者，而不是埋在自由文本里。默认模型 gpt-4.1-mini 走 langchain 的 ProviderStrategy（provider 原生结构化输出，`AutoStrategy` 依模型名回退规则选择，见 `tests/test_subagent_delegation.py:33` 的注释），子 Agent 最终回复为纯 JSON 文本，与提示词「最终回复必须是 JSON」的措辞一致 |
| 委派纪律写入 `ORCHESTRATOR_INSTRUCTIONS` | `task` 只是普通工具，框架不校验「什么时候委派、委派消息带什么内容」；委派时机（绝不自行撰写阶段文档）与消息内容（自带 slug、阶段、用户意见原文）靠提示词纪律约束，偏离时由人工门禁兜底 |
| `task_description`（上游默认英文文案）未替换 | 保持 deepagents 默认的 task 工具描述，避免为改写措辞引入一层覆盖配置的维护负担；测试对子 Agent 清单的断言限定在「Available agent types」列表段内，不依赖上游文案细节 |

## 3. 架构与数据流

```
用户需求
   │
   ▼
Orchestrator（create_deep_agent + ORCHESTRATOR_INSTRUCTIONS）
   │  1. 开场建 todos、恢复/创建 project_state.md
   │  2. task(subagent_type="prd-agent", description="做 PRD，slug=demo")
   │     ▼
   │  子 Agent（隔离上下文：初始消息只有委派描述一条 HumanMessage）
   │     头脑风暴 → 检索 → 写文档 → 校验 → 多轮修复（全部留在子 Agent 上下文）
   │     ▼
   │  structured_response（PrdPhaseReport 等）
   │     ── model_dump_json() ──▶ task 工具的 ToolMessage
   │  3. 编排者消费 JSON 摘要 → 门禁汇报 → 等用户确认 → 委派下一阶段
   ▼
主图 messages（每阶段只新增一条紧凑的 task ToolMessage）
```

关键文件：

| 文件 | 职责 |
|---|---|
| `src/research_deepagent/agent.py` | HarnessProfile 注册；三个具名子 Agent spec（含 `response_format`） |
| `src/research_deepagent/schemas.py` | 三个阶段报告的 Pydantic 模型（契约面） |
| `src/research_deepagent/prompts.py` | 编排者委派纪律；三个子 Agent 的「完成标准」（与 schema 同步） |
| `tests/test_subagent_delegation.py` | 委派边界、结构化回报与上下文隔离的行为验证 |

## 4. 后端实现

### 4.1 HarnessProfile 注册

`src/research_deepagent/agent.py:151`（模块层，紧跟 `model = init_chat_model(...)`
之后）：

```python
register_harness_profile(
    MODEL_PROVIDER,
    HarnessProfile(general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False)),
)
```

- **注册 key 是解析后的模型 provider**（`MODEL_PROVIDER`，由
  `AGENTSEEK_MODEL_PROVIDER` 或模型名前缀解析而来，默认 `openai`）。
  `create_deep_agent` 对传入的模型实例按 provider 解析 harness profile，
  provider 级 key 即可命中；
- **注册是全局且叠加的**（additive/merge）：重复注册（如测试 reload `agent`
  模块时）按幂等合并处理，不会报错也不会重复累积；
- 关闭的是 `general_purpose_subagent` 这一个字段，子 Agent 的其余默认装配
  （文件系统工具、子 Agent 清单组装方式等）不受影响。

### 4.2 阶段报告 schema（`schemas.py`）

三个 Pydantic v2 模型，字段带中文 description：

**`PrdPhaseReport`**（`src/research_deepagent/schemas.py:27`）——prd-agent 报告：

| 字段 | 类型 | 语义 |
|---|---|---|
| `direction` | `str` | 选定的产品方向，一句话总结 |
| `requirements` | `list[PrdRequirement]` | 功能需求清单 |
| `glossary_terms` | `int` | 术语表条目数 |
| `open_questions` | `list[str]` | 未决问题 |
| `brainstorm_path` | `str` | `brainstorm.md` 写入路径 |
| `prd_path` | `str` | `prd.md` 写入路径 |

内嵌 `PrdRequirement`（`schemas.py:19`）：`id`（REQ-xxx）/ `title` / `priority`（P0/P1/P2）。

**`BddPhaseReport`**（`schemas.py:48`）——bdd-agent 报告：

| 字段 | 类型 | 语义 |
|---|---|---|
| `stories` | `list[BddStorySummary]` | 用户故事清单（内嵌 `BddStorySummary`：`id` / `title` / `covers`） |
| `scenario_count` | `int` | 场景总数 |
| `validation_summary` | `str` | `validate_user_stories` 校验结果摘要 |
| `unresolved_violations` | `list[str]` | 3 轮修复后仍未闭合的违规清单；已闭合则为空列表 |

**`SddPhaseReport`**（`schemas.py:59`）——sdd-agent 报告：

| 字段 | 类型 | 语义 |
|---|---|---|
| `sdd_files` | `list[str]` | 产出的 SDD 文档路径清单（含追溯矩阵） |
| `test_case_count` | `int` | 测试用例总数 |
| `test_cases_by_type` | `dict[str, int]` | 用例数按 type（单元/集成/端到端）的分布 |
| `validation_summary` | `str` | `validate_traceability` 校验结果摘要 |
| `unresolved_violations` | `list[str]` | 同 BDD，语义一致 |

### 4.3 子 Agent 接线

三个子 Agent 在 `src/research_deepagent/agent.py:165` 起（`prd_agent` /
`bdd_agent` / `sdd_agent` 字典）声明，每个 spec 含：

- `name` / `description`：description 会进入 task 工具的「Available agent
  types」列表，是编排者选择委派对象的唯一信号——必须写清阶段职责与
  「委派时必须提供 slug」的要求；
- `system_prompt`：对应的 `*_AGENT_INSTRUCTIONS`；
- `response_format`：`PrdPhaseReport` / `BddPhaseReport` / `SddPhaseReport`；
- `tools`：`prd-agent` 带检索与 pencli MCP 工具，`bdd-agent` 带
  `validate_user_stories`，`sdd-agent` 带 `validate_traceability`。

spec 未声明 `model` 时默认沿用主 Agent 的模型（deepagents 在装配时以
`spec.get("model", model)` 兜底）；`build_deep_agent()`
（`agent.py:198`）把它们注入 `create_deep_agent(subagents=[...])`。

### 4.4 「完成标准」与 schema 的同步契约

`prompts.py` 中三个子 Agent 指令的「完成标准」一节
（`prompts.py:161` PRD / `prompts.py:241` BDD / `prompts.py:317` SDD）逐字段
描述了最终 JSON 报告——prompts 描述模型要返回什么，`schemas.py` 定义它如何
被校验与回传。**两侧必须同步**：改 schema 字段（增删改名）时必须同时改
对应 prompts 一节，反之亦然；否则
`test_subagent_prompts_declare_schema_fields`（锁定关键字段名）会失败，
以测试失败的形式提示契约漂移。

## 5. 测试

### 5.1 `tests/test_subagent_delegation.py`

| 用例 | 验证点 |
|---|---|
| `test_task_tool_exposes_only_named_subagents` | task 工具描述的「Available agent types」列表只含三个具名子 Agent，不含 general-purpose |
| `test_task_tool_listing_has_no_other_subagents` | 列表恰好 3 条条目（防止其他默认子 Agent 混入） |
| `test_build_deep_agent_still_builds_graph` | 冒烟：关闭 general-purpose 后图仍可构建 |
| `test_subagent_specs_declare_phase_report_response_format` | 三个 spec 的 `response_format` 指向对应 schema 类 |
| `test_task_toolmessage_carries_parseable_phase_report` | 委派 prd-agent 后 task 的 ToolMessage 内容可被 `PrdPhaseReport.model_validate_json` 解析，且等于 `model_dump_json()` 规范化输出（不是原始文本透传） |
| `test_subagent_prompts_declare_schema_fields` | 三个「完成标准」节含 schema 关键字段名（同步契约，见 4.4） |
| `test_subagent_intermediate_tool_calls_stay_out_of_orchestrator_context` | 子 Agent 中间 `write_file` 不泄漏进主图上下文；文件确实写入 VFS backend（隔离的是上下文，不是存储）；主图恰好一条 task ToolMessage |
| `test_orchestrator_prompt_declares_delegation_conventions` | 编排者提示词含委派纪律关键词（绝不自行撰写 / 完整上下文 / 隔离上下文 / 结构化 / 不复述） |

运行：

```bash
uv run pytest tests/test_subagent_delegation.py -q   # 单独运行（8 passed）
uv run pytest tests/ -q                              # 全量（189 passed, 1 warning）
```

唯一 warning 是基线内已知的 `google/genai` DeprecationWarning，与本能力无关。

### 5.2 fake 模型脚本要点

测试不调用真实模型，`_FakeToolChatModel`（继承 `GenericFakeChatModel`）的
几处适配是行为等价的关键：

- **`_get_ls_params` provider 直通**：deepagents 按 provider 解析 harness
  profile，fake 模型默认报出的 provider 是自己的类名，永远命中不了注册项；
  测试里重写 `_get_ls_params(**kwargs)` 返回
  `ls_provider == agent_module.MODEL_PROVIDER`，模拟 `init_chat_model` 产物；
- **`model_name="gpt-4.1-mini"`**：langchain 的 `AutoStrategy` 依模型名回退
  规则选择结构化输出策略——带该 `model_name` 时走 ProviderStrategy（与真实
  默认模型一致），不设置则退化为 ToolStrategy，脚本化行为不同；
- **委派参数名是 `subagent_type`**（非 `name`）：脚本里
  `task(subagent_type="prd-agent", description=...)` 与真实工具 schema 一致；
- **ToolMessage 内容 = `structured_response.model_dump_json()`**：子 Agent 带
  `response_format` 结束时，deepagents 把结构化响应规范化序列化回传；若接线
  缺失则退化为子 Agent 原始文本透传，`content == report.model_dump_json()`
  断言即可识破。

sdd 独立图与异步委派侧的测试（`tests/test_async_sdd.py`）复用同一 fake 模式
（含独立图顶层 `response_format` 的回传形态差异），见 `async-subagents.md` §4.1。

## 6. 扩展指南

- **新增第四个专业子 Agent**：三步——
  1. 在 `schemas.py` 加一个 `XxxPhaseReport` Pydantic 模型（字段与该阶段的
     「完成标准」语义对齐）；
  2. 在 `agent.py` 加一个 spec 字典：`name` / `description`（写清阶段职责与
     委派时必须提供的上下文）/ `system_prompt` / `response_format` / `tools`，
     并加入 `build_deep_agent` 的默认 `subagents=[...]` 列表；
  3. 在 `prompts.py` 写对应指令，含逐字段的「完成标准」一节，并同步扩展
     `test_subagent_prompts_declare_schema_fields` 的断言（同步契约见 4.4）。
- **恢复 general-purpose 子 Agent**：删除 `agent.py:151` 的
  `register_harness_profile(...)` 调用（或把 `enabled` 改回 `True`）即可——
  deepagents 默认就会附加 general-purpose。注意这会重新打开绕过阶段结构的
  后门，`test_task_tool_exposes_only_named_subagents` 与
  `test_task_tool_listing_has_no_other_subagents` 会失败作为提醒；若确属
  有意为之，需同步修订这两条断言。
- **给某个子 Agent 换模型**：在其 spec 字典中加
  `"model": "provider:model-name"`（如 `"model": "anthropic:claude-sonnet-4-6"`）
  或直接给模型实例；未声明时沿用主 Agent 模型。换了模型后注意结构化输出
  策略可能变化（见故障排查第 3 条）。
- **修改阶段报告字段**：同步改两处——`schemas.py` 的模型定义与 `prompts.py`
  对应「完成标准」一节，两处必须一致，否则
  `test_subagent_prompts_declare_schema_fields` 失败即提示漂移。

## 7. 故障排查

| 症状 | 排查方向 |
|---|---|
| 编排者自行撰写阶段文档、不委派 | 委派纪律是提示词约束：检查 `ORCHESTRATOR_INSTRUCTIONS` 的「委派纪律（task）」一节（`prompts.py:48`）是否被改动；契约测试 `test_orchestrator_prompt_declares_delegation_conventions` 失败即提示漂移 |
| task 工具列表出现 general-purpose | 检查 `agent.py:151` 的 HarnessProfile 注册是否还在；测试环境下另查 `_get_ls_params` 是否仍返回 `agent_module.MODEL_PROVIDER`（provider 不匹配则 profile 不命中） |
| 结构化返回解析失败 / 回传了自由文本 | 检查模型是否支持原生结构化输出（ProviderStrategy）：不支持的模型 langchain 会退化为 ToolStrategy，子 Agent 需以结构化工具调用而非纯文本收尾；再检查 spec 的 `response_format` 是否被移除（缺失即透传原始文本） |
| 编排者收到的报告缺字段 / 字段语义不符 | prompts「完成标准」与 `schemas.py` 漂移：运行 `test_subagent_prompts_declare_schema_fields`，按 4.4 同步两侧 |
| task 工具描述里仍能看到 "general-purpose" 字样 | 属上游残留：deepagents 的静态使用说明会无条件提及该词，与是否暴露该子 Agent 无关；以「Available agent types」列表段为准（测试也只断言该段），编排者实际无法委派给它 |
| 修改 prompts 后提示词测试失败 | 「完成标准」/委派纪律的关键词断言与提示词文字严格一致；改措辞需同步改 `test_subagent_prompts_declare_schema_fields` / `test_orchestrator_prompt_declares_delegation_conventions` 的断言 |
