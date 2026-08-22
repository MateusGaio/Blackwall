// MIT License — Copyright (c) 2026 Mateus Gaio
import { useTranslation } from "react-i18next";
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
    <div className="provider-list">
      {providers.map((provider) => (
        <article className="provider-row" key={provider.id}>
          <button onClick={() => onSelect(provider)} type="button">
            <strong>{provider.name}</strong>
            <span>
              {provider.type} · {provider.model || t("settings.noModel")}
            </span>
          </button>
          <div>
            <button className="text-button" onClick={() => onEdit(provider)} type="button">
              {t("settings.edit")}
            </button>
            <button
              className="text-button danger"
              onClick={() => onRemoveRequest(provider)}
              type="button"
            >
              {t("settings.remove")}
            </button>
          </div>
        </article>
      ))}
      {providers.length === 0 && (
        <p className="settings-empty">{t("settings.noProvidersConfigured")}</p>
      )}
    </div>
  );
}
