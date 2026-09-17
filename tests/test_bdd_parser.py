from research_deepagent.validators.bdd_parser import (
    BRANCH_TAGS,
    FORBIDDEN_WORDS,
    parse_stories,
)

SAMPLE = """# 用户故事

## US-auth-001
- **Covers**: REQ-001, REQ-002
- **As a** 注册用户
- **I want** 使用邮箱和密码登录
- **So that** 我能访问我的账户

#### @normal 正确密码登录成功
Given 已存在账户 "user@example.com"
When 我提交正确密码
Then 我看到仪表盘

#### @exception 密码错误登录失败
Given 已存在账户 "user@example.com"
When 我提交错误密码
Then 我看到错误提示 "用户名或密码错误"

#### @alternative 未注册邮箱走注册引导
Given 邮箱 "n@example.com" 未注册
When 我提交登录表单
Then 我被引导到注册页

#### @boundary 密码长度为边界值 64
Given 已存在账户 "b@example.com"
When 我提交长度为 64 的密码
Then 登录成功

## US-auth-002
- **Covers**: REQ-003
- **As a** 注册用户
- **I want** 找回密码
- **So that** 我能重新登录
"""


def test_parses_two_stories():
    stories = parse_stories(SAMPLE)
    assert [s.story_id for s in stories] == ["US-auth-001", "US-auth-002"]


def test_parses_covers_req_ids():
    stories = parse_stories(SAMPLE)
    assert stories[0].covers == ["REQ-001", "REQ-002"]
    assert stories[1].covers == ["REQ-003"]


def test_parses_three_part_story():
    stories = parse_stories(SAMPLE)
    assert stories[0].as_a == "注册用户"
    assert stories[0].i_want == "使用邮箱和密码登录"
    assert stories[0].so_that == "我能访问我的账户"


def test_parses_scenarios_with_tags_and_steps():
    stories = parse_stories(SAMPLE)
    scenarios = stories[0].scenarios
    assert [sc.name for sc in scenarios] == [
        "正确密码登录成功",
        "密码错误登录失败",
        "未注册邮箱走注册引导",
        "密码长度为边界值 64",
    ]
    assert scenarios[0].tags == ["@normal"]
    assert scenarios[0].given and scenarios[0].when and scenarios[0].then
    assert scenarios[1].tags == ["@exception"]


def test_incomplete_story_fields_are_none():
    text = "## US-x-001\n- **Covers**: REQ-001\n"
    story = parse_stories(text)[0]
    assert story.as_a is None and story.i_want is None and story.so_that is None


def test_scenario_without_then():
    text = """## US-x-001
- **Covers**: REQ-001

#### @normal 正常路径
Given 有输入
When 提交
"""
    scenarios = parse_stories(text)[0].scenarios
    assert scenarios[0].given and scenarios[0].when and not scenarios[0].then


def test_constants():
    assert set(BRANCH_TAGS) == {"@normal", "@alternative", "@exception", "@boundary"}
    assert "TBD" in FORBIDDEN_WORDS and "等等" in FORBIDDEN_WORDS


def test_hyphenated_epic_story_parses():
    text = """## US-user-auth-001
- **Covers**: REQ-001
- **As a** 注册用户
- **I want** 使用邮箱和密码登录
- **So that** 我能访问我的账户
"""
    assert parse_stories(text)[0].story_id == "US-user-auth-001"


def test_uppercase_epic_not_matched():
    text = "## US-AUTH-001\n- **Covers**: REQ-001\n"
    assert parse_stories(text) == []
