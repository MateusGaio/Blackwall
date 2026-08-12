// MIT License — Copyright (c) 2026 Mateus Gaio
import { useEffect, useMemo, useState } from "react";
import { getVault, type VaultGraph } from "../../../shared/api/sidecar";

type VaultPanelProps = {
  onCollapse: () => void;
  onTabChange: (tab: VaultTab) => void;
  tab: VaultTab;
  workspaceId: string;
};

type VaultTab = "files" | "graph";

function nodePosition(index: number, count: number) {
  const angle = count > 1 ? (index / count) * Math.PI * 2 - Math.PI / 2 : 0;
  return { x: 50 + Math.cos(angle) * 35, y: 50 + Math.sin(angle) * 35 };
}

function GraphView({ graph }: { graph: VaultGraph }) {
  const positions = useMemo(
    () =>
      new Map(graph.nodes.map((node, index) => [node.id, nodePosition(index, graph.nodes.length)])),
    [graph.nodes],
  );
  if (!graph.nodes.length) {
    return <p className="vault-empty">Adicione links entre notas Markdown para formar o grafo.</p>;
  }
  return (
    <div aria-label="Grafo de links Markdown" className="vault-graph" role="img">
      <svg aria-hidden="true" preserveAspectRatio="xMidYMid meet" viewBox="0 0 100 100">
        {graph.edges.map((edge) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
          if (!source || !target) return null;
          return (
            <line
              className="vault-graph-edge"
              key={`${edge.source}:${edge.target}`}
              x1={source.x}
              x2={target.x}
              y1={source.y}
              y2={target.y}
            />
          );
        })}
        {graph.nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          return (
            <g key={node.id}>
              <circle className="vault-graph-node" cx={position.x} cy={position.y} r="2.6" />
              <text
                className="vault-graph-label"
                textAnchor="middle"
                x={position.x}
                y={position.y + 6}
              >
                {node.label.slice(0, 18)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function VaultPanel({ onCollapse, onTabChange, tab, workspaceId }: VaultPanelProps) {
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setError("");
    void getVault(workspaceId)
      .then((nextGraph) => {
        if (!cancelled) setGraph(nextGraph);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "Não foi possível ler o Vault.");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return (
    <aside aria-label="Vault do workspace" className="vault-panel">
      <header className="vault-panel-header">
        <div>
          <p className="eyebrow">Conhecimento local</p>
          <strong>Vault</strong>
        </div>
        <button
          aria-label="Recolher Vault"
          className="icon-button"
          onClick={onCollapse}
          title="Recolher Vault"
          type="button"
        >
          ×
        </button>
      </header>
      <div className="vault-tabs" role="tablist" aria-label="Visualização do Vault">
        <button
          aria-selected={tab === "files"}
          className={tab === "files" ? "is-active" : ""}
          onClick={() => onTabChange("files")}
          role="tab"
          type="button"
        >
          Arquivos
        </button>
        <button
          aria-selected={tab === "graph"}
          className={tab === "graph" ? "is-active" : ""}
          onClick={() => onTabChange("graph")}
          role="tab"
          type="button"
        >
          Grafo
        </button>
      </div>
      {!graph && !error && <div aria-busy="true" className="vault-loading skeleton" />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {graph &&
        tab === "files" &&
        (graph.files.length ? (
          <ul className="vault-file-list">
            {graph.files.map((file) => (
              <li key={file.path}>
                <span className="vault-file-icon" aria-hidden="true">
                  #
                </span>
                <span>
                  <strong>{file.title}</strong>
                  <small>{file.path}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="vault-empty">Nenhum arquivo Markdown foi encontrado nesta pasta.</p>
        ))}
      {graph && tab === "graph" && <GraphView graph={graph} />}
      {graph && (
        <p className="vault-count">
          {graph.files.length} arquivos · {graph.edges.length} links
        </p>
      )}
    </aside>
  );
}
