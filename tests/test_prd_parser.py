from research_deepagent.validators.prd_parser import (
    find_forbidden_words,
    parse_glossary,
    parse_requirements,
)

SAMPLE = """# PRD

## 功能需求

### REQ-001：用户登录
支持邮箱密码登录。

### REQ-002：记住我
登录态保持两周。

### REQ-003：找回密码

## 术语表
- **注册用户**：已完成邮箱验证的账户持有人
- **仪表盘**：登录后的首屏页面

## 未决问题
- TBD：是否支持手机号登录
"""


def test_parse_requirements():
    assert parse_requirements(SAMPLE) == ["REQ-001", "REQ-002", "REQ-003"]


def test_parse_glossary_scoped_to_section():
    terms = parse_glossary(SAMPLE)
    assert "注册用户" in terms and "仪表盘" in terms


def test_glossary_excludes_bold_outside_section():
    text = "## 功能需求\n- **REQ-001**：标题\n\n## 术语表\n- **术语A**：定义\n"
    assert parse_glossary(text) == ["术语A"]


def test_find_forbidden_words():
    assert find_forbidden_words("这里 TBD 一下") == ["TBD"]
    assert find_forbidden_words("干净文本") == []
