// MIT License — Copyright (c) 2026 Mateus Gaio
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { type MouseEvent, useEffect, useRef } from "react";
import type { VaultGraph } from "@/shared/api/sidecar";
import { usePrefersReducedMotion } from "@/shared/components/motion/usePrefersReducedMotion";

type Node = SimulationNodeDatum & { id: string; label: string; path: string };
type Link = SimulationLinkDatum<Node> & { source: string | Node; target: string | Node };

export function DatafortGraph({
  graph,
  onOpenPath,
  compact = false,
}: {
  graph: VaultGraph;
  onOpenPath: (path: string, group?: 0 | 1) => void;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || graph.nodes.length === 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const nodes: Node[] = graph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      path: node.path,
    }));
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const links = graph.edges.flatMap((edge) => {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);
      return source && target ? [{ source, target }] : [];
    });
    nodesRef.current = nodes;
    let width = 1;
    let height = 1;
    let frame = 0;

    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;
      context.strokeStyle = "rgb(150 150 160 / 22%)";
      for (const link of links) {
        const source = link.source as Node;
        const target = link.target as Node;
        if (
          source.x === undefined ||
          source.y === undefined ||
          target.x === undefined ||
          target.y === undefined
        )
          continue;
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
      }
      for (const node of nodes) {
        if (node.x === undefined || node.y === undefined) continue;
        context.beginPath();
        context.arc(node.x, node.y, compact ? 4 : 6, 0, Math.PI * 2);
        context.fillStyle = compact ? "#8b90a5" : "#bfc6e8";
        context.fill();
      }
    };
    const scheduleDraw = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      simulation.force("center", forceCenter(width / 2, height / 2));
      if (!reducedMotion) simulation.alpha(0.3).restart();
      else draw();
    };
    const simulation = forceSimulation<Node>(nodes)
      .force("charge", forceManyBody<Node>().strength(compact ? -38 : -90))
      .force(
        "link",
        forceLink<Node, Link>(links)
          .id((node) => node.id)
          .distance(compact ? 36 : 78),
      )
      .force("center", forceCenter(width / 2, height / 2))
      .force("collision", forceCollide<Node>(compact ? 8 : 13))
      .alphaDecay(reducedMotion ? 1 : 0.045)
      .on("tick", scheduleDraw);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (reducedMotion) {
      simulation.tick(90);
      simulation.stop();
      draw();
    }
    return () => {
      observer.disconnect();
      simulation.stop();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [compact, graph, reducedMotion]);

  if (!graph.nodes.length)
    return <p className="datafort-empty-copy">Ainda não há conexões no grafo.</p>;

  function openNode(event: MouseEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const node = nodesRef.current.find(
      (item) => Math.hypot((item.x ?? 0) - x, (item.y ?? 0) - y) < (compact ? 12 : 16),
    );
    if (node) onOpenPath(node.path, event.metaKey || event.ctrlKey ? 1 : 0);
  }

  return (
    <canvas
      aria-label={compact ? "Grafo local de links" : "Grafo global de links"}
      className={`datafort-graph-canvas ${compact ? "is-compact" : ""}`}
      onClick={openNode}
      ref={canvasRef}
    />
  );
}
