import type { ReactNode } from "react";
import type { Row } from "../../lib/messages";
import Message from "./Message";
import ThinkingBlock from "./ThinkingBlock";
import ToolCallCard from "../tools/ToolCallCard";

export default function MessageList({ rows }: { rows: Row[] }): ReactNode {
  return (
    <>
      {rows.map((row) =>
        row.kind === "prose" ? (
          <Message key={row.key} row={row} />
        ) : row.kind === "plan" ? (
          <ThinkingBlock key={row.key} body={row.body} />
        ) : (
          <ToolCallCard key={row.key} card={row.card} />
        ),
      )}
    </>
  );
}
