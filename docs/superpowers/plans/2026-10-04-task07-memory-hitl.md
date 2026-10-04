# task07 实施计划：双层长期记忆 + 门禁真中断化 + 前端审批 UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 PRD→BDD→SDD deep agent 增加双层跨对话记忆（Agent 级 + 用户级）、把人工门禁改为真实 HITL 中断、给敏感工具加审批，并在前端渲染审批卡与提交恢复。

**Architecture:** 记忆经 `CompositeBackend(default=原 backend, routes={"/memories/agent/"→StoreBackend, "/memories/user/"→StoreBackend})` + `memory=[...]`（MemoryMiddleware 注入 system prompt）；门禁做成 `request_phase_approval` 无副作用工具走标准 HITL 协议（`allowed_decisions=["respond"]`），敏感工具（pencli_*、内置 delete）配 approve/reject；前端检测 `__interrupt__` 渲染 ApprovalDock 并以 `Command(resume={"decisions":[...]})` 恢复。

**Tech Stack:** deepagents 0.7.13、langchain>=1.0、langgraph（平台注入 checkpointer/store）、React+Vitest 前端。

**Spec:** docs/superpowers/specs/2026-10-04-task07-memory-hitl-design.md

## Global Constraints

- TDD：先写测试再实现；pytest 不得触发真实模型调用/网络（沿用
  `tests/test_subagent_delegation.py` 的 `_FakeToolChatModel` 模式与
  `tests/test_skills.py` 的 `_SystemCapturingChatModel` 模式）。
- 图不自带 Checkpointer；`store` 参数按任务指定（Orchestrator 测试可显式
  传 `InMemoryStore`，生产路径不传=平台注入）；不引 Postgres 依赖。
- prompts.py 分节冻结：只允许本计划指定的新增节与流程重写；
  校验器解析格式段、sub-agent 指令冻结。
- 中断协议逐字采用：恢复负载 `Command(resume={"decisions": [...]})`；
  决策对象 `{"type": "respond", "message": <用户原文>}` /
  `{"type": "approve"}` / `{"type": "reject", "message": ...}`；
  门禁工具名 `request_phase_approval`。
- 不修改 `research_deepagent/validators/`、不动 sdd_graph.py（记忆仅
  Orchestrator 层）。
- 全量测试保持通过（后端基线 201 passed，前端基线 50 passed）。
- 提交信息 conventional commits；提示词中文；实现期须实证处已在任务内标注。

## Review Focus（规格未覆盖、最可能咬人的五个输入）

1. **审批未决时用户直接发消息**——期望：composer 禁用，消息不被发送。
   （测试：Task 6 ` ApprovalDock` 未决守卫用例）
2. **门禁回复含否定词的修订意见**（如「不同意删除」）——期望：按
   提示词关键词约定解析为 revise 而非 approve。（测试：Task 5 契约测试
   钉住关键词清单含否定语义说明）
3. **记忆写入用 write_file 整体覆盖**——期望：提示词强制 `edit_file`
   保留既有条目。（测试：Task 5 契约测试钉住 edit_file + 保留措辞）
4. **pencli MCP 工具不可用（降级模式）**——期望：interrupt_on 不含
   pencli 条目且构建不报错。（测试：Task 4 降级用例）
5. **agentseek run 通道拒绝 Command 输入**——期望：前端 submitApproval
   报错可见而非静默失败，冒烟脚本给出明确结论。（测试：Task 6 错误态
   用例 + Task 7 冒烟）

---

### Task 1: 运行时身份解析（context.py）

**Files:**
- Create: `src/research_deepagent/context.py`
- Test: `tests/test_context.py`

**Interfaces:**
- Produces: `PipelineContext(user_id: str = "local-user")`（frozen dataclass）、
  `resolve_user_id(rt) -> str`、`resolve_assistant_id(rt) -> str`、
  `ASSISTANT_ID_FALLBACK = "research"`（Task 2 消费）。

- [ ] **Step 1: 写失败测试**

```python
"""运行时身份解析的单元测试（server_info 优先、context 回退）。"""
from types import SimpleNamespace

from research_deepagent.context import (
    ASSISTANT_ID_FALLBACK,
    PipelineContext,
    resolve_assistant_id,
    resolve_user_id,
)


def test_resolve_user_id_prefers_server_info():
    rt = SimpleNamespace(server_info=SimpleNamespace(user=SimpleNamespace(identity="u-1")))
    assert resolve_user_id(rt) == "u-1"


def test_resolve_user_id_falls_back_to_context():
    rt = SimpleNamespace(server_info=None, context=PipelineContext(user_id="u-2"))
    assert resolve_user_id(rt) == "u-2"


def test_resolve_user_id_defaults_to_local_user():
    rt = SimpleNamespace(server_info=None, context=None)
    assert resolve_user_id(rt) == "local-user"


def test_resolve_assistant_id_falls_back_to_constant():
    rt = SimpleNamespace(server_info=None)
    assert resolve_assistant_id(rt) == ASSISTANT_ID_FALLBACK == "research"
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/test_context.py -q`
Expected: FAIL（ModuleNotFoundError: research_deepagent.context）

- [ ] **Step 3: 最小实现**

```python
"""Runtime identity resolution for memory namespaces.

Deployment runtimes (LangSmith / agentseek) expose the signed-in user and
assistant through ``rt.server_info``; local/self-hosted runs fall back to the
invocation ``context`` (context_schema) and finally to constants.
"""
from dataclasses import dataclass

ASSISTANT_ID_FALLBACK = "research"


@dataclass(frozen=True)
class PipelineContext:
    user_id: str = "local-user"


def resolve_user_id(rt) -> str:
    server_info = getattr(rt, "server_info", None)
    user = getattr(server_info, "user", None) if server_info is not None else None
    if user is not None:
        return user.identity
    ctx = getattr(rt, "context", None)
    return getattr(ctx, "user_id", None) or "local-user"


def resolve_assistant_id(rt) -> str:
    server_info = getattr(rt, "server_info", None)
    assistant_id = getattr(server_info, "assistant_id", None) if server_info is not None else None
    return assistant_id or ASSISTANT_ID_FALLBACK
```

注意：`rt.context` 在 LangGraph 运行时上可能是属性或引发异常——实现时先
在 .venv 用一个真实 runtime 结构（或 `SimpleNamespace`）实证 `getattr`
行为，若 `context` 访问可能抛异常则用 try/except 包裹并保持返回值契约。

- [ ] **Step 4: 运行确认通过**

Run: `uv run pytest tests/test_context.py -q`
Expected: PASS（4 passed）

- [ ] **Step 5: 全量回归 + 提交**

```bash
uv run pytest tests/ -q
git add src/research_deepagent/context.py tests/test_context.py
git commit -m "feat(agent): runtime identity resolution for memory namespaces"
```

---

### Task 2: 双层记忆路由 + memory= 接线

**Files:**
- Modify: `src/research_deepagent/agent.py`（build_deep_agent 及模块层）
- Test: `tests/test_memory.py`（新）

**Interfaces:**
- Consumes: Task 1 的 `PipelineContext` / `resolve_user_id` /
  `resolve_assistant_id`。
- Produces: `build_deep_agent(model, *, backend, subagents=None, store=None)`
  —— 新增 `store` 关键字参数透传给 `create_deep_agent`；Orchestrator 获得
  `context_schema=PipelineContext` 与 `memory=["/memories/agent/AGENTS.md",
  "/memories/user/preferences.md"]`；backend 被包为
  `CompositeBackend(default=backend, routes=_memory_routes())`。

- [ ] **Step 1: 写失败测试**

```python
"""双层长期记忆的路由与隔离验证。

- /memories/user/ 按 user_id 隔离：A 的偏好不注入 B 的 system prompt；
- /memories/agent/ 跨用户共享：AGENTS.md 内容对所有用户注入；
- 缺失记忆文件跳过不报错；
- store 经 build_deep_agent(store=...) 透传。
"""
import itertools

import pytest
from langchain_core.language_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langgraph.store.memory import InMemoryStore

from research_deepagent.context import PipelineContext

PREF_A = "# 用户偏好\n- 代码注释用中文"
AGENTS_MD = "# Agent 指令\n- 汇报用中文"


class _SystemCapturingChatModel(GenericFakeChatModel):
    """捕获 system message 并立即给最终回答（模式同 test_skills.py）。"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.captured_system_texts: list[str] = []

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, **kwargs):
        system = next((m for m in messages if m.type == "system"), None)
        if system is not None:
            for block in (system.content if isinstance(system.content, list) else [system.content]):
                self.captured_system_texts.append(
                    block["text"] if isinstance(block, dict) else str(block)
                )
        return super()._generate(messages, **kwargs)


@pytest.fixture()
def memory_graph(monkeypatch, tmp_path):
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    store = InMemoryStore()
    # 路由会剥离 /memories/<scope>/ 前缀，Store key 为相对路径
    store.put(("local-user", "memories"), "/preferences.md",
              agent_module.create_file_data(PREF_A))
    store.put(("research", "memories"), "/AGENTS.md",
              agent_module.create_file_data(AGENTS_MD))
    graph = agent_module.build_deep_agent(
        model=_SystemCapturingChatModel(
            messages=iter([AIMessage(content="好的。")])),
        backend=agent_module.create_backend(root=tmp_path / "workspace"),
        store=store,
    )
    return agent_module, graph, store
```

> 注意：`_SystemCapturingChatModel` 若与 `GenericFakeChatModel` 的流式
> 路径不兼容（`_generate` 覆写不被调用），以 `tests/test_skills.py` 中
> 已验证的同名 helper 为准复制其实现。

```python
def test_user_memory_scoped_by_user_id(memory_graph):
    agent_module, graph, store = memory_graph
    result = graph.invoke(
        {"messages": [{"role": "user", "content": "你好"}]},
        context=PipelineContext(user_id="local-user"),
    )
    model = graph.builder.nodes["model"].runnable  # 内省路径须实证，见下
    system_text = "\n".join(_captured_texts(result))
    assert "代码注释用中文" in system_text


def _captured_texts(result):
    # 实证备选：若无法从 graph 内省捕获模型，直接对传入的 fake 模型实例断言
    ...
```

> 实现者须知：捕获 system prompt 的断言路径以 `tests/test_skills.py` 的
> 现成做法为准（它已经实证过 system message 捕获的可行方式）；本任务
> 不要发明新机制。上面的测试骨架给出**必须断言的四件事**：
> ① 用户 A 的偏好文本出现在 system prompt；② 换 user_id="user-b" 调用
> 后 A 的偏好**不**出现（隔离）；③ AGENTS_MD 文本对两个 user_id 都出现
> （agent 级共享）；④ `store` 中不存在的记忆文件（如未预置时）不报错。
> 断言结构照 `tests/test_skills.py` 改写，fixture 复用其 reload 模式。

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/test_memory.py -q`
Expected: FAIL（build_deep_agent 不接受 store 参数 / 无 memory 注入）

- [ ] **Step 3: 最小实现（agent.py）**

```python
from deepagents.backends import CompositeBackend, StoreBackend
from research_deepagent.context import PipelineContext, resolve_assistant_id, resolve_user_id
from deepagents.backends.utils import create_file_data  # re-export 供测试使用


def _memory_routes():
    return {
        "/memories/agent/": StoreBackend(
            namespace=lambda rt: (resolve_assistant_id(rt), "memories"),
        ),
        "/memories/user/": StoreBackend(
            namespace=lambda rt: (resolve_user_id(rt), "memories"),
        ),
    }


MEMORY_SOURCES = ["/memories/agent/AGENTS.md", "/memories/user/preferences.md"]


def build_deep_agent(model, *, backend, subagents=None, store=None):
    """...（保留原 docstring，追加 memory 说明）..."""
    return create_deep_agent(
        model=model,
        tools=[],
        system_prompt=ORCHESTRATOR_INSTRUCTIONS,
        subagents=subagents if subagents is not None else [prd_agent, bdd_agent, sdd_async_agent],
        backend=CompositeBackend(default=backend, routes=_memory_routes()),
        context_schema=PipelineContext,
        store=store,
        memory=MEMORY_SOURCES,
        middleware=[TodoListMiddleware()],
        skills=["/skills/"],
    )
```

（保持既有 harness profile 注册、sdd_async_agent 等原样；`CompositeBackend`
/`StoreBackend` 的真实导入路径先在 .venv 确认：`from deepagents.backends
import CompositeBackend, StoreBackend`。）

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `uv run pytest tests/test_memory.py tests/test_skills.py tests/test_subagent_delegation.py -q`
Expected: PASS；随后 `uv run pytest tests/ -q` 全绿
（注意：既有测试的 built_graph fixture 若因 build_deep_agent 新增参数/
CompositeBackend 包装而失败，修 fixture 而非放宽断言）。

- [ ] **Step 5: 提交**

```bash
git add src/research_deepagent/agent.py tests/test_memory.py
git commit -m "feat(agent): dual-scope long-term memory via composite store backend"
```

---

### Task 3: 门禁工具 + 敏感工具 interrupt_on

**Files:**
- Modify: `src/research_deepagent/tools.py`（新工具）
- Modify: `src/research_deepagent/agent.py`（interrupt_on 接线）
- Test: `tests/test_hitl.py`（新）

**Interfaces:**
- Consumes: 无（Task 2 已合入）。
- Produces: 工具 `request_phase_approval(phase: str, summary: str) -> str`
  （tool name 即 `"request_phase_approval"`）；`agent.py` 中
  `_build_interrupt_on() -> dict`（Task 5 提示词契约测试引用其行为）；
  Orchestrator 的 `create_deep_agent` 调用新增
  `interrupt_on=_build_interrupt_on()` 与 `tools=[request_phase_approval]`。

- [ ] **Step 1: 写失败测试**

```python
"""HITL 接线验证：门禁工具触发中断、敏感工具配置、降级模式。"""
import itertools

import pytest
from langchain_core.language_models import GenericFakeChatModel
from langchain_core.messages import AIMessage


class _FakeToolChatModel(GenericFakeChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


def _gate_call_model():
    gate_call = AIMessage(
        content="PRD 已完成，请求门禁审批。",
        tool_calls=[{
            "name": "request_phase_approval",
            "args": {"phase": "prd", "summary": "3 条需求"},
            "id": "call_gate_1",
            "type": "tool_call",
        }],
    )
    final = AIMessage(content="等待门禁结果。")
    return _FakeToolChatModel(messages=iter(
        itertools.chain([gate_call], itertools.repeat(final))))


@pytest.fixture()
def hitl_graph(monkeypatch, tmp_path):
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    graph = agent_module.build_deep_agent(
        model=_gate_call_model(),
        backend=agent_module.create_backend(root=tmp_path / "workspace"),
    )
    return agent_module, graph


def test_gate_tool_triggers_interrupt(hitl_graph):
    _, graph = hitl_graph
    result = graph.invoke({"messages": [{"role": "user", "content": "开始 PRD 阶段"}]})
    # 中断的呈现位置（result["__interrupt__"] 或 .interrupts）先在 .venv 实证；
    # 必须断言：action_requests[0] 的 name == "request_phase_approval"，
    # 且其 allowed_decisions == ["respond"]。
    ...


def test_interrupt_on_includes_sensitive_tools(hitl_graph):
    agent_module, _ = hitl_graph
    cfg = agent_module._build_interrupt_on()
    assert cfg["request_phase_approval"] == {"allowed_decisions": ["respond"]}
    assert cfg["delete"] == {"allowed_decisions": ["approve", "reject"]}
    for tool in agent_module.pencli_tools:
        assert cfg[tool.name] == {"allowed_decisions": ["approve", "reject"]}


def test_degraded_mode_without_pencli(monkeypatch, tmp_path):
    # pencli_tools 为空（MCP 不可用）时不报错、不含 pencli 条目
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    agent_module.pencli_tools = []
    assert not [k for k in agent_module._build_interrupt_on() if k.startswith("pencli")]
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/test_hitl.py -q`
Expected: FAIL（request_phase_approval 不存在 / build_deep_agent 未配 interrupt_on）

- [ ] **Step 3: 最小实现**

`tools.py` 追加：

```python
from langchain.tools import tool


@tool
def request_phase_approval(phase: str, summary: str) -> str:
    """请求人工门禁审批；本工具无副作用，真实结果由 HITL 的 respond 决策提供。"""
    return f"[门禁待决] {phase}: {summary}"
```

`agent.py`：

```python
from research_deepagent.tools import request_phase_approval

GATE_TOOL = "request_phase_approval"


def _build_interrupt_on() -> dict:
    cfg = {
        GATE_TOOL: {"allowed_decisions": ["respond"]},
        "delete": {"allowed_decisions": ["approve", "reject"]},
    }
    for tool in pencli_tools:
        cfg[tool.name] = {"allowed_decisions": ["approve", "reject"]}
    return cfg
```

`build_deep_agent` 的 `create_deep_agent(...)` 增加
`tools=[request_phase_approval]`（替换原 `tools=[]`）与
`interrupt_on=_build_interrupt_on()`。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `uv run pytest tests/test_hitl.py -q`，再 `uv run pytest tests/ -q`
Expected: 全绿。注意：门禁工具加入后，既有 test_todos_planning /
test_subagent_delegation 的 fake 模型若因额外 system prompt 内容或工具
绑定变化而失败，修 fixture 的消息脚本而非断言。

- [ ] **Step 5: 提交**

```bash
git add src/research_deepagent/tools.py src/research_deepagent/agent.py tests/test_hitl.py
git commit -m "feat(agent): phase approval gate and sensitive-tool interrupts"
```

---

### Task 4: 门禁流程提示词重写 + 记忆写入约定

**Files:**
- Modify: `src/research_deepagent/prompts.py`（仅 ORCHESTRATOR_INSTRUCTIONS）
- Test: `tests/test_hitl.py`（追加契约测试）

**Interfaces:**
- Consumes: Task 3 的 `GATE_TOOL = "request_phase_approval"`。
- Produces: 提示词三处文本——「长期记忆（memory）」新节、流程第 2 步
  （门禁中断）、流程第 3 步（恢复解析）；契约测试断言的关键词见 Step 1。

- [ ] **Step 1: 写失败契约测试**

```python
def test_orchestrator_prompt_declares_gate_flow():
    from research_deepagent.prompts import ORCHESTRATOR_INSTRUCTIONS as P
    # 门禁中断：汇报后调用门禁工具并暂停，不再"结束回合等待"
    assert "request_phase_approval" in P
    assert "结束回合等待" not in P.split("## 流程")[1].split("## 汇报要求")[0]
    # 解析规则：同意关键词 → approved；其余 → revise 带原文
    gate_section = P.split("## 流程")[1]
    assert "同意" in gate_section and "revise" in gate_section
    assert "意见原文" in gate_section
    # 拒绝反馈：敏感工具被拒时如实上报不重试
    assert "重试" in gate_section or "重试" in P


def test_orchestrator_prompt_declares_memory_conventions():
    from research_deepagent.prompts import ORCHESTRATOR_INSTRUCTIONS as P
    assert "## 长期记忆（memory）" in P
    assert "/memories/agent/AGENTS.md" in P and "/memories/user/preferences.md" in P
    assert "edit_file" in P and "保留" in P  # 禁止 write_file 整体覆盖既有记忆
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/test_hitl.py -q -k prompt`
Expected: FAIL

- [ ] **Step 3: 改写 ORCHESTRATOR_INSTRUCTIONS**

三处修改（其余冻结）：

1. 新节（插在「异步纪律（async task）」之后）：

```markdown
## 长期记忆（memory）

- 启动时已注入的记忆：Agent 级指令（/memories/agent/AGENTS.md，跨用户共享）
  与当前用户偏好（/memories/user/preferences.md，按用户隔离）；
- 用户明确要求记住偏好/指令时：先读取对应文件，再用 edit_file 追加或修订，
  保留其他既有条目，**禁止用 write_file 整体覆盖**；写入成功后才向用户确认；
- Agent 级指令只在用户要求"以后都这样做"时写入 AGENTS.md；个人偏好写
  preferences.md；不另建记忆文件。
```

2. 流程第 2 步改为：汇报阶段产出摘要后，**立即调用
   `request_phase_approval(phase, summary)`** 并中断等待人工决策；
   中断期间不执行其他动作。

3. 流程第 3 步改为：门禁恢复后，工具结果即用户回复原文——
   含「同意 / 批准 / 通过 / approve」语义 → gate=approved，写 Gate Log，
   推进下一阶段；其他内容一律视为修订意见（gate=revise），把意见原文
   传给对应阶段 sub-agent 重做。**注意否定语义**：「不同意删除」这类含
   否定词的回复按 revise 处理，不因出现"同意"二字误判。敏感工具被人工
   拒绝时，如实向用户上报裁决与原因，不重试同一调用。

- [ ] **Step 4: 运行确认通过 + 全量回归 + 提交**

```bash
uv run pytest tests/ -q
git add src/research_deepagent/prompts.py tests/test_hitl.py
git commit -m "feat(agent): gate-approval flow and memory write conventions in orchestrator prompt"
```

---

### Task 5: 门禁恢复路径测试（respond approve / revise）

**Files:**
- Test: `tests/test_hitl.py`（追加两个恢复用例）

**Interfaces:**
- Consumes: Task 3 的中断接线、Task 4 的提示词。

- [ ] **Step 1: 写失败测试**

```python
def _resume_model():
    # 回合1: 门禁调用 → (中断) → 回合2: 恢复后给最终回答
    gate_call = AIMessage(content="...", tool_calls=[{...同 Task 3...}])
    final = AIMessage(content="门禁已通过，推进 BDD 阶段。")
    return _FakeToolChatModel(messages=iter([gate_call, final]))


def test_gate_resume_with_approve(monkeypatch, tmp_path):
    # 第一次 invoke 触发中断；Command(resume={"decisions":[{"type":"respond",
    # "message": "同意，继续"}]}) 恢复；断言：
    # 1) 恢复后 messages 中 request_phase_approval 的 ToolMessage 内容 == "同意，继续"
    # 2) 图正常结束（最终 AIMessage 存在）
    ...


def test_gate_resume_with_revision(monkeypatch, tmp_path):
    # respond message = "把 REQ-003 的优先级改成 P1"
    # 断言 ToolMessage 内容 == 意见原文（编排者据此 revise；解析行为本身
    # 由模型执行，接线层只验证原文无损回传）
    ...
```

（实现者补全脚本细节；resume 的输入形态 `Command(resume={"decisions": [...]})`
与 `Command` 的导入（`langgraph.types`）先在 .venv 实证——包括在不带
checkpointer 的图上直接 `invoke(Command(resume=...), config)` 是否可行；
若必须 checkpointer，测试为图注入 `InMemorySaver` 并在报告中注明该偏差
及生产路径的差异。）

- [ ] **Step 2: 运行确认失败 → Step 3: 补测试细节使其通过（无需改产品代码，
  若发现产品缺陷则修产品代码）→ Step 4: 全量回归**

Run: `uv run pytest tests/test_hitl.py -q`，再 `uv run pytest tests/ -q`

- [ ] **Step 5: 提交**

```bash
git add tests/test_hitl.py
git commit -m "test(agent): gate resume paths for approve and revision decisions"
```

---

### Task 6: 前端审批 UI（ApprovalDock + resume 提交）

**Files:**
- Modify: `frontend/src/lib/stream.ts`、`frontend/src/hooks/useAgentStream.ts`（若存在，
  以实际文件为准；先读再改）
- Create: `frontend/src/components/approval/ApprovalDock.tsx`
- Test: `frontend/src/components/approval/ApprovalDock.test.tsx` 等

**Interfaces:**
- Produces: `useAgentStream` 新增 `pendingApproval` 与 `submitApproval(decisions)`；
  `pendingApproval = { actionRequests, reviewConfigs } | null`，其中
  actionRequests 元素含 `{ name, arguments|args }`，reviewConfigs 元素含
  `{ action_name, allowed_decisions }`（以实测中断事件形态为准）。

- [ ] **Step 1: 实证中断事件形态与提交通道**

读 `frontend/src/lib/stream.ts` 与 `useAgentStream` 的实现，确认流式通道
（LangGraph SDK / agentseek API）。在 .venv 侧或 SDK 文档确认：
① 中断在流事件中的形态（`__interrupt__` 元组）；② run 提交接口的 input
是否接受 `Command(resume=...)`（spec §10 风险项）。若②不成立，停止并在
报告中 BLOCKED（控制器裁决回退方案），不得擅自改用未确认通道。

- [ ] **Step 2: 写失败组件测试**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalDock } from "./ApprovalDock";

const gateRequest = {
  actionRequests: [{ name: "request_phase_approval", args: { phase: "prd", summary: "3 条需求" } }],
  reviewConfigs: [{ action_name: "request_phase_approval", allowed_decisions: ["respond"] }],
};

describe("ApprovalDock", () => {
  it("renders respond textarea for gate approval", () => {
    render(<ApprovalDock pendingApproval={gateRequest} onSubmit={vi.fn()} />);
    expect(screen.getByText(/阶段门禁/)).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("renders approve/reject for sensitive tools", () => {
    render(<ApprovalDock pendingApproval={{
      actionRequests: [{ name: "pencli_x", args: {} }],
      reviewConfigs: [{ action_name: "pencli_x", allowed_decisions: ["approve", "reject"] }],
    }} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /批准/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /拒绝/ })).toBeTruthy();
  });

  it("submits respond decision with user text", () => {
    const onSubmit = vi.fn();
    render(<ApprovalDock pendingApproval={gateRequest} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "同意，继续" } });
    fireEvent.click(screen.getByRole("button", { name: /提交/ }));
    expect(onSubmit).toHaveBeenCalledWith([{ type: "respond", message: "同意，继续" }]);
  });

  it("renders nothing when no pending approval", () => {
    const { container } = render(<ApprovalDock pendingApproval={null} onSubmit={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: 运行确认失败 → Step 4: 实现 ApprovalDock**

组件要点：`pendingApproval === null` 时不渲染；按
`allowed_decisions` 分支渲染（respond→文本框+提交；approve/reject→按钮，
reject 展开意见输入）；决策数组与 actionRequests 顺序一一对应。

- [ ] **Step 5: useAgentStream 集成 + 未决守卫 + 错误态测试**

- 从流事件提取 `__interrupt__` → `pendingApproval`（提取逻辑放
  `lib/stream.ts`，附单测）；
- `submitApproval(decisions)`：以当前 thread_id 提交
  `Command(resume={"decisions": decisions})`；提交失败（通道拒绝
  Command）时置 error 态并展示——**不得静默吞错**（Review Focus 5 的
  前端半边）；
- `pendingApproval` 非空时 composer 提交禁用（Review Focus 1）；
  相应用例加入 `ApprovalDock.test.tsx` 或 `useAgentStream` 测试。

- [ ] **Step 6: 全部前端测试 + 提交**

```bash
cd frontend && npm test -- --run
git add frontend/src
git commit -m "feat(frontend): approval dock for hitl interrupts with resume submission"
```

---

### Task 7: 冒烟脚本门禁用例 + 两篇开发文档

**Files:**
- Modify: `scripts/async_smoke.py`（追加门禁往返用例，可选执行）
- Create: `docs/dev/memory.md`、`docs/dev/hitl.md`
- Test: 运行全量确认数字

**Interfaces:**
- Consumes: 最终代码形态（Task 1-6 全部）。

- [ ] **Step 1: 冒烟脚本追加门禁往返段**（不进 pytest）：SDK 起 run →
  检测中断 → 打印 action_requests → 提交 respond 决策 → 断言 run 完成。
  顶部 docstring 更新前置条件与「agentseek Command 支持」的验证结论
  （沿 Task 6 Step 1 的实证结果填写）。

- [ ] **Step 2: 写 docs/dev/memory.md**：对照系列风格；内容含——双层
  namespace 表（agent→(assistant_id,"memories")，user→(user_id,"memories")）、
  CompositeBackend 路由 + 缺失文件跳过、写入约定与 edit_file 契约、
  平台注入 store 说明与 PostgresStore 升级路径、身份注入接入点
  （context.py）、故障排查（偏好未注入→预置与 thread_id、写入覆盖→
  edit_file 约定、隔离失效→namespace 解析）。

- [ ] **Step 3: 写 docs/dev/hitl.md**：门禁协议（request_phase_approval
  + respond 即门禁）、决策类型使用矩阵（respond=门禁、approve/reject=
  敏感工具、edit=defer）、前端审批流、拒绝反馈约定、风险表（含
  "同意"文本解析的已知代价与方案 B 升级路径）、故障排查。

- [ ] **Step 4: 核对所有 file:line 引用（Read 逐一核实）+ 全量测试**

```bash
uv run pytest tests/ -q    # 数字写入两篇文档
```

- [ ] **Step 5: 提交**

```bash
git add scripts/async_smoke.py docs/dev/memory.md docs/dev/hitl.md
git commit -m "docs: add memory and hitl development guides with gate smoke case"
```

---

## 任务间关系

| 任务对 | 共享面 | 结论 |
|---|---|---|
| T1→T2 | context.py（身份解析） | T2 消费 |
| T2→T3 | agent.py（build_deep_agent 签名 +2 参数） | T3 在其上叠 interrupt_on |
| T3→T4 | GATE_TOOL 名与 interrupt 行为 | T4 提示词与契约测试 |
| T4→T5 | 门禁工具 + 提示词 | T5 恢复路径测试 |
| T6 | 前端独立，依赖 T3 的中断形态（实证） | 可在 T4 后并行理解，顺序派发 |
| T7 | 文档消费最终形态 | 最后 |

## Self-Review 记录

- Spec 覆盖：§4.1→T1、§4.2→T2+T4（提示词）、§4.3→T3+T4、§4.4→T6、§5→T5+T7、
  §6→T2/T3/T5/T6 测试、§7→T7、§10→T6 Step1 + T7 冒烟。无缺口。
- 占位符：测试骨架中的 `...` 均附有"以哪个已验证模式为准"的指示与必须
  断言的清单，属实现者实证授权而非 TBD；无 "TBD/TODO" 字样。
- 类型一致性：`build_deep_agent(model, *, backend, subagents=None, store=None)`
  贯穿 T2/T3；`request_phase_approval(phase, summary)` 贯穿 T3/T4/T5/T6。
- Review Focus 五项均有归属测试（1→T6、2→T4、3→T4、4→T3、5→T6+T7）。
