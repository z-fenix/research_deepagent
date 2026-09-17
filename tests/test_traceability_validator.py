from research_deepagent.validators.traceability import validate_traceability_docs

PRD = """## 功能需求
### REQ-001：登录
"""

BDD = """## US-auth-001
- **Covers**: REQ-001
- **As a** 注册用户
- **I want** 登录
- **So that** 访问账户

#### @normal 登录成功
Given 有账户
When 提交正确密码
Then 看到仪表盘

#### @exception 密码错误
Given 有账户
When 提交错误密码
Then 提示错误

#### @alternative 未注册
Given 无账户
When 提交
Then 引导注册

#### @boundary 空密码
Given 登录页
When 密码为空
Then 提示必填
"""

GOOD_SDD = {
    "US-auth-001": """# SDD: US-auth-001
## 边界定义
...
### 测试审查定义
- **TC-001** [scenario: @normal 登录成功] type=集成 priority=P0 pass=仪表盘可见
- **TC-002** [scenario: @exception 密码错误] type=单元 priority=P0 pass=提示错误
- **TC-003** [scenario: @alternative 未注册] type=单元 priority=P1 pass=跳转注册页
- **TC-004** [scenario: @boundary 空密码] type=单元 priority=P1 pass=提示必填
""",
}

GOOD_TRACE = """| REQ | US | Scenario | TestCase |
|---|---|---|---|
| REQ-001 | US-auth-001 | @normal 登录成功 | TC-001 |
| REQ-001 | US-auth-001 | @exception 密码错误 | TC-002 |
| REQ-001 | US-auth-001 | @alternative 未注册 | TC-003 |
| REQ-001 | US-auth-001 | @boundary 空密码 | TC-004 |
"""


def test_valid_traceability_passes():
    result = validate_traceability_docs(PRD, BDD, GOOD_SDD, GOOD_TRACE)
    assert result.ok, result.summary()


def test_missing_sdd_file():
    result = validate_traceability_docs(PRD, BDD, {}, GOOD_TRACE)
    assert any(v.rule == "T1" for v in result.violations)


def test_scenario_without_test_case():
    sdd = {"US-auth-001": GOOD_SDD["US-auth-001"].replace("- **TC-002** [scenario: @exception 密码错误] type=单元 priority=P0 pass=提示错误\n", "")}
    result = validate_traceability_docs(PRD, BDD, sdd, GOOD_TRACE)
    assert any(v.rule == "T3" and "密码错误" in v.message for v in result.violations)


def test_orphan_scenario_reference():
    sdd = {
        "US-auth-001": GOOD_SDD["US-auth-001"]
        + "- **TC-009** [scenario: @exception 不存在的场景] type=单元 priority=P2 pass=x\n"
    }
    result = validate_traceability_docs(PRD, BDD, sdd, GOOD_TRACE)
    assert any(v.rule == "T4" for v in result.violations)


def test_trace_row_unknown_story():
    bad_trace = GOOD_TRACE.replace("US-auth-001 | @normal", "US-nope-001 | @normal")
    result = validate_traceability_docs(PRD, BDD, GOOD_SDD, bad_trace)
    assert any(v.rule == "T5" for v in result.violations)


def test_missing_trace_file():
    result = validate_traceability_docs(PRD, BDD, GOOD_SDD, None)
    assert any(v.rule == "T5" for v in result.violations)
