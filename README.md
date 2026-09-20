# PRD→BDD→SDD DeepAgent

基于 DeepAgents 的文档生成 Agent：用户提出产品需求后，按 **PRD → BDD → SDD** 三阶段
生成设计文档，阶段之间有人工确认门禁。文档直接写入 `DOCS_WORKSPACE_DIR`（默认
`./workspace`）下的真实磁盘目录。

- **PRD**：头脑风暴（≥3 个候选方向 + 取舍记录）→ 正式 PRD（REQ-xxx 需求 ID + 术语表）
- **BDD**：严格闭合的用户故事 —— 可追溯、三段式、Gherkin 四分支全覆盖（@normal/
  @alternative/@exception/@boundary）、词汇闭合，由确定性校验器强制执行
- **SDD**：每条用户故事一份设计文档（边界定义 / 接口契约 / 校验逻辑 / 异常边界处理 /
  测试审查定义）+ REQ↔US↔Scenario↔TestCase 四层追溯矩阵

后端为 `create_deep_agent(...)` 图，经 `agentseek-api dev` 托管；前端流式展示
todos、工具卡片与最终 markdown 回复。AgentSeek 仅作为外部模板与生命周期工具，
本项目行为声明在 `.agentseek/lifecycle.toml`。

## 快速开始

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
$EDITOR .env          # 填模型凭据；可选填 PENCLI_MCP_URL

uvx agentseek task sync
uvx agentseek task frontend
uvx agentseek dev
```

- LangGraph 后端默认 `http://127.0.0.1:2024`
- 前端默认 `http://127.0.0.1:5174`

## 冒烟测试

打开 `http://127.0.0.1:5174`，输入：

```text
我想做一个团队任务看板应用
```

预期行为：

- 出现 **PRD / BDD / SDD** 三个 todo 项
- prd-agent 产出 `workspace/team-task-board/prd/brainstorm.md` 与 `prd.md` 后，
  agent 汇报摘要并停下等待确认
- 回复「确认」→ bdd-agent 产出用户故事（校验通过）→ 再次门禁
- 回复「确认」→ sdd-agent 产出各故事 SDD 与追溯矩阵 → 完成清单
- 任何阶段回复修改意见 → 仅该阶段重跑修订

## 环境变量

| 变量 | 说明 |
|---|---|
| `DOCS_WORKSPACE_DIR` | 文档工作区根目录，默认 `./workspace` |
| `PENCLI_MCP_URL` | pencli 设计 MCP 的 streamable-http 地址；留空则降级运行 |
| 其余 | 模型 provider 与凭据、Tavily key 同原模板（见 `.env.example`） |
| `DOCS_BACKEND` | 文档存储后端：`memory` / `sqlite` / `disk`，默认 `disk` |
| `DOCS_SQLITE_PATH` | `sqlite` 后端的数据库文件路径，默认 `<DOCS_WORKSPACE_DIR>/.vfs.sqlite3` |

## 测试

```bash
uv run pytest -q
```
