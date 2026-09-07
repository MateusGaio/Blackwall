// MIT License — Copyright (c) 2026 Mateus Gaio

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { McpSettingsSection } from "./McpSettingsSection";

describe("McpSettingsSection", () => {
  it("aplica o wrapper de movimento ao formulário ativo sem mudar sua semântica", () => {
    const html = renderToStaticMarkup(<McpSettingsSection activeWorkspaceId="workspace-a" />);

    expect(html).toContain('id="mcp-transport"');
    expect(html.match(/data-slot="motion-enter-exit"/g)).toHaveLength(1);
    expect(html).toContain('id="mcp-command"');
    expect(html).toContain("fieldset");
  });

  it("explica que um workspace é necessário antes de configurar MCP", () => {
    const html = renderToStaticMarkup(<McpSettingsSection activeWorkspaceId={null} />);
    expect(html).toContain("Selecione um workspace");
  });
});
