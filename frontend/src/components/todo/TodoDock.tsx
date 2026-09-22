import { useState, type ReactNode } from "react";
import type { TodoItem } from "../../lib/stream";

function statusLabel(status: TodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "done";
    case "in_progress":
      return "active";
    default:
      return "queued";
  }
}

export default function TodoDock({ todos }: { todos: TodoItem[] }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  if (todos.length === 0) return null;

  const completedCount = todos.filter((todo) => todo.status === "completed").length;
  const progress = Math.round((completedCount / todos.length) * 100);

  return (
    <section className="todo-dock" aria-label="Research plan">
      <button
        type="button"
        className="todo-dock__summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <strong>Research plan</strong>
        <span>{completedCount}/{todos.length} · {progress}%</span>
      </button>
      {expanded && (
        <ol className="todo-list">
          {todos.map((todo, index) => (
            <li
              key={`${todo.content}-${index}`}
              className={`todo-list__item todo-list__item--${todo.status}`}
            >
              <span className="todo-list__index">{index + 1}</span>
              <span className="todo-list__content">{todo.content}</span>
              <span className={`todo-list__status todo-list__status--${todo.status}`}>
                {statusLabel(todo.status)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
