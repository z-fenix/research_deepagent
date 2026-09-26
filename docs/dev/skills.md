# 开发文档：Skills 渐进式披露（SkillsMiddleware / VFS workspace 形态）

> 对应《Deep Agents》第 7 章「Skills」。本文面向本仓库的开发者，
> 说明 Skills 能力以 VFS workspace 形态在本仓库的落地方式、渐进式披露
> 的注入与读取路径、设计决策、测试与扩展点。sdd 独立图的异步委派背景见
> `async-subagents.md`（第 6 章）。

## 1. 能力概述

Skills 把「模型可能用到的操作指引」存为可寻址的文档，**按需加载**而不是
全部塞进上下文。本仓库的落地形态：

- 存放：VFS workspace 内的 `/skills/<name>/SKILL.md`，对应磁盘上的
  `<WORKSPACE_ROOT>/skills/<name>/SKILL.md`（disk backend，根目录即
  `WORKSPACE_ROOT`）；
- 挂载：编排者图与 sdd 独立图两处 `skills=["/skills/"]`
  （`agent.py:246` / `sdd_graph.py:41`）；
- 目前只有一个种子 skill：`sdd-quality-checklist`（SDD 写作质量清单）。

渐进式披露（Progressive Disclosure）三级加载在本仓库的路径形态
（注入形态已在 .venv 对 deepagents 0.7.13 逐一实证）：

| 级别 | 路径形态 |
|---|---|
| Level 1：元数据注入 | `SkillsMiddleware.wrap_model_call` 把 `## Skills System` 一节作为**独立的 text block 追加到 system message 的 content block 列表**（不是拼接进同一字符串）。条目形态为 `- **<name>**: <description>` + ``  -> Read `/skills/<name>/SKILL.md` for full instructions``——Level 2 的读取路径由这一行给出 |
| Level 2：按需读取 | 模型判断当前任务与 skill 相关时，调 `read_file("/skills/<name>/SKILL.md")`；ToolMessage 内容为**行号前缀文本**（如 ` 1  ---`） |
| Level 3：正文引导的进一步资源 | SKILL.md 正文引用的其他文件再按需读取。本仓库种子未使用 |

Level 1 只花几十 token 让模型「知道有这个东西、什么时候该读」；完整的
清单正文只在 SDD 阶段真正相关时进入上下文。

## 2. 设计决策

| 决策 | 理由 |
|---|---|
| 存放在 VFS workspace（disk backend，根 = `WORKSPACE_ROOT`） | 备选方案是把 skill 目录用只读后端挂进来（deepagents 另有 `FilesystemBackend` 指向任意目录、`StoreBackend` / `CompositeBackend` 可组合出只读路由）。选 VFS workspace 的核心理由：**Agent 可写 = 渐进式披露的记忆**——运行期 Agent 自己写一份 `workspace/skills/<name>/SKILL.md`，下次会话就会被扫到，skill 集合随项目演化，不需要改代码重新部署；且 skills 与项目文档共用同一 backend，路径协议（`/skills/...`）与文档路径一致 |
| 不设 deny（不做只读路由） | deepagents 的 CompositeBackend 可以对路径配 deny 规则把 `/skills/` 变只读，但这会放弃上面的运行期记忆能力。风险可控：skill 内容是提示词层材料（advisory），被误写的最坏后果是指引质量下降，不会破坏机器校验；种子文件入库、运行期改动留在磁盘上，可 diff 可还原 |
| 种子 skill 选 advisory 内容 | SDD 的机器契约（`@normal` / `@exception` / `@boundary` 标签、行格式、分支闭合规则）由 `validators/` 解析 + `prompts.py` 逐字约束。若 skill 正文复述这些格式，校验器一改 skill 就漂移成错误指引。advisory 清单只讲「值得检查什么」（边界完备性、契约约束列、校验规则与异常场景对应、pass 标准可判定性），与强制解析格式解耦，**无漂移风险** |
| 种子入库、运行产物不入库 | `.gitignore` 把 `workspace/` 整体忽略改为 `workspace/*` + `!workspace/skills/`——单层通配 + 豁免 skills 子树，保持「生成文档不入库」原意，未来新增种子 skill 自动可入库 |
| frontmatter `name` 必须与目录名一致 | 目录即寻址键（`/skills/<name>/SKILL.md`）；deepagents 按 Agent Skills 规范校验名字，不一致仅告警不拒绝（向后兼容），但保持一致避免注入元数据与实际路径对不上 |

## 3. 关键文件

| 文件 | 职责 |
|---|---|
| `workspace/skills/sdd-quality-checklist/SKILL.md` | 种子 skill（50 行，≤100 行约定）：frontmatter（`:1`-`:4`，中文 description 写具体触发条件）、开篇 advisory 声明（`:6`-`:9`）、四节清单（边界定义完备性 `:11` / 接口与数据契约 `:20` / 校验规则与异常场景对应 `:28` / pass 标准可判定性 `:37`）、使用方式（`:46`） |
| `src/research_deepagent/agent.py` | 编排者挂载点：`build_deep_agent` 的 `create_deep_agent(..., skills=["/skills/"])`（`agent.py:246`）；docstring 记录「缺目录仅告警」实证结论 |
| `src/research_deepagent/sdd_graph.py` | sdd 独立图挂载点：`build_sdd_graph` 内同样 `skills=["/skills/"]`（`sdd_graph.py:41`）——异步委派的远端图也需要 SDD 质量清单 |
| `.gitignore` | `workspace/*` + `!workspace/skills/`（种子入库、运行产物不入库） |
| `tests/test_skills.py` | 渐进式披露接线与行为验证（5 用例，见 §4） |

## 4. 测试

### 4.1 `tests/test_skills.py`

| 用例 | 验证点 |
|---|---|
| `test_seed_skill_file_constraints` | 种子文件存在；frontmatter `name` 与目录名一致；description 含触发条件关键词；≤100 行；正文声明 advisory |
| `test_level1_skill_metadata_injected_into_system_message` | 首回合 system message 含 `## Skills System` 一节、`- **sdd-quality-checklist**:` 条目行、``  -> Read `/skills/sdd-quality-checklist/SKILL.md` `` 路径行、description 全文 |
| `test_level1_directory_without_skill_md_not_injected` | 扫描约定负例：缺 SKILL.md 的子目录（`not-a-skill`）不注入元数据，正例仍注入 |
| `test_level2_on_demand_read_of_skill_body` | 脚本化 fake 模型先 `read_file` SKILL.md 再收尾；ToolMessage 内容含正文关键词（边界定义完备性 / 可判定性 / 异常场景）——行号前缀形态下的关键词断言 |
| `test_sdd_graph_mounts_workspace_skills` | sdd 独立图同样注入 Level 1 元数据（`build_sdd_graph` 的 skills 接线） |

fixture 说明：`seeded_agent_module` 在既有 `built_agent_module`（reload +
`DOCS_WORKSPACE_DIR` 指向 tmp_path）之上，**把 repo 中真实的种子 SKILL.md
复制进临时 workspace**——既隔离测试运行产物，又测到真实提交的种子内容
（非内联字符串副本）。捕获 system message 用
`_SystemCapturingChatModel`（在 `_FakeToolChatModel` 之上以 pydantic 字段
声明捕获列表，按 text block 拼出纯文本）。

运行：

```bash
uv run pytest tests/test_skills.py -q   # 单独运行（5 passed）
uv run pytest tests/ -q                 # 全量（201 passed, 1 warning）
```

唯一 warning 是基线内已知的 `google/genai` DeprecationWarning，与本能力无关。

### 4.2 实证形态速查（写测试断言前先对照）

- 注入位置：system message 的 content 是 **text block 列表**，skills 一节是
  追加的独立 block（断言时需按 block 拼接，见 `_text_blocks`）；
- 条目格式：`- **<name>**: <description>` 与
  ``  -> Read `/<source>/<name>/SKILL.md` for full instructions``
  （注意 Read 行有两个前导空格）；
- Level 2 返回：`read_file` 的 ToolMessage 为行号前缀文本（` 1  ---` 形态），
  按关键词断言而非精确比对；
- 扫描约定：`skills=["/skills/"]` 只对源目录 `ls` 出的**一级子目录**尝试
  读取 `<dir>/SKILL.md`，缺失则静默跳过（不注入、不报错）。

## 5. 扩展指南

- **新增第二个 skill**：
  1. 建 `workspace/skills/<name>/SKILL.md`——frontmatter `name` 必须与目录名
     一致，`description` 用中文写**具体触发条件**（模型只凭 Level 1 的这一行
     决定是否读正文）；正文建议保持 advisory 风格与 ≤100 行约定；
  2. **无需改挂载代码**：两处 `skills=["/skills/"]` 的扫描是动态的，新目录
     重启 `langgraph dev` 后自动被发现并注入；
  3. 如需契约锁定（防内容漂移），按 `test_seed_skill_file_constraints` 的
     模式在 `tests/test_skills.py` 加断言；注意 `seeded_agent_module` fixture
     目前只复制种子目录，新 skill 需在 fixture 中一并复制进 tmp workspace。
- **为特定 sub-agent 单独挂 skills**：`create_deep_agent(skills=...)` 是
  **图级**注入，继承规则（deepagents 0.7.13）：
  - 默认 general-purpose 子 Agent 继承主图的 skills；
  - `mode="fork"` 的子 Agent 继承父图 skills，且 spec 禁止自带 `skills`；
  - **具名子 Agent 不继承**——需要在 spec 字典显式加 `"skills": [...]`
    （SubAgent TypedDict 的可选字段，装配时为该子 Agent 单独加
    SkillsMiddleware）。
  注意：本仓库同步子 Agent `prd_agent` / `bdd_agent` 当前**未挂 skills**，
  它们的上下文里没有 `## Skills System` 一节；SDD 阶段则由独立图
  `sdd_graph.py` 自己挂载。若 prd/bdd 需要清单，在其 spec 字典加
  `"skills": ["/skills/"]` 即可。
- **把 skills 变只读**：见 §2 第 2 条的代价分析；确需禁止 Agent 运行期改
  skill 时，用 CompositeBackend 对 `/skills/` 配 deny 路由，并接受失去
  运行期新增能力的权衡。

## 6. 故障排查

| 症状 | 排查方向 |
|---|---|
| system message 里没有 `## Skills System` | ① 挂载参数是否还在（`agent.py:246` / `sdd_graph.py:41`）；② 目录位置：`/skills/` 是 **VFS 内路径**，对应磁盘 `<WORKSPACE_ROOT>/skills/`——`DOCS_WORKSPACE_DIR` 指错根目录即扫不到；③ 子目录里必须有 `SKILL.md`，缺则静默跳过（负例测试可复现该行为）；④ 是否在看 prd/bdd 子 Agent 的上下文（具名子 Agent 未挂 skills，见 §5） |
| 提示词里出现 "Skills Skills" 字样 | 上游观感行为：source 标签对叶节点 `skills` 且无父目录时退化为 `Skills`，位置行渲染成 `**Skills Skills**: /skills/`。仅影响提示词观感，不影响功能；如要消除，改传 `(path, label)` 元组 `skills=[("/skills/", "Workspace")]`（本仓库为保持与 brief 逐字一致未做） |
| skill 正文读取失败 / Level 2 拿不到内容 | 读取路径必须是注入条目里给的 VFS 路径 `/skills/<name>/SKILL.md`；backend 根（`WORKSPACE_ROOT`）变化后旧路径失效；确认读的是文件而非目录 |
| 新加的 skill 没被注入 | 目录层级必须恰好一层：`/skills/<name>/SKILL.md`——扫描只认一级子目录下的 `SKILL.md`，更深层不扫；`langgraph dev` 需重启才会重新扫描（构建期注入元数据）；frontmatter 缺 `name`/`description` 时条目不完整 |
| frontmatter `name` 与目录名不一致 | deepagents 仅告警不拒绝（向后兼容），但寻址以目录为准；保持两者一致，避免 Level 1 元数据与实际读取路径错位 |
| skill 内容与校验器要求打架 | 种子 skill 是 advisory 性质，不承诺机器契约；若有人往 skill 里复述了校验器强制格式（如 `@exception` 标签规则），按 §2 第 3 条删除该段——机器契约只活在 `prompts.py` + `validators/` + 对应测试里 |
