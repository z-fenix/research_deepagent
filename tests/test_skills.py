"""workspace skills（VFS workspace 形态）：种子 skill + 两处挂载 + 渐进式披露。

覆盖四件事：
1. 种子文件约束：workspace/skills/sdd-quality-checklist/SKILL.md 存在、
   name 与目录名一致、≤100 行、advisory 声明在正文里；
2. Level 1（元数据注入）：编排者图首回合的 system message 含 skill 的
   name / description / SKILL.md 路径（注入形态已在 .venv 实证：
   SkillsMiddleware.wrap_model_call 把 "## Skills System" 一节作为独立
   text block 追加到 system message，条目形态为
   "- **<name>**: <description>" + "  -> Read `<path>` for full instructions"；
   缺 SKILL.md 的子目录不产生条目）；
3. Level 2（按需读取）：fake 模型先 read_file SKILL.md 再收尾，
   ToolMessage 内容含正文关键内容（read_file 返回行号前缀文本，
   已在 .venv 实证）；
4. sdd 独立图同样挂载 skills=["/skills/"]（system message 同样注入）。

fixture 沿用 tests/test_subagent_delegation.py 的 built_agent_module reload
模式；skills 内容落在磁盘 workspace，因此把 repo 中真实的种子文件复制进
tmp workspace（隔离运行产物，同时测到真实提交内容），而不是把
DOCS_WORKSPACE_DIR 指向 repo 内真实目录（会污染工作区、跨测试共享状态）。
"""

import itertools
import shutil
from pathlib import Path

import pytest
import yaml
from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langgraph.store.memory import InMemoryStore

from tests.test_subagent_delegation import (
    _FakeToolChatModel,
    built_agent_module,  # noqa: F401 - re-exported fixture
)

REPO_ROOT = Path(__file__).resolve().parents[1]
SEED_DIR_NAME = "sdd-quality-checklist"
SEED_SKILL_MD = REPO_ROOT / "workspace" / "skills" / SEED_DIR_NAME / "SKILL.md"
SKILL_PATH = f"/skills/{SEED_DIR_NAME}/SKILL.md"


class _SystemCapturingChatModel(_FakeToolChatModel):
    """在 _FakeToolChatModel 之上捕获每回合收到的 system message 文本。

    pydantic 字段声明（而非运行时属性赋值），否则 GenericFakeChatModel
    会拒绝未知属性。
    """

    captured_system_texts: list[str] = []

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):  # noqa: ANN001, ANN003, ANN202
        for message in messages:
            if isinstance(message, SystemMessage):
                self.captured_system_texts.append(_text_blocks(message))
        return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)


def _text_blocks(message) -> str:  # noqa: ANN001
    """拼出 system message 的纯文本（内容可能是 str 或 text block 列表）。"""
    if isinstance(message.content, str):
        return message.content
    return "\n".join(
        block.get("text", "") for block in message.content if isinstance(block, dict)
    )


def _copy_seed_into(workspace: Path) -> None:
    """把 repo 中真实的种子 SKILL.md 复制进临时 workspace（测到真实内容）。"""
    target = workspace / "skills" / SEED_DIR_NAME
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy(SEED_SKILL_MD, target / "SKILL.md")


@pytest.fixture()
def seeded_agent_module(built_agent_module):
    """built_agent_module 之上，把真实种子 skill 复制进临时 workspace。"""
    agent_module, workspace = built_agent_module
    _copy_seed_into(workspace)
    return agent_module, workspace


def _seed_frontmatter() -> dict:
    match = SEED_SKILL_MD.read_text(encoding="utf-8").split("---", maxsplit=2)
    return yaml.safe_load(match[1])


def test_seed_skill_file_constraints():
    """种子文件存在、name 与目录一致、≤100 行、正文声明 advisory 性质。"""
    assert SEED_SKILL_MD.is_file()
    frontmatter = _seed_frontmatter()
    assert frontmatter["name"] == SEED_DIR_NAME
    assert "撰写或审查 SDD" in frontmatter["description"]
    assert "边界" in frontmatter["description"]
    line_count = len(SEED_SKILL_MD.read_text(encoding="utf-8").splitlines())
    assert line_count <= 100
    body = SEED_SKILL_MD.read_text(encoding="utf-8").split("---", maxsplit=2)[2]
    assert "advisory" in body


def test_level1_skill_metadata_injected_into_system_message(seeded_agent_module):
    """Level 1：首回合 system message 含 skill 的 name / description / 路径。"""
    agent_module, workspace = seeded_agent_module
    model = _SystemCapturingChatModel(
        provider=agent_module.MODEL_PROVIDER,
        messages=iter(itertools.repeat(AIMessage(content="已收到。"))),
    )
    graph = agent_module.build_deep_agent(
        model=model,
        backend=agent_module.create_backend(root=workspace),
        store=InMemoryStore(),
    )
    graph.invoke(
        {"messages": [{"role": "user", "content": "新需求，slug=demo"}]},
        config={"recursion_limit": 10},
    )

    assert model.captured_system_texts, "fake 模型应至少收到一回合 system message"
    system_text = model.captured_system_texts[0]
    # 实证形态：SkillsMiddleware 追加的独立一节 + 条目行
    assert "## Skills System" in system_text
    assert f"- **{SEED_DIR_NAME}**:" in system_text
    assert f"  -> Read `{SKILL_PATH}` for full instructions" in system_text
    description = _seed_frontmatter()["description"]
    assert description in system_text


def test_level1_directory_without_skill_md_not_injected(seeded_agent_module):
    """skills 扫描约定：缺 SKILL.md 的子目录不注入元数据（负例）。"""
    agent_module, workspace = seeded_agent_module
    (workspace / "skills" / "not-a-skill").mkdir(parents=True, exist_ok=True)
    model = _SystemCapturingChatModel(
        provider=agent_module.MODEL_PROVIDER,
        messages=iter(itertools.repeat(AIMessage(content="已收到。"))),
    )
    graph = agent_module.build_deep_agent(
        model=model,
        backend=agent_module.create_backend(root=workspace),
        store=InMemoryStore(),
    )
    graph.invoke(
        {"messages": [{"role": "user", "content": "新需求，slug=demo"}]},
        config={"recursion_limit": 10},
    )

    system_text = model.captured_system_texts[0]
    assert "not-a-skill" not in system_text
    assert f"- **{SEED_DIR_NAME}**:" in system_text  # 正例仍注入


def test_level2_on_demand_read_of_skill_body(seeded_agent_module):
    """Level 2：按需 read_file SKILL.md，ToolMessage 内容含正文关键内容。"""
    agent_module, workspace = seeded_agent_module
    model = _FakeToolChatModel(
        provider=agent_module.MODEL_PROVIDER,
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "read_file",
                            "args": {"file_path": SKILL_PATH, "limit": 1000},
                            "id": "call_read_skill_1",
                            "type": "tool_call",
                        }
                    ],
                ),
                AIMessage(content="已读 skill，收尾。"),
            ]
        ),
    )
    graph = agent_module.build_deep_agent(
        model=model,
        backend=agent_module.create_backend(root=workspace),
        store=InMemoryStore(),
    )
    result = graph.invoke(
        {"messages": [{"role": "user", "content": "新需求，slug=demo"}]},
        # HITL 接线（interrupt_on 非空）后 HumanInTheLoopMiddleware.after_model
        # 每个模型回合多占一个 superstep（.venv 实证：两回合 10 步 → 12 步），
        # 原 10 的预算恰好耗尽；放宽到 20，仅是 fixture 安全帽，断言不变。
        config={"recursion_limit": 20},
    )

    read_messages = [
        m
        for m in result["messages"]
        if isinstance(m, ToolMessage) and m.name == "read_file"
    ]
    assert len(read_messages) == 1
    content = read_messages[0].content
    # read_file 返回行号前缀文本（.venv 实证），正文关键词应出现
    assert "边界定义完备性" in content
    assert "可判定性" in content
    assert "异常场景" in content


def test_sdd_graph_mounts_workspace_skills(seeded_agent_module, tmp_path):
    """sdd 独立图同样挂载 skills=["/skills/"]（system message 注入元数据）。"""
    import research_deepagent.sdd_graph as sdd_graph_module

    agent_module, workspace = seeded_agent_module
    model = _SystemCapturingChatModel(
        provider=agent_module.MODEL_PROVIDER,
        messages=iter(
            itertools.repeat(
                AIMessage(
                    content=(
                        '{"sdd_files": ["demo/sdd/sdd-1.md"],'
                        ' "test_case_count": 1,'
                        ' "test_cases_by_type": {"unit": 1},'
                        ' "validation_summary": "✅",'
                        ' "unresolved_violations": []}'
                    )
                )
            )
        ),
    )
    graph = sdd_graph_module.build_sdd_graph(
        model=model,
        backend=agent_module.create_backend(root=workspace),
    )
    graph.invoke(
        {"messages": [{"role": "user", "content": "SDD 阶段，slug=demo"}]},
        config={"recursion_limit": 10},
    )

    assert model.captured_system_texts
    system_text = model.captured_system_texts[0]
    assert "## Skills System" in system_text
    assert f"- **{SEED_DIR_NAME}**:" in system_text
    assert f"  -> Read `{SKILL_PATH}` for full instructions" in system_text
