// MIT License — Copyright (c) 2026 Mateus Gaio
import { isValidElement, memo, type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { resolveVaultLink, wikilinksToMarkdown } from "../../features/vault/note-links";
import type { VaultFile } from "../api/sidecar";
import { CursorAvoidingParagraph } from "./CursorAvoidingParagraph";

type SafeMarkdownProps = {
  content: string;
  currentPath?: string;
  files?: VaultFile[];
  onLocalLink?: (path: string) => void;
  cursorAvoidanceEnabled?: boolean;
  streaming?: boolean;
};

// Identidade estável: um `files = []` literal por render mataria o memo.
const NO_FILES: VaultFile[] = [];

function CodeBlock({
  children,
  cursorAvoidanceEnabled,
  streaming,
}: {
  children: ReactNode;
  cursorAvoidanceEnabled: boolean;
  streaming: boolean;
}) {
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
      <CursorAvoidingParagraph
        as="pre"
        className="cursor-pretext-code"
        enabled={cursorAvoidanceEnabled}
        preformatted
        streaming={streaming}
      >
        {children}
      </CursorAvoidingParagraph>
    </div>
  );
}

function SafeMarkdownImpl({
  content,
  currentPath,
  files = NO_FILES,
  onLocalLink,
  cursorAvoidanceEnabled = false,
  streaming = false,
}: SafeMarkdownProps) {
  const { t } = useTranslation();
  // Durante o streaming cada delta re-renderiza a thread; sem este memo o
  // wikilink parse rodaria de novo por mensagem mesmo com conteúdo igual.
  const source = useMemo(() => wikilinksToMarkdown(content), [content]);
  return (
    <div className="safe-markdown">
      <ReactMarkdown
        components={{
          p: ({ children, className }) => (
            <CursorAvoidingParagraph
              className={className}
              enabled={cursorAvoidanceEnabled}
              streaming={streaming}
            >
              {children}
            </CursorAvoidingParagraph>
          ),
          h1: ({ children, className }) => (
            <CursorAvoidingParagraph
              as="h1"
              className={className}
              enabled={cursorAvoidanceEnabled}
              streaming={streaming}
            >
              {children}
            </CursorAvoidingParagraph>
          ),
          h2: ({ children, className }) => (
            <CursorAvoidingParagraph
              as="h2"
              className={className}
              enabled={cursorAvoidanceEnabled}
              streaming={streaming}
            >
              {children}
            </CursorAvoidingParagraph>
          ),
          h3: ({ children, className }) => (
            <CursorAvoidingParagraph
              as="h3"
              className={className}
              enabled={cursorAvoidanceEnabled}
              streaming={streaming}
            >
              {children}
            </CursorAvoidingParagraph>
          ),
          h4: ({ children, className }) => (
            <CursorAvoidingParagraph
              as="h4"
              className={className}
              enabled={cursorAvoidanceEnabled}
              streaming={streaming}
            >
              {children}
            </CursorAvoidingParagraph>
          ),
          h5: ({ children, className }) => (
            <CursorAvoidingParagraph
              as="h5"
              className={className}
              enabled={cursorAvoidanceEnabled}
              streaming={streaming}
            >
              {children}
            </CursorAvoidingParagraph>
          ),
          h6: ({ children, className }) => (
            <CursorAvoidingParagraph
              as="h6"
              className={className}
              enabled={cursorAvoidanceEnabled}
              streaming={streaming}
            >
              {children}
            </CursorAvoidingParagraph>
          ),
          li: ({ children, className }) => (
            <CursorAvoidingParagraph
              as="li"
              className={className}
              enabled={cursorAvoidanceEnabled}
              streaming={streaming}
            >
              {children}
            </CursorAvoidingParagraph>
          ),
          th: ({ children, className }) => (
            <CursorAvoidingParagraph
              as="th"
              className={className}
              enabled={cursorAvoidanceEnabled}
              streaming={streaming}
            >
              {children}
            </CursorAvoidingParagraph>
          ),
          td: ({ children, className }) => (
            <CursorAvoidingParagraph
              as="td"
              className={className}
              enabled={cursorAvoidanceEnabled}
              streaming={streaming}
            >
              {children}
            </CursorAvoidingParagraph>
          ),
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
          pre: ({ children }) => (
            <CodeBlock cursorAvoidanceEnabled={cursorAvoidanceEnabled} streaming={streaming}>
              {children}
            </CodeBlock>
          ),
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
