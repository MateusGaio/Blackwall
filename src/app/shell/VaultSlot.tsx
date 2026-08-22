// MIT License — Copyright (c) 2026 Mateus Gaio

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/shared/components/motion/Skeleton";
import { CompactIcon } from "./CompactIcon";

export type VaultTab = "files" | "graph";

export const minimumVaultWidth = 300;
export const maximumVaultWidth = 680;

const VaultPanel = lazy(async () => {
  const module = await import("../../features/vault/components/VaultPanel");
  return { default: module.VaultPanel };
});

type VaultRailProps = {
  onOpenFiles: () => void;
  onOpenGraph: () => void;
};

/** Estado recolhido do Vault (UX_SPEC §11): coluna estreita com atalhos. */
export function VaultRail({ onOpenFiles, onOpenGraph }: VaultRailProps) {
  const { t } = useTranslation();
  return (
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
  );
}

type VaultSlotProps = {
  onCollapse: () => void;
  onTabChange: (tab: VaultTab) => void;
  refreshKey: number;
  tab: VaultTab;
  workspaceId: string;
};

/** Conteúdo do painel do Vault dentro do painel redimensionável. */
export function VaultSlot({
  onCollapse,
  onTabChange,
  refreshKey,
  tab,
  workspaceId,
}: VaultSlotProps) {
  return (
    <div className="vault-slot">
      <Suspense
        fallback={
          <div aria-busy="true" className="min-h-0 flex-1 p-4">
            <Skeleton className="h-full" />
          </div>
        }
      >
        <VaultPanel
          onCollapse={onCollapse}
          onTabChange={onTabChange}
          refreshKey={refreshKey}
          tab={tab}
          workspaceId={workspaceId}
        />
      </Suspense>
    </div>
  );
}
