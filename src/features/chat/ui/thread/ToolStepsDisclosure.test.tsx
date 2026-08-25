// MIT License — Copyright (c) 2026 Mateus Gaio
import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../../shared/api/sidecar";
import "../../../../i18n";
import { ToolStepsDisclosure } from "./ToolStepsDisclosure";

const steps = [
  { content: "src/index.ts", id: "t1", role: "tool", toolName: "read_file" },
  { content: "", id: "t2", role: "tool", status: "failed", toolName: "apply_patch" },
] as unknown as ChatMessage[];

beforeAll(async () => {
  await i18next.init();
});

describe("disclosure de ações do agente (#218)", () => {
  it("recolhido NÃO contém os rótulos antigos nem o conteúdo dos passos", () => {
    const html = renderToStaticMarkup(<ToolStepsDisclosure steps={steps} />);
    expect(html).toContain('data-testid="agent-steps"');
    expect(html).toContain("Mostrar detalhes de 2 ações");
    expect(html).toContain('role="tooltip"');
    expect(html).not.toContain("agiu");
    expect(html).not.toContain("ver detalhes");
    expect(html).not.toContain("ocultar");
    // Conteúdo cru só existe quando expandido.
    expect(html).not.toContain("read_file");
  });

  it("botão tem ~22px e chevron rotacionável com reduced-motion", () => {
    const html = renderToStaticMarkup(<ToolStepsDisclosure steps={steps} />);
    expect(html).toContain("size-[22px]");
    expect(html).toContain("motion-reduce:transition-none");
    // Recolhido: chevron aponta para a direita e não há rotação aplicada.
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("rotate-90");
  });

  it("variante fallback preserva órfãos no transcript", () => {
    const html = renderToStaticMarkup(<ToolStepsDisclosure steps={steps} variant="fallback" />);
    expect(html).toContain('data-testid="agent-steps"');
  });
});
