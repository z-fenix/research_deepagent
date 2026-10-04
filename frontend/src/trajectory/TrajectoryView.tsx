// Trajectory 组合视图：搜索框（3s 节流索引）+ Timeline + Ledger，
// 挂进右栏 trajectory 面板（spec §5.2-5.4）。
// 选中 timeline 条目 → 按 assistantKey 锚定 Ledger 行滚动定位
// （Ledger assistant 行带 data-asst-key；简报的占位 querySelector 已替换）。

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Message } from "../lib/messages";
import { flattenTrajectoryRows } from "./rows";
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
  // messages 仅在 props 契约中透传（App → stream.messages）；索引以派生行为准，
  // 不解构以避开 noUnusedLocals。
  const { turns, timestamps } = props;
  const [mode, setMode] = useState<TimelineMode>("sequence");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ReadonlySet<string> | null>(null);
  const indexRef = useRef(new TrajectorySearchIndex());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        timestamps={timestamps}
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
