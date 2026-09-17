from research_deepagent.validators.user_stories import validate_user_stories_docs

PRD = """# PRD
## 功能需求
### REQ-001：用户登录
### REQ-002：找回密码

## 术语表
- **注册用户**：已完成邮箱验证的账户持有人
"""

GOOD_BDD = """## US-auth-001
- **Covers**: REQ-001
- **As a** 注册用户
- **I want** 登录
- **So that** 访问账户

#### @normal 登录成功
Given 有账户
When 提交正确密码
Then 看到仪表盘

#### @alternative 未注册
Given 无账户
When 提交
Then 引导注册

#### @exception 密码错误
Given 有账户
When 提交错误密码
Then 提示错误

#### @boundary 空密码
Given 登录页
When 密码为空提交
Then 提示必填

## US-auth-002
- **Covers**: REQ-002
- **As a** 注册用户
- **I want** 找回密码
- **So that** 重新访问账户

#### @normal 发送重置邮件
Given 已注册邮箱
When 请求重置密码
Then 收到重置邮件

#### @alternative 邮箱不存在
Given 未注册邮箱
When 请求重置密码
Then 提示邮箱不存在

#### @exception 邮件发送失败
Given 已注册邮箱
When 邮件服务不可用
Then 提示稍后重试

#### @boundary 邮箱为空
Given 重置页
When 邮箱为空提交
Then 提示必填
"""


def test_valid_bdd_passes():
    result = validate_user_stories_docs(PRD, GOOD_BDD)
    assert result.ok, result.summary()


def test_missing_branch_tag_is_violation():
    bad = GOOD_BDD.replace("#### @boundary 空密码", "#### 空密码").split("## US-auth-002")[0]
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B5" for v in result.violations)


def test_unknown_req_reference():
    bad = GOOD_BDD.replace("- **Covers**: REQ-001", "- **Covers**: REQ-999")
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B2" and "REQ-999" in v.message for v in result.violations)


def test_uncovered_req():
    prd = PRD + "\n### REQ-009：孤儿需求\n"
    result = validate_user_stories_docs(prd, GOOD_BDD)
    assert any(v.rule == "B3" and "REQ-009" in v.message for v in result.violations)


def test_missing_three_part():
    bad = GOOD_BDD.replace("- **So that** 访问账户\n", "")
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B1" for v in result.violations)


def test_missing_gwt():
    bad = GOOD_BDD.replace("Then 看到仪表盘", "")
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B4" for v in result.violations)


def test_role_not_in_glossary():
    bad = GOOD_BDD.replace("- **As a** 注册用户", "- **As a** 管理员")
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B7" for v in result.violations)


def test_empty_glossary_is_violation():
    prd_no_glossary = "## 功能需求\n### REQ-001：登录\n"
    result = validate_user_stories_docs(prd_no_glossary, GOOD_BDD)
    assert any(v.rule == "B7" for v in result.violations)


def test_forbidden_word():
    bad = GOOD_BDD + "\n此故事 TBD。\n"
    result = validate_user_stories_docs(PRD, bad)
    assert any(v.rule == "B6" for v in result.violations)
