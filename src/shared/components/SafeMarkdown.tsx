// MIT License — Copyright (c) 2026 Mateus Gaio
import { isValidElement, memo, type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

// Identidade estável: um `files = []` literal por render mataria o memo.
const NO_FILES: VaultFile[] = [];

function CodeBlock({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
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
        {copied ? t("chat.copied") : t("chat.copy")}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

function SafeMarkdownImpl({
  content,
  currentPath,
  files = NO_FILES,
  onLocalLink,
}: SafeMarkdownProps) {
  const { t } = useTranslation();
  // Durante o streaming cada delta re-renderiza a thread; sem este memo o
  // wikilink parse rodaria de novo por mensagem mesmo com conteúdo igual.
  const source = useMemo(() => wikilinksToMarkdown(content), [content]);
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
                <span className="markdown-broken-link" title={t("vault.noteNotFound")}>
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

/**
 * Memoizado na borda de props: mensagens antigas da thread recebem sempre o
 * mesmo `content`/refs e pulam o pipeline remark/rehype inteiro quando só o
 * placeholder de streaming muda.
 */
export const SafeMarkdown = memo(SafeMarkdownImpl);
