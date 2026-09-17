# PRD→BDD→SDD 文档生成 Deep Agent 设计

日期：2026-09-16
状态：已确认（方案 B：编排者 + 三个阶段 Subagent）

## 1. 背景与目标

将现有 Research DeepAgent 脚手架改造为文档生成 Deep Agent：用户提出产品需求后，
按 **PRD → BDD → SDD** 三阶段生成高质量设计文档，阶段之间设置人工确认门禁。

- **PRD**：根据用户需求进行头脑风暴（发散 → 收敛），产出正式产品需求文档
- **BDD**：产出严格且闭合的用户故事（可追溯、分支全覆盖、词汇闭合，校验工具强制执行）
- **SDD**：按用户故事逐条完成边界定义、校验逻辑、测试审查定义

## 2. 已确认的决策

| 决策点 | 结论 |
|---|---|
| pencli MCP | 已存在的 MCP 服务，通过 HTTP/SSE URL 连接，工具能力运行时自动发现 |
| 流程模式 | 阶段门禁：每阶段产出后停下等用户确认/修改，认可后进入下一阶段 |
| 文档位置 | 真实磁盘目录（`FilesystemBackend` 挂载），不是虚拟文件系统 |
| 旧研究能力 | 保留 tavily 搜索，并入 PRD 阶段；research-agent subagent 移除 |
| 方案 | B：编排者 + 三个阶段 Subagent，回合制门禁，前端零改动 |

## 3. 总体架构

```
用户 ──chat──▶ 编排者 Orchestrator (create_deep_agent, backend=FilesystemBackend)
                  │ task()
                  ├─▶ prd-agent   工具: tavily_search, pencli MCP 工具, write_file
                  ├─▶ bdd-agent   工具: validate_user_stories, write_file
                  └─▶ sdd-agent   工具: validate_traceability, write_file
                  ▼
        workspace/<project-slug>/  (真实磁盘目录)
```

- `create_deep_agent` 挂 `backend=FilesystemBackend(root_dir=WORKSPACE_ROOT)`
  （deepagents 0.5.3 已确认支持），agent 的 `write_file`/`read_file` 直接读写真实磁盘。
- `WORKSPACE_ROOT` 由 `.env` 的 `DOCS_WORKSPACE_DIR` 配置，默认 `./workspace`；
  每个项目一个 `<project-slug>/` 子目录（slug 由 Orchestrator 从需求标题生成）。
- 模型初始化逻辑（provider 解析、api key、base_url）沿用现有 `agent.py`，不改。

## 4. 目录布局（每阶段产物）

```
workspace/<slug>/
  00_meta/project_state.md      # 阶段状态机 + 门禁记录（新回合恢复现场用）
  prd/brainstorm.md             # 头脑风暴：发散方案、竞品调研、取舍记录
  prd/prd.md                    # 正式 PRD（含需求 ID：REQ-xxx，术语表）
  bdd/user_stories.md           # 严格闭合的用户故事 + Gherkin 场景
  sdd/sdd-US-xxx.md             # 每个用户故事一份
  sdd/traceability.md           # REQ↔US↔场景↔测试用例 追溯矩阵
```

## 5. 门禁流程（回合制）

1. 用户提需求 → Orchestrator `write_todos` 建三阶段计划 → 委派 prd-agent
2. prd-agent 产出 brainstorm.md + prd.md → Orchestrator 摘要汇报，**结束回合**：
   "PRD 已完成，请确认或提出修改"
3. 用户确认 → 委派 bdd-agent；用户提修改 → 只重跑 prd-agent 修订
4. BDD 产出且校验通过 → 门禁 → SDD 产出且追溯校验通过 → 门禁 → 完成
5. 断点恢复：新回合 Orchestrator 先读 `project_state.md` 判断当前阶段，
   不重复已完成工作；每次门禁结果（确认/修改意见）记录进 `project_state.md`

前端零改动：门禁即聊天回合，todos 面板天然展示三阶段进度。

## 6. 三阶段文档规范

### 6.1 PRD 阶段（prd-agent）—— 头脑风暴驱动

- 先发散：围绕用户需求生成 ≥3 个候选产品方向（目标用户、核心价值、差异化点），
  需要时用 tavily 搜市场/竞品佐证，pencli MCP 工具用于设计相关产出
- 再收敛：记录取舍理由到 `brainstorm.md`，选定方向后写正式 `prd.md`
- `prd.md` 强制结构：
  1. 背景与目标
  2. 用户画像
  3. 范围（in/out）
  4. 功能需求（每条唯一 `REQ-xxx` ID + 优先级 P0/P1/P2 + 验收要点）
  5. 非功能需求
  6. 术语表（实体与角色定义）
  7. 未决问题
- 术语表是"闭合"的关键：BDD 只允许引用 PRD 术语表内定义的实体和 REQ ID

### 6.2 BDD 阶段（bdd-agent）—— 严格且闭合的用户故事

每条故事 `US-<epic>-<序号>` 必须满足（校验工具强制执行）：

1. **可追溯**：`Covers: REQ-xxx` 引用真实存在的 PRD 需求 ID，
   每条 REQ 至少被一条 US 覆盖
2. **三段式**：As a（角色来自术语表）/ I want / So that 缺一不可
3. **Gherkin 场景**：每条验收标准一个 Scenario，Given/When/Then 完整，
   Then 必须是可断言结果
4. **分支闭合**：每个场景组必须覆盖四类分支并打标签
   `@normal` `@alternative` `@exception` `@boundary`，缺失即违规
5. **词汇闭合**：禁止"等等 / TBD / optionally / 如有必要"类开放词汇；
   实体引用仅限 PRD 术语表

### 6.3 SDD 阶段（sdd-agent）—— 按用户故事逐条产出

固定五节模板（`sdd-US-xxx.md`）：

1. **边界定义**：in/out of scope、输入域、前置条件、不做什么
   （对应 US 的 alternative/boundary 分支）
2. **接口与数据契约**：字段、类型、约束
3. **校验逻辑**：字段级规则表（规则 / 触发条件 / 错误码 / 错误信息），
   每条规则必须能对应到一个 `@exception` 场景
4. **异常与边界处理**：对应 US 的 exception/boundary 场景逐一给出处理方式
5. **测试审查定义**：每个 BDD Scenario 映射测试用例
   （用例 ID / 类型 / 优先级 / 通过标准）+ 评审 checklist

收尾写 `traceability.md` 追溯矩阵，`validate_traceability` 校验
REQ↔US↔Scenario↔TestCase 四层全覆盖无孤儿。

## 7. 自定义工具

| 工具 | 类型 | 说明 |
|---|---|---|
| `validate_user_stories(prd_path, bdd_path)` | 纯 Python 确定性校验器 | 解析 PRD 与 BDD 两份 markdown，按 §6.2 规则逐条校验，返回结构化违规列表（规则编号 + 位置 + 修复建议）。bdd-agent 必须修复全部违规后才能交付，最多 3 轮 |
| `validate_traceability(workspace_dir)` | 纯 Python 确定性校验器 | REQ↔US↔Scenario↔TestCase 四层追溯 + 孤儿检测 |
| pencli MCP 工具 | `langchain-mcp-adapters` 动态发现 | `.env` 配置 `PENCLI_MCP_URL`（streamable-http），启动时连接并注入 prd-agent；连接失败降级为无 pencli 工具并警告，不阻断流程 |
| `tavily_search` | 现有工具保留 | 仅供 prd-agent 做市场/竞品调研 |

新增依赖：`langchain-mcp-adapters`（项目已有 `mcp>=1.27.1`）。

## 8. 错误处理

- 校验 3 轮不过 → subagent 带违规清单结束，Orchestrator 向用户如实汇报并请求人工裁决
- pencli MCP 不可用 → 降级运行（无设计工具），日志与回复中明确告知
- 门禁中被用户打断/修改 → 只重跑受影响阶段，已完成文档不动
- 断点恢复失败（project_state.md 损坏）→ Orchestrator 列出现有文件，请用户指定恢复点

## 9. 测试策略

- **单元测试**：两个校验器是纯函数，pytest 覆盖每条违规规则 + 合规用例
- **冒烟测试**：graph 可构建（含 MCP 不可用降级路径）
- **端到端**：手动冒烟走一遍三阶段 + 一次门禁修改重跑

## 10. 实施范围（供计划阶段拆解）

- `src/research_deepagent/prompts.py`：重写为编排者 + 三阶段指令
- `src/research_deepagent/tools.py`：保留 tavily，新增两个校验器
- `src/research_deepagent/mcp_tools.py`：新增，pencli MCP 加载与降级
- `src/research_deepagent/agent.py`：重接 subagents / backend / graph 装配
- `.env.example`：新增 `DOCS_WORKSPACE_DIR`、`PENCLI_MCP_URL`
- `README.md`：更新为文档生成 Agent 的说明与冒烟步骤
- 前端：不改
