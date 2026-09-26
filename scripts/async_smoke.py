"""手动冒烟脚本：验证 SDD 异步链路（Task 06 / Task 4）。

对照《Deep Agents》第 6 章最小验证方案的 run_demo.py 模式改写为本仓库形态：
对 langgraph dev 启动的本地服务，向 assistant_id="research" 的 thread 连续
执行四步交互，验证 start_async_task / check_async_task / update_async_task
异步链路与 SddPhaseReport 回收解析。

前置条件：
- 仓库根目录存在可用的 `.env`（langgraph.json 已声明 `"env": "./.env"`）；
- 服务已启动：`uv run langgraph dev --n-jobs-per-worker 4`
  （默认监听 http://127.0.0.1:2024）；
- 本脚本仅做人工验证，不进 CI，也不属于 pytest 套件。

用法：
    uv run python scripts/async_smoke.py
    uv run python scripts/async_smoke.py --url http://127.0.0.1:2024 \
        --poll-interval 30 --poll-timeout 900
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import time

import langgraph_sdk

from research_deepagent.schemas import SddPhaseReport

DEFAULT_URL = "http://127.0.0.1:2024"
DEFAULT_ASSISTANT_ID = "research"

# 首轮（启动异步任务）应很快返回；超过此阈值仅告警，不判定失败。
FIRST_RUN_MAX_SECONDS = 120.0
DEFAULT_POLL_INTERVAL_SECONDS = 30.0
DEFAULT_POLL_TIMEOUT_SECONDS = 900.0

# task_id 形态的宽松匹配：UUID 或含 "task" 字样的短 token，仅供人工确认。
TASK_ID_PATTERNS = [
    re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"),
    re.compile(r"\b[\w-]*task[\w-]*\b", re.IGNORECASE),
]

STEP_A_PROMPT = (
    "请把一个 SDD 生成任务交给 sdd-agent 异步处理：为示例需求"
    "“用户登录功能”产出 SDD 文档。任务启动后直接告诉我任务 ID，"
    "不要等待任务完成。"
)
STEP_B_PROMPT = "请查询刚才那个 sdd-agent 异步任务的当前进度，并告诉我状态。"
STEP_C_PROMPT = (
    "请给该异步任务追加一条补充指令：测试用例需覆盖异常登录路径。"
    "追加后告诉我当前状态。"
)
STEP_D_POLL_PROMPT = (
    "请检查该异步任务是否已完成；如果已完成，请把 sdd-agent 回收的 "
    "SddPhaseReport 结果 JSON 原样输出；如果未完成，请只回答“未完成”。"
)


def last_reply_text(state: dict) -> str:
    """从 runs.wait 返回的最终 state 中取出最后一条 AI 回复的文本。"""
    messages = state.get("messages") or []
    if not messages:
        return ""
    last = messages[-1]
    content = last.get("content", "") if isinstance(last, dict) else last
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # 多模态块形态
        return "".join(
            block.get("text", "") for block in content if isinstance(block, dict)
        )
    return str(content)


def extract_task_id_candidates(text: str) -> list[str]:
    """宽松提取 task_id 形态的字符串（UUID 或含 task 的 token），去重保序。"""
    seen: list[str] = []
    for pattern in TASK_ID_PATTERNS:
        for match in pattern.findall(text):
            if match not in seen:
                seen.append(match)
    return seen


def iter_json_objects(text: str):
    """从自由文本中逐一提取可解码的 JSON 对象（容错：模型产出未必严格）。"""
    decoder = json.JSONDecoder()
    idx = text.find("{")
    while idx != -1:
        try:
            obj, end = decoder.raw_decode(text, idx)
            yield obj
            idx = text.find("{", end)
        except json.JSONDecodeError:
            idx = text.find("{", idx + 1)


def try_parse_sdd_report(text: str) -> SddPhaseReport | None:
    """尝试把回复文本解析为 SddPhaseReport；失败返回 None（仅告警不抛出）。"""
    candidates = [text.strip(), *(json.dumps(obj, ensure_ascii=False) for obj in iter_json_objects(text))]
    for candidate in candidates:
        if not candidate.startswith("{"):
            continue
        try:
            return SddPhaseReport.model_validate_json(candidate)
        except Exception:
            continue
    return None


async def send_and_wait(client, thread_id: str, assistant_id: str, prompt: str) -> tuple[str, float]:
    """发送一条消息并等待本轮返回，返回（回复文本, 耗时秒）。"""
    start = time.monotonic()
    state = await client.runs.wait(
        thread_id,
        assistant_id,
        input={"messages": [{"role": "user", "content": prompt}]},
    )
    elapsed = time.monotonic() - start
    return last_reply_text(state), elapsed


async def main() -> None:
    parser = argparse.ArgumentParser(description="SDD 异步链路手动冒烟脚本")
    parser.add_argument("--url", default=DEFAULT_URL, help="langgraph dev 服务地址")
    parser.add_argument("--assistant-id", default=DEFAULT_ASSISTANT_ID)
    parser.add_argument("--poll-interval", type=float, default=DEFAULT_POLL_INTERVAL_SECONDS)
    parser.add_argument("--poll-timeout", type=float, default=DEFAULT_POLL_TIMEOUT_SECONDS)
    args = parser.parse_args()

    client = langgraph_sdk.get_client(url=args.url)
    thread = await client.threads.create()
    thread_id = thread["thread_id"]
    print(f"[smoke] thread_id={thread_id} assistant_id={args.assistant_id}")

    # ---- a. 启动异步 SDD 任务（start_async_task 路径）----
    print("\n===== 步骤 a：启动异步任务 =====")
    reply_a, elapsed_a = await send_and_wait(client, thread_id, args.assistant_id, STEP_A_PROMPT)
    print(f"[smoke] 首轮耗时 {elapsed_a:.1f}s")
    print(f"[assistant] {reply_a}\n")
    if not reply_a.strip():
        raise SystemExit("[smoke] FAIL：首轮回复为空")
    if elapsed_a > FIRST_RUN_MAX_SECONDS:
        print(
            f"[smoke] WARN：首轮耗时 {elapsed_a:.1f}s 超过 {FIRST_RUN_MAX_SECONDS:.0f}s，"
            "疑似阻塞等待异步任务完成，请人工确认"
        )
    candidates = extract_task_id_candidates(reply_a)
    print(f"[smoke] task_id 形态候选（供人工确认，不做硬编码断言）：{candidates or '（未匹配到，请人工检查回复）'}")

    # ---- b. 追问进度（check_async_task 路径）----
    print("\n===== 步骤 b：查询进度 =====")
    reply_b, _ = await send_and_wait(client, thread_id, args.assistant_id, STEP_B_PROMPT)
    print(f"[assistant] {reply_b}\n")

    # ---- c. 注入补充约束（update_async_task 路径）----
    print("\n===== 步骤 c：追加指令 =====")
    reply_c, _ = await send_and_wait(client, thread_id, args.assistant_id, STEP_C_PROMPT)
    print(f"[assistant] {reply_c}\n")

    # ---- d. 脚本侧轮询直到任务完成或超时 ----
    print("\n===== 步骤 d：轮询回收结果 =====")
    deadline = time.monotonic() + args.poll_timeout
    report: SddPhaseReport | None = None
    while time.monotonic() < deadline:
        await asyncio.sleep(args.poll_interval)
        reply_d, _ = await send_and_wait(client, thread_id, args.assistant_id, STEP_D_POLL_PROMPT)
        print(f"[assistant] {reply_d}\n")
        report = try_parse_sdd_report(reply_d)
        if report is not None:
            break
        print(f"[smoke] 本轮未解析到 SddPhaseReport，{args.poll_interval:.0f}s 后重试")

    if report is None:
        print(f"[smoke] WARN：轮询超时（{args.poll_timeout:.0f}s）未解析到 SddPhaseReport，请人工检查 thread {thread_id}")
        return
    print("===== SddPhaseReport 解析成功 =====")
    print(report.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())
