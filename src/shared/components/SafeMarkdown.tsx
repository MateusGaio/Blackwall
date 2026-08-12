// MIT License — Copyright (c) 2026 Mateus Gaio
import { type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { resolveVaultLink, wikilinksToMarkdown } from "../../features/vault/note-links";
import type { VaultFile } from "../api/sidecar";

type SafeMarkdownProps = {
  content: string;
  currentPath?: string;
  files?: VaultFile[];
  onLocalLink?: (path: string) => void;
};

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");
  return (
    <div className="code-block">
      <button
        className="code-copy"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => setCopied(true));
        }}
        type="button"
      >
        {copied ? "Copiado" : "Copiar"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

export function SafeMarkdown({ content, currentPath, files = [], onLocalLink }: SafeMarkdownProps) {
  const source = wikilinksToMarkdown(content);
  return (
    <div className="safe-markdown">
      <ReactMarkdown
        components={{
          a: ({ children, href = "" }) => {
            const localPath = onLocalLink ? resolveVaultLink(currentPath, href, files) : null;
            if (localPath && onLocalLink) {
              return (
                <button
                  className="markdown-note-link"
                  onClick={() => onLocalLink(localPath)}
                  type="button"
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} rel="noreferrer noopener" target="_blank">
                {children}
              </a>
            );
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
        rehypePlugins={[rehypeSanitize]}
        remarkPlugins={[remarkGfm]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
