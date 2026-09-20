"""自研 VFS 三种存储后端的文件工具微基准。

运行::

    uv run python -m benchmarks.vfs_benchmark

产物：

- ``trace/vfs-benchmark-results.csv``：原始计时数据
- ``trace/vfs-benchmark-report.md``：对比表格与结论

实验设计（对应 spec 2026-09-19）：

- 场景矩阵：文件大小 {small, medium, large} x 操作 {write, read, edit, grep,
  glob, ls} x 后端 {memory, sqlite, disk}
- 每操作先预热 1 轮（不计入），再计时 ``ROUNDS`` 轮，报告中位数与 P95
- 正确性闸门：每个 (后端, 大小) 组合先跑断言集，失败即终止且不产出报告
"""

from __future__ import annotations

import csv
import statistics
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

from research_deepagent.vfs import create_backend

ROUNDS = 20
FILE_COUNT = 20
SIZES = {"small": 1_000, "medium": 50_000, "large": 500_000}
BACKEND_NAMES = ("memory", "sqlite", "disk")
TRACE_DIR = Path("trace")


def _make_content(size: int, index: int) -> str:
    """构造约 ``size`` 字符的确定性文档，内含每文件唯一的编辑锚点。"""
    lines: list[str] = []
    total = 0
    i = 0
    while total < size:
        line = f"line {i:06d} file {index:03d} sentinel lorem ipsum dolor sit amet\n"
        lines.append(line)
        total += len(line)
        i += 1
    lines[index % len(lines)] = f"unique-anchor-{index:03d}\n"
    return "".join(lines)


def _populate(backend, size: int) -> dict[str, str]:
    """写入 FILE_COUNT 个文件，返回 {路径: 编辑锚点}。"""
    anchors: dict[str, str] = {}
    for index in range(FILE_COUNT):
        path = f"/d{index % 4}/f{index:03d}.md"
        assert backend.write(path, _make_content(size, index)).error is None
        anchors[path] = f"unique-anchor-{index:03d}"
    return anchors


def _timed(setup, op) -> list[float]:
    """预热 1 轮后计时 ROUNDS 轮 op() 的耗时（秒）。"""
    setup()
    op()
    samples: list[float] = []
    for _ in range(ROUNDS):
        setup()
        start = time.perf_counter()
        op()
        samples.append(time.perf_counter() - start)
    return samples


def _p95(samples: list[float]) -> float:
    ordered = sorted(samples)
    return ordered[min(len(ordered) - 1, int(0.95 * (len(ordered) - 1)))]


def _check_correctness(backend, size: int) -> None:
    """正确性闸门：任一断言失败即抛 AssertionError。"""
    path = "/checks/c.md"
    content = _make_content(size, 0)
    assert backend.write(path, content).error is None

    read = backend.read(path, limit=backend.read(path).total_lines)
    assert read.error is None
    assert read.file_data["content"] == content
    assert read.total_lines == len(content.rstrip("\n").split("\n"))

    window = backend.read(path, offset=2, limit=3)
    assert window.error is None
    assert window.start_line == 3 and window.end_line == 5
    assert window.next_offset == 5

    anchor = "unique-anchor-000"
    edit = backend.edit(path, anchor, "edited-anchor")
    assert edit.error is None and edit.occurrences == 1
    assert backend.edit(path, anchor, "x").error is not None  # 锚点已消耗

    grep = backend.grep("sentinel")
    assert grep.error is None and grep.matches
    assert backend.grep("sentinel", max_count=1).truncated is True

    globbed = backend.glob("**/*.md")
    assert globbed.error is None
    assert any(m["path"] == path for m in globbed.matches)

    listed = backend.ls("/")
    assert listed.error is None and listed.entries

    assert backend.delete(path).error is None
    assert backend.read(path).error is not None


def _bench_operations(backend, name: str, size: int) -> list[dict[str, object]]:
    anchors = _populate(backend, size)
    target_path = "/d0/f000.md"
    target_content = _make_content(size, 0)
    anchor = anchors[target_path]

    def reset_target() -> None:
        backend.delete(target_path)  # 首轮不存在，忽略 DeleteResult.error

    scenarios = {
        "write": (reset_target, lambda: backend.write(target_path, target_content)),
        "read": (lambda: None, lambda: backend.read(target_path)),
        "edit": (
            lambda: backend.write(target_path, target_content),
            lambda: backend.edit(target_path, anchor, "edited-anchor"),
        ),
        "grep": (lambda: None, lambda: backend.grep("sentinel", max_count=1000)),
        "glob": (lambda: None, lambda: backend.glob("**/*.md")),
        "ls": (lambda: None, lambda: backend.ls("/")),
    }

    rows: list[dict[str, object]] = []
    for op_name, (setup, op) in scenarios.items():
        samples = _timed(setup, op)
        rows.append(
            {
                "backend": name,
                "size": size,
                "op": op_name,
                "median_ms": statistics.median(samples) * 1000,
                "p95_ms": _p95(samples) * 1000,
            }
        )
    return rows


def main() -> None:
    TRACE_DIR.mkdir(exist_ok=True)
    rows: list[dict[str, object]] = []

    # TemporaryDirectory 上下文管理器保证基准临时目录随用随清（M4）。
    with tempfile.TemporaryDirectory(prefix="vfs-bench-") as tmp_name:
        tmp = Path(tmp_name)
        for name in BACKEND_NAMES:
            for size_name, size in SIZES.items():
                root = tmp / f"{name}-{size_name}"
                root.mkdir(parents=True, exist_ok=True)
                backend = create_backend(name, root=root)
                _check_correctness(backend, size)  # 正确性闸门
                rows.extend(_bench_operations(backend, name, size))

    _write_csv(rows)
    _write_report(rows)
    print(f"Benchmark complete: {len(rows)} rows -> trace/vfs-benchmark-results.csv")


def _write_csv(rows: list[dict[str, object]]) -> None:
    with (TRACE_DIR / "vfs-benchmark-results.csv").open(
        "w", newline="", encoding="utf-8"
    ) as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["backend", "size", "op", "median_ms", "p95_ms"]
        )
        writer.writeheader()
        writer.writerows(rows)


def _write_report(rows: list[dict[str, object]]) -> None:
    size_names = {1_000: "small(~1KB)", 50_000: "medium(~50KB)", 500_000: "large(~500KB)"}
    lines = [
        "# 自研 VFS 存储后端微基准报告",
        "",
        f"生成时间：{datetime.now(UTC).isoformat()}",
        "",
        f"方法：文件数 {FILE_COUNT}，每操作预热 1 轮 + 计时 {ROUNDS} 轮，"
        "报告中位数与 P95；每个 (后端, 大小) 组合先通过正确性闸门。",
        "",
        "| backend | size | op | median (ms) | p95 (ms) |",
        "|---|---|---|---|---|",
    ]
    for row in rows:
        lines.append(
            f"| {row['backend']} | {size_names[row['size']]} | {row['op']} "
            f"| {row['median_ms']:.3f} | {row['p95_ms']:.3f} |"
        )

    lines += ["", "## 结论", ""]
    scenes: dict[tuple[int, str], list[dict[str, object]]] = {}
    for row in rows:
        scenes.setdefault((row["size"], row["op"]), []).append(row)
    for (size, op), candidates in sorted(scenes.items()):
        fastest = min(candidates, key=lambda r: r["median_ms"])
        lines.append(
            f"- {size_names[size]} / {op}：最快 {fastest['backend']}"
            f"（中位数 {fastest['median_ms']:.3f} ms）"
        )
    lines += [
        "",
        "预期模式：memory 无 IO 开销最快；disk 受文件系统调用主导；"
        "sqlite 每次写提交事务，写放大最明显。glob 等枚举类操作受全量 "
        "keys()/rglob 扫描主导；grep 基准已加 max_count 截断，match 物化"
        "成本有界，开销同样以扫描为主。具体数字以上表为准。",
    ]

    (TRACE_DIR / "vfs-benchmark-report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
