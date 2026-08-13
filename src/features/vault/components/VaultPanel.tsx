// MIT License — Copyright (c) 2026 Mateus Gaio
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { type PointerEvent, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { getVault, type VaultGraph } from "../../../shared/api/sidecar";
import { SafeMarkdown } from "../../../shared/components/SafeMarkdown";
import {
  defaultColorForGroup,
  defaultGraphPreferences,
  type GraphPreferences,
  graphGroupForFile,
  readGraphPreferences,
  writeGraphPreferences,
} from "../graph-preferences";

type VaultPanelProps = {
  onCollapse: () => void;
  onTabChange: (tab: VaultTab) => void;
  tab: VaultTab;
  workspaceId: string;
};

type VaultTab = "files" | "graph";

type GraphNode = SimulationNodeDatum & {
  color: string;
  degree: number;
  group: string;
  id: string;
  label: string;
};

type GraphLink = SimulationLinkDatum<GraphNode>;

type ViewTransform = { scale: number; x: number; y: number };

function GraphIcon({ kind }: { kind: "settings" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {kind === "settings" && (
        <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm0-5.3 1 2.3 2.4.5 1.9-1.5 1.7 1.7-1.5 1.9.5 2.4 2.3 1v2.4l-2.3 1-.5 2.4 1.5 1.9-1.7 1.7-1.9-1.5-2.4.5-1 2.3h-2.4l-1-2.3-2.4-.5-1.9 1.5-1.7-1.7 1.5-1.9-.5-2.4-2.3-1v-2.4l2.3-1 .5-2.4-1.5-1.9 1.7-1.7 1.9 1.5 2.4-.5 1-2.3H12Z" />
      )}
    </svg>
  );
}

function GraphView({
  graph,
  onOpenNote,
  workspaceId,
}: {
  graph: VaultGraph;
  onOpenNote: (path: string) => void;
  workspaceId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const nodesRef = useRef<GraphNode[]>([]);
  const simulationRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null);
  const transformRef = useRef<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const pointerRef = useRef<
    | { kind: "drag"; node: GraphNode; startX: number; startY: number }
    | { kind: "pan"; origin: ViewTransform; startX: number; startY: number }
    | null
  >(null);
  const [preferences, setPreferences] = useState<GraphPreferences>(() =>
    readGraphPreferences(workspaceId),
  );
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const filesByPath = useMemo(
    () => new Map(graph.files.map((file) => [file.path, file])),
    [graph.files],
  );
  const groups = useMemo(
    () =>
      Array.from(
        new Set(
          graph.nodes.map((node) =>
            graphGroupForFile(filesByPath.get(node.path), preferences.groupBy),
          ),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [filesByPath, graph.nodes, preferences.groupBy],
  );
  const { links, nodes } = useMemo(() => {
    const nextNodes = graph.nodes.map((node) => {
      const group = graphGroupForFile(filesByPath.get(node.path), preferences.groupBy);
      return {
        color: preferences.colors[group] ?? defaultColorForGroup(group),
        degree: 0,
        group,
        id: node.id,
        label: node.label,
      } as GraphNode;
    });
    const nodesById = new Map(nextNodes.map((node) => [node.id, node]));
    const nextLinks = graph.edges.flatMap((edge) => {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);
      if (!source || !target) return [];
      source.degree += 1;
      target.degree += 1;
      return [{ source, target } satisfies GraphLink];
    });
    return { links: nextLinks, nodes: nextNodes };
  }, [filesByPath, graph.edges, graph.nodes, preferences.colors, preferences.groupBy]);

  useEffect(() => {
    setPreferences(readGraphPreferences(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    writeGraphPreferences(workspaceId, preferences);
  }, [preferences, workspaceId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const canvasElement = canvas;
    const drawingContext = context;
    let animationFrame = 0;
    let width = 1;
    let height = 1;
    let pixelRatio = 1;

    function scheduleDraw() {
      if (animationFrame) return;
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        draw();
      });
    }

    function draw() {
      const transform = transformRef.current;
      drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawingContext.clearRect(0, 0, width, height);
      drawingContext.save();
      drawingContext.translate(transform.x, transform.y);
      drawingContext.scale(transform.scale, transform.scale);
      drawingContext.lineWidth = Math.max(0.35, 0.75 / transform.scale);
      drawingContext.strokeStyle = "rgb(137 137 142 / 24%)";
      drawingContext.beginPath();
      for (const link of links) {
        const source = link.source as GraphNode;
        const target = link.target as GraphNode;
        if (
          source.x === undefined ||
          source.y === undefined ||
          target.x === undefined ||
          target.y === undefined
        )
          continue;
        drawingContext.moveTo(source.x, source.y);
        drawingContext.lineTo(target.x, target.y);
      }
      drawingContext.stroke();
      for (const node of nodes) {
        if (node.x === undefined || node.y === undefined) continue;
        const radius = 3.6 + Math.min(3.8, node.degree / 10);
        drawingContext.beginPath();
        drawingContext.arc(node.x, node.y, radius, 0, Math.PI * 2);
        drawingContext.fillStyle = node.color;
        drawingContext.fill();
        drawingContext.lineWidth = Math.max(0.45, 0.75 / transform.scale);
        drawingContext.strokeStyle = "rgb(10 10 11 / 72%)";
        drawingContext.stroke();
      }
      drawingContext.restore();
    }

    function resize() {
      const bounds = canvasElement.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvasElement.width = Math.round(width * pixelRatio);
      canvasElement.height = Math.round(height * pixelRatio);
      const simulation = simulationRef.current;
      simulation?.force(
        "center-x",
        forceX<GraphNode>(width / 2).strength(preferences.centerStrength),
      );
      simulation?.force(
        "center-y",
        forceY<GraphNode>(height / 2).strength(preferences.centerStrength),
      );
      simulation?.alpha(0.45).restart();
      scheduleDraw();
    }

    nodesRef.current = nodes;
    const simulation = forceSimulation<GraphNode>(nodes)
      .force("charge", forceManyBody<GraphNode>().strength(preferences.chargeStrength))
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(links)
          .id((node) => node.id)
          .distance(preferences.linkDistance)
          .strength(0.38),
      )
      .force("center-x", forceX<GraphNode>(width / 2).strength(preferences.centerStrength))
      .force("center-y", forceY<GraphNode>(height / 2).strength(preferences.centerStrength))
      .force(
        "collision",
        forceCollide<GraphNode>((node) => 6 + Math.min(5, node.degree / 8)),
      )
      .alphaDecay(0.035)
      .velocityDecay(0.42)
      .on("tick", scheduleDraw);
    simulationRef.current = simulation;
    drawRef.current = draw;
    const observer = new ResizeObserver(resize);
    observer.observe(canvasElement);
    resize();

    return () => {
      observer.disconnect();
      simulation.stop();
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (simulationRef.current === simulation) simulationRef.current = null;
    };
  }, [
    links,
    nodes,
    preferences.centerStrength,
    preferences.chargeStrength,
    preferences.linkDistance,
  ]);

  if (!graph.nodes.length) {
    return <p className="vault-empty">Adicione links entre notas Markdown para formar o grafo.</p>;
  }

  function updatePreferences(next: Partial<GraphPreferences>) {
    setPreferences((current) => ({ ...current, ...next }));
  }

  function pointFor(event: PointerEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function worldPoint(point: { x: number; y: number }) {
    const transform = transformRef.current;
    return {
      x: (point.x - transform.x) / transform.scale,
      y: (point.y - transform.y) / transform.scale,
    };
  }

  function nodeAt(point: { x: number; y: number }) {
    const world = worldPoint(point);
    return nodesRef.current.find((node) => {
      const radius = 6 + Math.min(5, node.degree / 8);
      return Math.hypot((node.x ?? 0) - world.x, (node.y ?? 0) - world.y) <= radius + 4;
    });
  }

  return (
    <div aria-label="Grafo de links Markdown" className="vault-graph" role="img">
      <canvas
        aria-label="Grafo interativo de links Markdown"
        className="vault-graph-canvas"
        onPointerDown={(event) => {
          const point = pointFor(event);
          const node = nodeAt(point);
          event.currentTarget.setPointerCapture(event.pointerId);
          if (node) {
            const world = worldPoint(point);
            node.fx = world.x;
            node.fy = world.y;
            pointerRef.current = { kind: "drag", node, startX: point.x, startY: point.y };
            simulationRef.current?.alphaTarget(0.25).restart();
            return;
          }
          pointerRef.current = {
            kind: "pan",
            origin: { ...transformRef.current },
            startX: point.x,
            startY: point.y,
          };
        }}
        onPointerMove={(event) => {
          const point = pointFor(event);
          const pointer = pointerRef.current;
          if (pointer?.kind === "drag") {
            const world = worldPoint(point);
            pointer.node.fx = world.x;
            pointer.node.fy = world.y;
            simulationRef.current?.alpha(0.3).restart();
            drawRef.current();
            return;
          }
          if (pointer?.kind === "pan") {
            transformRef.current = {
              ...pointer.origin,
              x: pointer.origin.x + point.x - pointer.startX,
              y: pointer.origin.y + point.y - pointer.startY,
            };
            drawRef.current();
            return;
          }
          const nextHovered = nodeAt(point) ?? null;
          setHoveredNode((current) => (current?.id === nextHovered?.id ? current : nextHovered));
        }}
        onPointerUp={(event) => {
          const pointer = pointerRef.current;
          if (pointer?.kind === "drag") {
            const point = pointFor(event);
            if (Math.hypot(point.x - pointer.startX, point.y - pointer.startY) < 6) {
              onOpenNote(pointer.node.id);
            }
            pointer.node.fx = null;
            pointer.node.fy = null;
            simulationRef.current?.alphaTarget(0);
          }
          pointerRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onWheel={(event) => {
          event.preventDefault();
          const point = pointFor(event);
          const current = transformRef.current;
          const scale = Math.min(
            3.5,
            Math.max(0.35, current.scale * (event.deltaY > 0 ? 0.9 : 1.1)),
          );
          transformRef.current = {
            scale,
            x: point.x - ((point.x - current.x) / current.scale) * scale,
            y: point.y - ((point.y - current.y) / current.scale) * scale,
          };
          drawRef.current();
        }}
        ref={canvasRef}
      />
      <button
        aria-expanded={settingsOpen}
        aria-label="Configurar física do grafo"
        className="graph-settings-toggle"
        onClick={() => setSettingsOpen((current) => !current)}
        type="button"
      >
        <GraphIcon kind="settings" />
      </button>
      {settingsOpen && (
        <section aria-label="Configurações da física" className="graph-settings-popover">
          <label>
            Agrupar por
            <select
              onChange={(event) =>
                updatePreferences({ groupBy: event.target.value as GraphPreferences["groupBy"] })
              }
              value={preferences.groupBy}
            >
              <option value="folder">Pasta</option>
              <option value="tag">Tag</option>
            </select>
          </label>
          <label>
            Força de repulsão <output>{Math.abs(preferences.chargeStrength)}</output>
            <input
              max="-40"
              min="-600"
              onChange={(event) =>
                updatePreferences({ chargeStrength: Number(event.target.value) })
              }
              step="10"
              type="range"
              value={preferences.chargeStrength}
            />
          </label>
          <label>
            Distância de link <output>{preferences.linkDistance}</output>
            <input
              max="160"
              min="20"
              onChange={(event) => updatePreferences({ linkDistance: Number(event.target.value) })}
              step="2"
              type="range"
              value={preferences.linkDistance}
            />
          </label>
          <label>
            Força central <output>{preferences.centerStrength.toFixed(2)}</output>
            <input
              max="0.3"
              min="0.01"
              onChange={(event) =>
                updatePreferences({ centerStrength: Number(event.target.value) })
              }
              step="0.01"
              type="range"
              value={preferences.centerStrength}
            />
          </label>
          <div className="graph-group-colors">
            <p>Cores dos grupos</p>
            {groups.map((group) => (
              <label key={group}>
                <span>{group}</span>
                <input
                  aria-label={`Cor de ${group}`}
                  onChange={(event) =>
                    updatePreferences({
                      colors: { ...preferences.colors, [group]: event.target.value },
                    })
                  }
                  type="color"
                  value={preferences.colors[group] ?? defaultColorForGroup(group)}
                />
              </label>
            ))}
          </div>
          <button onClick={() => setPreferences(defaultGraphPreferences)} type="button">
            Restaurar padrão
          </button>
        </section>
      )}
      {hoveredNode && <p className="graph-hover-label">{hoveredNode.label}</p>}
    </div>
  );
}

export function VaultPanel({ onCollapse, onTabChange, tab, workspaceId }: VaultPanelProps) {
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [error, setError] = useState("");
  const [selectedNotePath, setSelectedNotePath] = useState<string | null>(null);
  const [fileListScrollTop, setFileListScrollTop] = useState(0);
  const fileListRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setError("");
    setSelectedNotePath(null);
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

  const selectedNote = graph?.files.find((file) => file.path === selectedNotePath) ?? null;

  function openNote(path: string) {
    if (!graph?.files.some((file) => file.path === path)) return;
    if (!selectedNotePath && fileListRef.current)
      setFileListScrollTop(fileListRef.current.scrollTop);
    setSelectedNotePath(path);
    onTabChange("files");
  }

  function closeNote() {
    setSelectedNotePath(null);
    requestAnimationFrame(() => fileListRef.current?.scrollTo({ top: fileListScrollTop }));
  }

  return (
    <aside aria-label="Vault do workspace" className="vault-panel">
      <header className="vault-panel-header">
        <strong>Vault</strong>
        <button
          aria-label="Recolher Vault"
          className="vault-collapse-button"
          onClick={onCollapse}
          title="Recolher Vault"
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 5h16v14H4V5Zm5 0v14M15 9l-3 3 3 3" />
          </svg>
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
        (selectedNote ? (
          <section aria-label={`Nota ${selectedNote.title}`} className="vault-note-reader">
            <div className="vault-note-toolbar">
              <button className="text-button" onClick={closeNote} type="button">
                ← Arquivos
              </button>
            </div>
            <header>
              <p className="eyebrow">{selectedNote.path}</p>
              <h2>{selectedNote.title}</h2>
            </header>
            <article className="vault-note-content">
              <SafeMarkdown
                content={selectedNote.content}
                currentPath={selectedNote.path}
                files={graph.files}
                onLocalLink={openNote}
              />
            </article>
          </section>
        ) : graph.files.length ? (
          <ul
            className="vault-file-list"
            onScroll={(event) => setFileListScrollTop(event.currentTarget.scrollTop)}
            ref={fileListRef}
          >
            {graph.files.map((file) => (
              <li key={file.path}>
                <span className="vault-file-icon" aria-hidden="true">
                  #
                </span>
                <button
                  className="vault-file-button"
                  onClick={() => openNote(file.path)}
                  type="button"
                >
                  <strong>{file.title}</strong>
                  <small>{file.path}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="vault-empty">Nenhum arquivo Markdown foi encontrado nesta pasta.</p>
        ))}
      {graph && tab === "graph" && (
        <div className="vault-graph-frame">
          <GraphView graph={graph} onOpenNote={openNote} workspaceId={workspaceId} />
          <p className="vault-count" aria-live="polite">
            {graph.files.length} arquivos · {graph.edges.length} links
          </p>
        </div>
      )}
    </aside>
  );
}
