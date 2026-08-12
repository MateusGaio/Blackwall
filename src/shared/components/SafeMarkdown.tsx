// MIT License — Copyright (c) 2026 Mateus Gaio
import { type ReactElement, useState } from "react";

type SafeMarkdownProps = { content: string };

function inline(value: string) {
  const parts = value.split(/(`[^`]+`)/g);
  return parts.map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code key={`inline-code-${part}`}>{part.slice(1, -1)}</code>
    ) : (
      <span key={`inline-text-${part}-${index > 0 ? "after" : "before"}`}>{part}</span>
    ),
  );
}

export function SafeMarkdown({ content }: SafeMarkdownProps) {
  const [copied, setCopied] = useState<number | null>(null);
  const blocks = content.split(/```([\w-]*)\n?([\s\S]*?)```/g);
  const output: ReactElement[] = [];
  let blockIndex = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const text = blocks[index];
    if (!text) continue;
    if (index % 3 === 0) {
      text.split("\n").forEach((line, lineIndex, lines) => {
        if (line.trim()) output.push(<p key={`p-${blockIndex++}`}>{inline(line)}</p>);
        if (lineIndex < lines.length - 1) output.push(<br key={`br-${blockIndex++}`} />);
      });
    } else if (index % 3 === 2) {
      const codeIndex = blockIndex++;
      output.push(
        <div className="code-block" key={`code-${codeIndex}`}>
          <button
            className="code-copy"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => setCopied(codeIndex));
            }}
            type="button"
          >
            {copied === codeIndex ? "Copiado" : "Copiar"}
          </button>
          <pre>
            <code>{text}</code>
          </pre>
        </div>,
      );
    }
  }
  return <div className="safe-markdown">{output}</div>;
}
