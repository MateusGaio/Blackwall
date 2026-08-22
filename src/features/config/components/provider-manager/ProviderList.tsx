// MIT License — Copyright (c) 2026 Mateus Gaio
import type { ConnectedProvider } from "../../../../shared/api/sidecar";

type ProviderListProps = {
  isEnglish: boolean;
  onEdit: (provider: ConnectedProvider) => void;
  onRemoveRequest: (provider: ConnectedProvider) => void;
  onSelect: (provider: ConnectedProvider) => void;
  providers: ConnectedProvider[];
};

export function ProviderList({
  isEnglish,
  onEdit,
  onRemoveRequest,
  onSelect,
  providers,
}: ProviderListProps) {
  return (
    <div className="provider-list">
      {providers.map((provider) => (
        <article className="provider-row" key={provider.id}>
          <button onClick={() => onSelect(provider)} type="button">
            <strong>{provider.name}</strong>
            <span>
              {provider.type} · {provider.model || (isEnglish ? "no model" : "sem modelo")}
            </span>
          </button>
          <div>
            <button className="text-button" onClick={() => onEdit(provider)} type="button">
              {isEnglish ? "Edit" : "Editar"}
            </button>
            <button
              className="text-button danger"
              onClick={() => onRemoveRequest(provider)}
              type="button"
            >
              {isEnglish ? "Remove" : "Remover"}
            </button>
          </div>
        </article>
      ))}
      {providers.length === 0 && (
        <p className="settings-empty">
          {isEnglish ? "No providers configured." : "Nenhum provedor configurado."}
        </p>
      )}
    </div>
  );
}
