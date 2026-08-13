// MIT License — Copyright (c) 2026 Mateus Gaio
import { isValidElement, type ReactNode, useState } from "react";
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
  const textContent = (node: ReactNode): string => {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textContent).join("");
    if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
    return "";
  };
  const text = textContent(children).replace(/\n$/, "");
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
            const isRelativeLink =
              Boolean(onLocalLink) &&
              Boolean(href) &&
              !href.startsWith("#") &&
              !href.startsWith("/") &&
              !href.startsWith("\\") &&
              !href.startsWith("//") &&
              !/^[a-z][a-z\d+.-]*:/i.test(href);
            if (isRelativeLink) {
              return (
                <span className="markdown-broken-link" title="Nota não encontrada no Vault">
                  {children}
                </span>
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
