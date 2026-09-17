from research_deepagent.prompts import BDD_AGENT_INSTRUCTIONS, SDD_AGENT_INSTRUCTIONS
from research_deepagent.validators.traceability import parse_sdd_text
from research_deepagent.validators.bdd_parser import parse_stories


def test_bdd_prompt_example_story_is_parseable():
    # 取提示词中 markdown 代码块里的示例故事
    start = BDD_AGENT_INSTRUCTIONS.index("## US-auth-001")
    end = BDD_AGENT_INSTRUCTIONS.index("## 闭合规则")
    snippet = BDD_AGENT_INSTRUCTIONS[start:end]
    stories = parse_stories(snippet)
    assert stories[0].story_id == "US-auth-001"
    assert len(stories[0].scenarios) == 4


def test_sdd_prompt_test_case_lines_are_parseable():
    refs = parse_sdd_text(SDD_AGENT_INSTRUCTIONS)
    # parse_sdd_text 返回的 scenario_name 已按 traceability.py 语义剥掉 @tag 前缀
    assert any(r.tc_id == "TC-001" and r.scenario_name == "正确密码登录成功" for r in refs)
