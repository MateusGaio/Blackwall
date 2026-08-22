// MIT License — Copyright (c) 2026 Mateus Gaio

import { lazy, type PointerEvent as ReactPointerEvent, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { CompactIcon } from "./CompactIcon";

export type VaultTab = "files" | "graph";

export const minimumVaultWidth = 300;
export const maximumVaultWidth = 680;

const VaultPanel = lazy(async () => {
  const module = await import("../../features/vault/components/VaultPanel");
  return { default: module.VaultPanel };
});

type VaultSlotProps = {
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
  const { t } = useTranslation();
  return (
    <div className={`vault-slot ${isResizingVault ? "is-resizing" : ""}`}>
      {!vaultCollapsed && (
        <hr
          aria-label={t("vault.resizeVaultPanel")}
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
        <aside aria-label={t("vault.collapsedVault")} className="vault-rail">
          <button
            aria-label={t("vault.openVaultFiles")}
            onClick={onOpenFiles}
            title={t("vault.files")}
            type="button"
          >
            <CompactIcon kind="files" />
          </button>
          <button
            aria-label={t("vault.openVaultGraph")}
            onClick={onOpenGraph}
            title={t("vault.graph")}
            type="button"
          >
            <CompactIcon kind="graph" />
          </button>
        </aside>
      ) : (
        <Suspense fallback={<aside className="vault-panel vault-loading-panel" aria-busy="true" />}>
          <VaultPanel
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
