// MIT License — Copyright (c) 2026 Mateus Gaio
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import type { ConnectedProvider } from "../../../../shared/api/sidecar";

type ProviderListProps = {
  onEdit: (provider: ConnectedProvider) => void;
  onRemoveRequest: (provider: ConnectedProvider) => void;
  onSelect: (provider: ConnectedProvider) => void;
  providers: ConnectedProvider[];
};

export function ProviderList({ onEdit, onRemoveRequest, onSelect, providers }: ProviderListProps) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-1.5">
      {providers.map((provider) => (
        <article
          className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
          key={provider.id}
        >
          <button
            className="min-w-0 flex-1 text-left focus-visible:outline-none"
            onClick={() => onSelect(provider)}
            type="button"
          >
            <strong className="block truncate text-[0.86rem] font-medium">{provider.name}</strong>
            <span className="font-mono text-[0.68rem] text-muted-foreground">
              {provider.type} · {provider.model || t("settings.noModel")}
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-1">
            <Button onClick={() => onEdit(provider)} size="xs" type="button" variant="ghost">
              {t("settings.edit")}
            </Button>
            <Button
              onClick={() => onRemoveRequest(provider)}
              size="xs"
              type="button"
              variant="destructive"
            >
              {t("settings.remove")}
            </Button>
          </div>
        </article>
      ))}
      {providers.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("settings.noProvidersConfigured")}</p>
      )}
    </div>
  );
}
