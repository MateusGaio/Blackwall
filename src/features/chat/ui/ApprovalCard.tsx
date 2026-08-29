// MIT License — Copyright (c) 2026 Mateus Gaio

import { useTranslation } from "react-i18next";
import type { WorkspaceToolApproval, WorkspaceToolDecision } from "../../../shared/api/sidecar";
import { EnterExit } from "../../../shared/components/motion/EnterExit";
import { Button } from "../../../shared/components/ui/button";

type ApprovalCardProps = {
  onResolve: (decision: WorkspaceToolDecision) => void;
  request: WorkspaceToolApproval;
};

/** Ferramentas que alteram arquivos não oferecem "permitir nesta sessão". */
const SESSION_BLOCKLIST = new Set([
  "apply_patch",
  "bash",
  "create_or_update_file",
  "execute_command",
]);

/**
 * Aprovação de ferramenta estilo ApprovalOverlay do Codex TUI: card inline
 * entre thread e composer, borda 1px, três ações com foco visível.
 */
export function ApprovalCard({ onResolve, request }: ApprovalCardProps) {
  const { t } = useTranslation();
  return (
    <EnterExit offsetPx={6} show>
      <section
        aria-live="assertive"
        className="mx-auto grid w-full max-w-[680px] gap-2 rounded-[var(--radius-panel)] border border-border bg-muted px-3.5 py-3"
        role="alertdialog"
      >
        <p className="m-0 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
          {t("chat.permissionRequested")}
        </p>
        <strong className="m-0 font-mono text-sm">{request.tool}</strong>
        <pre className="m-0 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-control)] border border-border bg-background px-2.5 py-2 font-mono text-[0.72rem] text-foreground/80">
          {JSON.stringify(request.args, null, 2)}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => onResolve("allow_once")} size="sm" type="button">
            {t("chat.allowOnce")}
          </Button>
          {!SESSION_BLOCKLIST.has(request.tool) && (
            <Button
              onClick={() => onResolve("allow_session")}
              size="sm"
              type="button"
              variant="secondary"
            >
              {t("chat.allowThisSession")}
            </Button>
          )}
          <Button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onResolve("deny")}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("chat.deny")}
          </Button>
        </div>
      </section>
    </EnterExit>
  );
}
