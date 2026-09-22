import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Row } from "../../lib/messages";
import type { ReactNode } from "react";

export default function Message({
  row,
}: {
  row: Extract<Row, { kind: "prose" }>;
}): ReactNode {
  return (
    <article className={`msg msg--${row.type}`}>
      <header className="msg__role">{row.type}</header>
      <div className="msg__body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.body}</ReactMarkdown>
      </div>
    </article>
  );
}
