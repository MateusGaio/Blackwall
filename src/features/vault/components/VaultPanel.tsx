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
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/shared/components/motion/Skeleton";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import type { VaultMemory } from "../../../app/shell/VaultSlot";
import type { VaultTab } from "../../../app/vault-view";
import { getVault, type VaultGraph } from "../../../shared/api/sidecar";
import {
  defaultColorForGroup,
  defaultGraphPreferences,
  type GraphPreferences,
  graphGroupForFile,
  readGraphPreferences,
  writeGraphPreferences,
} from "../graph-preferences";
import { clampGraphZoom } from "../graph-zoom";
import { FileWorkbench } from "./FileWorkbench";

type VaultPanelProps = {
  cursorAvoidanceEnabled: boolean;
  currentSessionId: string | null;
  memory: VaultMemory;
  /** Posição de leitura (lista + nota) preservada entre recolher/reabrir. */
  onMemoryChange: (memory: VaultMemory) => void;
  onOpenDatafort?: (path: string) => void;
  onSelectPath: (path: string | null) => void;
  onTabChange: (tab: VaultTab) => void;
  refreshKey?: number;
  selectedPath: string | null;
  tab: VaultTab;
  workspaceId: string;
};

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
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      {kind === "settings" && (
        <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm0-5.3 1 2.3 2.4.5 1.9-1.5 1.7 1.7-1.5 1.9.5 2.4 2.3 1v2.4l-2.3 1-.5 2.4 1.5 1.9-1.7 1.7-1.9-1.5-2.4.5-1 2.3h-2.4l-1-2.3-2.4-.5-1.9 1.5-1.7-1.7 1.5-1.9-.5-2.4-2.3-1v-2.4l2.3-1 .5-2.4-1.5-1.9 1.7-1.7 1.9 1.5 2.4-.5 1-2.3H12Z" />
      )}
    </svg>
  );
}

const graphFieldLabel = "grid gap-1 font-mono text-[0.7rem] text-muted-foreground";

type VaultTreeNode =
  | { children: VaultTreeNode[]; kind: "folder"; name: string; path: string }
  | { kind: "file"; name: string; path: string };

/** Converte paths planos do Vault ("pasta/sub/nota.md") em árvore ordenada. */
export function buildFileTree(files: ReadonlyArray<{ path: string; title: string }>) {
  const root: VaultTreeNode[] = [];
  const folderByPath = new Map<string, Extract<VaultTreeNode, { kind: "folder" }>>();
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path));
  for (const file of ordered) {
    const segments = file.path.split("/").filter(Boolean);
    let container = root;
    let accumulated = "";
    for (const segment of segments.slice(0, -1)) {
      accumulated = accumulated ? `${accumulated}/${segment}` : segment;
      let folder = folderByPath.get(accumulated);
      if (!folder) {
        folder = { children: [], kind: "folder", name: segment, path: accumulated };
        folderByPath.set(accumulated, folder);
        container.push(folder);
      }
      container = folder.children;
    }
    const name = segments.at(-1) ?? file.path;
    container.push({ kind: "file", name: file.title || name, path: file.path });
  }
  const sortNodes = (nodes: VaultTreeNode[]): VaultTreeNode[] =>
    nodes
      .map((node) =>
        node.kind === "folder" ? { ...node, children: sortNodes(node.children) } : node,
      )
      .sort((left, right) =>
        left.kind === right.kind
          ? left.name.localeCompare(right.name)
          : left.kind === "folder"
            ? -1
            : 1,
      );
  return sortNodes(root);
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
  const { t } = useTranslation();
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
  const [zoomScale, setZoomScale] = useState(1);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const filesByPath = useMemo(
    () => new Map(graph.files.map((file) => [file.path, file])),
    [graph.files],
  );
  // Grupos em memo próprio: é aqui que o conteúdo das notas é escaneado por
  // regex — não pode re-rodar quando só uma cor muda.
  const groupByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of graph.nodes)
      map.set(node.path, graphGroupForFile(filesByPath.get(node.path), preferences.groupBy));
    return map;
  }, [filesByPath, graph.nodes, preferences.groupBy]);
  const groups = useMemo(
    () =>
      Array.from(new Set(groupByPath.values())).sort((left, right) => left.localeCompare(right)),
    [groupByPath],
  );
  const colorByGroup = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups)
      map.set(group, preferences.colors[group] ?? defaultColorForGroup(group));
    return map;
  }, [groups, preferences.colors]);
  // Identidade dos nós NÃO depende de cores: trocar uma cor no painel não
  // pode recriar nós (derrubaria a simulação d3 e o layout atual).
  const { links, nodes } = useMemo(() => {
    const nextNodes = graph.nodes.map((node) => {
      const group = groupByPath.get(node.path) ?? "";
      return {
        degree: 0,
        group,
        id: node.id,
        label: node.label,
      } as unknown as GraphNode;
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
  }, [graph.edges, graph.nodes, groupByPath]);

  useEffect(() => {
    setPreferences(readGraphPreferences(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    writeGraphPreferences(workspaceId, preferences);
  }, [preferences, workspaceId]);

  const colorByGroupRef = useRef(colorByGroup);
  useEffect(() => {
    colorByGroupRef.current = colorByGroup;
    drawRef.current();
  }, [colorByGroup]);

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
        drawingContext.fillStyle =
          colorByGroupRef.current.get(node.group) ?? defaultColorForGroup(node.group);
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
    return (
      <p className="p-4 text-sm text-muted-foreground">{t("vault.addLinksBetweenMarkdownNotes")}</p>
    );
  }

  // Identificadores @… são sentinels internas do grafo; o rótulo visível
  // resolve pelas chaves de tradução correspondentes.
  function groupLabel(group: string) {
    const key =
      group === "@ungrouped"
        ? "vault.groupUngrouped"
        : group === "@root"
          ? "vault.groupRoot"
          : group === "@untagged"
            ? "vault.groupUntagged"
            : null;
    return key ? t(key) : group;
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
    <div
      aria-label={t("vault.markdownLinkGraph")}
      className="vault-graph relative min-h-0 flex-1 bg-background"
      role="img"
    >
      <canvas
        aria-label={t("vault.interactiveMarkdownLinkGraph")}
        className="vault-graph-canvas absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
        data-zoom={zoomScale}
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
          const scale = clampGraphZoom(current.scale * (event.deltaY > 0 ? 0.9 : 1.1));
          transformRef.current = {
            scale,
            x: point.x - ((point.x - current.x) / current.scale) * scale,
            y: point.y - ((point.y - current.y) / current.scale) * scale,
          };
          setZoomScale(scale);
          drawRef.current();
        }}
        ref={canvasRef}
      />
      <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
        <PopoverTrigger
          aria-label={t("vault.configureGraphPhysics")}
          className="absolute top-3 right-3 z-10"
          title={t("vault.configureGraphPhysics")}
          asChild
        >
          <Button size="icon-sm" variant="outline">
            <GraphIcon kind="settings" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3">
          <section aria-label={t("vault.physicsSettings")} className="grid gap-3">
            <div className={graphFieldLabel}>
              {t("vault.groupBy")}
              <Select
                value={preferences.groupBy}
                onValueChange={(value) =>
                  updatePreferences({ groupBy: value as GraphPreferences["groupBy"] })
                }
              >
                <SelectTrigger aria-label={t("vault.groupBy")} className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="folder">{t("vault.folder")}</SelectItem>
                  <SelectItem value="tag">Tag</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className={graphFieldLabel}>
              {t("vault.repulsionStrength")} <output>{Math.abs(preferences.chargeStrength)}</output>
              <input
                className="w-full accent-foreground"
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
            <label className={graphFieldLabel}>
              {t("vault.linkDistance")} <output>{preferences.linkDistance}</output>
              <input
                className="w-full accent-foreground"
                max="160"
                min="20"
                onChange={(event) =>
                  updatePreferences({ linkDistance: Number(event.target.value) })
                }
                step="2"
                type="range"
                value={preferences.linkDistance}
              />
            </label>
            <label className={graphFieldLabel}>
              {t("vault.centerStrength")} <output>{preferences.centerStrength.toFixed(2)}</output>
              <input
                className="w-full accent-foreground"
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
            <div className="grid gap-1.5">
              <p className="font-mono text-[0.7rem] text-muted-foreground">
                {t("vault.groupColors")}
              </p>
              {groups.map((group) => (
                <label className="flex items-center justify-between gap-2 text-xs" key={group}>
                  <span className="truncate">{groupLabel(group)}</span>
                  <input
                    aria-label={`${t("vault.colorFor")} ${groupLabel(group)}`}
                    className="size-6 cursor-pointer border border-border bg-transparent"
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
            <Button
              onClick={() => setPreferences(defaultGraphPreferences)}
              size="sm"
              variant="outline"
            >
              {t("vault.resetDefaults")}
            </Button>
          </section>
        </PopoverContent>
      </Popover>
      {hoveredNode && (
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background/90 px-3 py-1 font-mono text-xs text-muted-foreground">
          {hoveredNode.label}
        </p>
      )}
    </div>
  );
}

export function VaultPanel({
  cursorAvoidanceEnabled,
  currentSessionId,
  memory,
  onMemoryChange,
  onOpenDatafort,
  onSelectPath,
  onTabChange,
  refreshKey = 0,
  selectedPath,
  tab,
  workspaceId,
}: VaultPanelProps) {
  const { t } = useTranslation();
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // The increment is the explicit signal that a tool changed workspace files.
    void refreshKey;
    let cancelled = false;
    setGraph(null);
    setError("");
    void getVault(workspaceId)
      .then((nextGraph) => {
        if (!cancelled) setGraph(nextGraph);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : t("vault.couldNotReadTheVault"));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, t, workspaceId]);

  function openNote(path: string) {
    if (!graph?.files.some((file) => file.path === path)) return;
    onSelectPath(path);
    onTabChange("files");
  }

  return (
    <aside
      aria-label={t("vault.workspaceVault")}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <header className="flex items-center justify-between px-4 pt-3 pb-1">
        <strong className="font-mono text-sm tracking-wide">Vault</strong>
        {/* Controle único (comentários 4–5): recolher é atributo do toggle do
        header; nenhum botão redundante dentro do painel. */}
      </header>
      <Tabs
        className="border-b border-neutral-800/60 px-3 pb-1"
        value={tab}
        onValueChange={(value) => onTabChange(value as VaultTab)}
      >
        <TabsList aria-label={t("vault.vaultView")} className="w-full bg-transparent">
          <TabsTrigger value="files">{t("vault.files")}</TabsTrigger>
          <TabsTrigger value="graph">{t("vault.graph")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {error && (
        <p className="m-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {tab === "files" && (
        <FileWorkbench
          cursorAvoidanceEnabled={cursorAvoidanceEnabled}
          graph={graph ?? { edges: [], files: [], nodes: [] }}
          memory={memory}
          onMemoryChange={onMemoryChange}
          onOpenDatafort={onOpenDatafort}
          onSelectPath={onSelectPath}
          refreshKey={refreshKey}
          selectedPath={selectedPath}
          sessionId={currentSessionId}
          workspaceId={workspaceId}
        />
      )}
      {tab === "graph" &&
        (graph ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <GraphView graph={graph} onOpenNote={openNote} workspaceId={workspaceId} />
            <p
              aria-live="polite"
              className="px-4 py-2 font-mono text-[0.7rem] text-muted-foreground"
            >
              {graph.files.length} {t("vault.files2")} · {graph.edges.length} links
            </p>
          </div>
        ) : (
          <div aria-busy="true" className="min-h-0 flex-1 p-4">
            <Skeleton className="h-full" />
          </div>
        ))}
    </aside>
  );
}
