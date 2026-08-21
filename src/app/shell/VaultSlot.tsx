// MIT License — Copyright (c) 2026 Mateus Gaio
import { lazy, type PointerEvent as ReactPointerEvent, Suspense } from "react";
import { CompactIcon } from "./CompactIcon";

export type VaultTab = "files" | "graph";

export const minimumVaultWidth = 300;
export const maximumVaultWidth = 680;

const VaultPanel = lazy(async () => {
  const module = await import("../../features/vault/components/VaultPanel");
  return { default: module.VaultPanel };
});

type VaultSlotProps = {
  isEnglish: boolean;
  isResizingVault: boolean;
  onCollapse: () => void;
  onFinishResize: () => void;
  onNudgeWidth: (delta: number) => void;
  onOpenFiles: () => void;
  onOpenGraph: () => void;
  onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStartResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTabChange: (tab: VaultTab) => void;
  refreshKey: number;
  tab: VaultTab;
  vaultCollapsed: boolean;
  vaultWidth: number;
  workspaceId: string;
};

export function VaultSlot({
  isEnglish,
  isResizingVault,
  onCollapse,
  onFinishResize,
  onNudgeWidth,
  onOpenFiles,
  onOpenGraph,
  onResize,
  onStartResize,
  onTabChange,
  refreshKey,
  tab,
  vaultCollapsed,
  vaultWidth,
  workspaceId,
}: VaultSlotProps) {
  return (
    <div className={`vault-slot ${isResizingVault ? "is-resizing" : ""}`}>
      {!vaultCollapsed && (
        <hr
          aria-label={isEnglish ? "Resize Vault panel" : "Redimensionar painel do Vault"}
          aria-orientation="vertical"
          aria-valuemax={maximumVaultWidth}
          aria-valuemin={minimumVaultWidth}
          aria-valuenow={vaultWidth}
          className="vault-resize-handle"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              onNudgeWidth(24);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              onNudgeWidth(-24);
            }
          }}
          onPointerCancel={onFinishResize}
          onPointerDown={onStartResize}
          onPointerMove={onResize}
          onPointerUp={onFinishResize}
          tabIndex={0}
        />
      )}
      {vaultCollapsed ? (
        <aside
          aria-label={isEnglish ? "Collapsed Vault" : "Vault recolhido"}
          className="vault-rail"
        >
          <button
            aria-label={isEnglish ? "Open Vault files" : "Abrir arquivos do Vault"}
            onClick={onOpenFiles}
            title={isEnglish ? "Files" : "Arquivos"}
            type="button"
          >
            <CompactIcon kind="files" />
          </button>
          <button
            aria-label={isEnglish ? "Open Vault graph" : "Abrir grafo do Vault"}
            onClick={onOpenGraph}
            title={isEnglish ? "Graph" : "Grafo"}
            type="button"
          >
            <CompactIcon kind="graph" />
          </button>
        </aside>
      ) : (
        <Suspense fallback={<aside className="vault-panel vault-loading-panel" aria-busy="true" />}>
          <VaultPanel
            locale={isEnglish ? "en" : "pt-BR"}
            onCollapse={onCollapse}
            onTabChange={onTabChange}
            refreshKey={refreshKey}
            tab={tab}
            workspaceId={workspaceId}
          />
        </Suspense>
      )}
    </div>
  );
}
