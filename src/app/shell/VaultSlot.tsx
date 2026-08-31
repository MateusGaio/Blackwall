// MIT License — Copyright (c) 2026 Mateus Gaio

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/shared/components/motion/Skeleton";
import type { VaultTab } from "../vault-view";
import { CompactIcon } from "./CompactIcon";

/** Posição de leitura preservada entre recolher/reabrir o painel. */
export type VaultMemory = {
  fileListScrollTop: number;
  noteScrollTop: number;
  noteScrollTops: Record<string, number>;
};

export const emptyVaultMemory: VaultMemory = {
  fileListScrollTop: 0,
  noteScrollTop: 0,
  noteScrollTops: {},
};

export const minimumVaultWidth = 300;
export const maximumVaultWidth = 680;

const VaultPanel = lazy(async () => {
  const module = await import("../../features/vault/components/VaultPanel");
  return { default: module.VaultPanel };
});

type RailButtonProps = {
  active: boolean;
  ariaLabel: string;
  icon: "files" | "graph";
  label: string;
  onClick: () => void;
};

function RailButton({ active, ariaLabel, icon, label, onClick }: RailButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={active}
      data-active={active || undefined}
      onClick={onClick}
      type="button"
    >
      <CompactIcon kind={icon} />
      {/* Tooltip real (hover E focus): title isolado não satisfaz acessibilidade. */}
      <span className="rail-tooltip" role="tooltip">
        {label}
      </span>
    </button>
  );
}

type VaultRailProps = {
  activeTab: VaultTab;
  onOpenFiles: () => void;
  onOpenGraph: () => void;
};

/** Estado recolhido do Vault (UX_SPEC §11): coluna estreita com atalhos. */
export function VaultRail({ activeTab, onOpenFiles, onOpenGraph }: VaultRailProps) {
  const { t } = useTranslation();
  return (
    <aside aria-label={t("vault.collapsedVault")} className="vault-rail">
      <RailButton
        active={activeTab === "files"}
        ariaLabel={t("vault.openVaultFiles")}
        icon="files"
        label={t("vault.files")}
        onClick={onOpenFiles}
      />
      <RailButton
        active={activeTab === "graph"}
        ariaLabel={t("vault.openVaultGraph")}
        icon="graph"
        label={t("vault.graph")}
        onClick={onOpenGraph}
      />
    </aside>
  );
}

type VaultSlotProps = {
  cursorAvoidanceEnabled: boolean;
  currentSessionId: string | null;
  memory: VaultMemory;
  onMemoryChange: (memory: VaultMemory) => void;
  onSelectPath: (path: string | null) => void;
  onTabChange: (tab: VaultTab) => void;
  refreshKey: number;
  selectedPath: string | null;
  tab: VaultTab;
  workspaceId: string;
};

/** Conteúdo do painel do Vault dentro do painel redimensionável. */
export function VaultSlot({
  cursorAvoidanceEnabled,
  currentSessionId,
  memory,
  onMemoryChange,
  onSelectPath,
  onTabChange,
  refreshKey,
  selectedPath,
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
          cursorAvoidanceEnabled={cursorAvoidanceEnabled}
          currentSessionId={currentSessionId}
          memory={memory}
          onMemoryChange={onMemoryChange}
          onSelectPath={onSelectPath}
          onTabChange={onTabChange}
          refreshKey={refreshKey}
          selectedPath={selectedPath}
          tab={tab}
          workspaceId={workspaceId}
        />
      </Suspense>
    </div>
  );
}
