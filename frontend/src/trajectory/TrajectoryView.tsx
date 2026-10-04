// Trajectory 组合视图：搜索框（3s 节流索引）+ Timeline + Ledger，
// 挂进右栏 trajectory 面板（spec §5.2-5.4）。
// 选中 timeline 条目 → 按 assistantKey 锚定 Ledger 行滚动定位
// （Ledger assistant 行带 data-asst-key；简报的占位 querySelector 已替换）。
// C2（final review）：App 传入的 timestamps 以 message id 为键
// （useMessageTimestamps 契约不变）；此处经 stepTimestampsFromMessages
// 转换为 assistantKey 键，Timeline 的时间类模式由此获得数据。

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Message } from "../lib/messages";
import { flattenTrajectoryRows } from "./rows";
import { stepTimestampsFromMessages } from "./timeline";
import { TrajectorySearchIndex } from "./search";
import { Ledger } from "./Ledger";
import { Timeline } from "./Timeline";
import type { TimelineMode } from "./timeline";
import type { TrajTurn } from "./layout";

const SEARCH_THROTTLE_MS = 3000;

export function TrajectoryView(props: {
  turns: TrajTurn[];
  timestamps: ReadonlyMap<string, number>;
  messages: Message[];
}): ReactNode {
  const { turns, timestamps, messages } = props;
  const [mode, setMode] = useState<TimelineMode>("sequence");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ReadonlySet<string> | null>(null);
  const indexRef = useRef(new TrajectorySearchIndex());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // message id 捕获 → assistantKey 步级时间戳（k 条 AI 消息 = k 个 step）
  const stepTimestamps = useMemo(
    () => stepTimestampsFromMessages(messages, turns, timestamps),
    [messages, turns, timestamps],
  );

  const flatRows = useMemo(
    () =>
      flattenTrajectoryRows(turns, new Set(), new Set()).map((row) => ({
        key: row.key,
        text: [row.text, row.block?.name ?? "", row.block?.result ?? ""].join(" "),
      })),
    [turns],
  );

  useEffect(() => {
    if (timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      indexRef.current.update(flatRows);
      setMatches(indexRef.current.search(query));
    }, SEARCH_THROTTLE_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [flatRows, query]);

  return (
    <div className="trajectory-view">
      <input
        type="search"
        role="searchbox"
        className="trajectory-view__search"
        placeholder="Search trajectory"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Timeline
        turns={turns}
        timestamps={stepTimestamps}
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          setSelected(null);
        }}
        selected={selected}
        onSelect={(key) => {
          setSelected(key);
          document
            .querySelector(`[data-asst-key="${key}"]`)
            ?.scrollIntoView({ block: "nearest" });
        }}
      />
      <Ledger turns={turns} searchMatches={matches} />
    </div>
  );
}
