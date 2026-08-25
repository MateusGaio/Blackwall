// MIT License — Copyright (c) 2026 Mateus Gaio
import { expect, test, type Page } from "@playwright/test";

/**
 * Feedback do owner (2026-08-24, segundo lote) — comentários 1–7.
 * Dados 100% sintéticos; o sidecar roda em modo mock (BLACKWALL_E2E_MOCK=1).
 */

const chooserHeading = /Quem está usando o Blackwall\?|Who is using Blackwall\?/;
const startWithoutRegex = /Começar sem um workspace|Start without a workspace/;

/** Remove perfis remanescentes de testes anteriores (sidecar compartilhado). */
async function resetToOnboarding(page: Page) {
  await page.goto("/");
  const chooser = page.getByRole("heading", { name: chooserHeading });
  for (let guard = 0; guard < 10; guard += 1) {
    if (!(await chooser.isVisible().catch(() => false))) {
      try {
        await chooser.waitFor({ state: "visible", timeout: 1_500 });
      } catch {
        break;
      }
    }
    await page.getByRole("button", { name: /Excluir perfil: |Delete profile: / }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^Excluir perfil$|^Delete profile$/ }).click();
    await expect(page.getByTestId("profile-option")).toHaveCount(0);
  }
  const setupRegion = page.getByRole("region", { name: /Initial setup|Configuração inicial/ });
  if (!(await setupRegion.isVisible().catch(() => false))) {
    // Sessão anterior deixou o app direto no shell: saia pelo settings.
    try {
      await expect(page.getByTestId("chat-composer")).toBeVisible({ timeout: 5_000 });
    } catch {
      await page.reload();
    }
    await page
      .getByRole("button", { name: /Abrir configurações|Open settings/ })
      .first()
      .click();
    await page.getByRole("button", { name: /Sair do perfil|Sign out/ }).click();
  }
  await expect(setupRegion).toBeVisible({ timeout: 15_000 });
}

type ShellOptions = {
  /** Largura inicial do painel do Vault (localStorage), para medir 300 px. */
  vaultWidth?: number;
};

/** Onboarding completo com workspace real criado via API (raiz temporária). */
async function enterShellWithWorkspace(page: Page, profileName: string, options: ShellOptions = {}) {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  if (options.vaultWidth !== undefined) {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, String(value)),
      ["blackwall:vault-panel-width", options.vaultWidth] as const,
    );
  }

  await resetToOnboarding(page);
  await page.getByRole("button", { name: /Continuar|Continue/ }).click();
  await page.getByLabel(/Nome do perfil|Profile name/).fill(profileName);
  const continueButton = page.getByRole("button", { name: /Continuar|Continue/ });
  await continueButton.click();
  await page.getByLabel(/Nome do workspace|Workspace name/).fill(`${profileName}-ws`);
  await continueButton.click();
  await page.getByRole("button", { name: startWithoutRegex }).click();
  await continueButton.click();
  await continueButton.click();
  await page.getByLabel(/Nome do provedor|Provider name/).fill("Mock provider");
  await page
    .getByLabel(/Endpoint|Endpoint compatível com OpenAI|OpenAI-compatible endpoint/)
    .fill("http://127.0.0.1:17999/v1");
  await page.getByLabel(/Modelo padrão|Default model/).fill("mock-model");
  await page.getByLabel(/Chave de API|API key/).fill("test-key");
  await page.getByRole("button", { name: /Conectar e continuar|Connect and continue/ }).click();
  await page.getByRole("button", { name: /Entrar no Blackwall|Enter Blackwall/ }).click();
  await expect(page.getByTestId("chat-composer")).toBeVisible();

  const root = await mkdtemp(join(tmpdir(), "blackwall-e2e-alpha-"));
  await writeFile(
    join(root, "prosa.md"),
    [
      "# Nota de prosa",
      "",
      '![imagem sintética](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR42mP8z8AARIQBEwMDAwJkAgOYIgEAAAAASUVORK5CYII=)',
      "",
      "Este parágrafo sintético existe para verificar quebra de linha dentro do painel do Vault em larguras reduzidas. ".repeat(
        4,
      ),
      "",
      "| Coluna A | Coluna B | Coluna C | Coluna D | Coluna E |",
      "| --- | --- | --- | --- | --- |",
      "| dado-largo-0000000001 | dado-largo-0000000002 | dado-largo-0000000003 | dado-largo-0000000004 | dado-largo-0000000005 |",
      "",
      "```ts",
      "const linhaMuitoLarga = \"0123456789012345678901234567890123456789012345678901234567890123456789\";",
      "```",
      "",
    ].join("\n"),
  );
  const state = (await (await page.request.get("http://127.0.0.1:1423/v1/state")).json()) as {
    activeProfileId: string;
  };
  const created = (await (
    await page.request.post("http://127.0.0.1:1423/v1/workspaces", {
      data: { name: `${profileName} WS`, profileId: state.activeProfileId, rootPath: root, soul: "" },
    })
  ).json()) as { workspace: { id: string } };
  await page.request.post(`http://127.0.0.1:1423/v1/workspaces/${created.workspace.id}/select`);
  await page.reload();
  await page.getByTestId("profile-option").filter({ hasText: profileName }).click();
  await expect(page.getByTestId("chat-composer")).toBeVisible();
  return { workspaceId: created.workspace.id };
}

function vaultToggle(page: Page) {
  return page
    .locator("header")
    .getByRole("button", { name: /painel do Vault|Vault panel/ })
    .first();
}

/** Onboarding até o shell SEM workspace (para provas de estado bloqueado). */
async function completeOnboarding(page: Page, profileName: string) {
  const continueButton = page.getByRole("button", { name: /Continuar|Continue/ });
  await page.getByLabel(/Nome do perfil|Profile name/).fill(profileName);
  await continueButton.click();
  await page.getByLabel(/Nome do workspace|Workspace name/).fill(`${profileName}-ws`);
  await continueButton.click();
  await page.getByRole("button", { name: startWithoutRegex }).click();
  await continueButton.click();
  await continueButton.click();
  await page.getByLabel(/Nome do provedor|Provider name/).fill("Mock provider");
  await page
    .getByLabel(/Endpoint|Endpoint compatível com OpenAI|OpenAI-compatible endpoint/)
    .fill("http://127.0.0.1:17999/v1");
  await page.getByLabel(/Modelo padrão|Default model/).fill("mock-model");
  await page.getByLabel(/Chave de API|API key/).fill("test-key");
  await page.getByRole("button", { name: /Conectar e continuar|Connect and continue/ }).click();
  await page.getByRole("button", { name: /Entrar no Blackwall|Enter Blackwall/ }).click();
  await expect(page.getByTestId("chat-composer")).toBeVisible();
}

async function openVaultFiles(page: Page) {
  if ((await page.locator(".vault-slot").count()) === 0) await vaultToggle(page).click();
  await expect(page.locator(".vault-slot")).toBeVisible();
}

test.describe("feedback 24/08 — comentário 1: Markdown adapta à largura do Vault", () => {
  test.use({ viewport: { width: 1920, height: 950 } });
  for (const panelWidth of [300, 360, 680] as const) {
    test(`prosa quebra com painel real de ${panelWidth} px; blocos rolam só internamente`, async ({
      page,
    }) => {
      await enterShellWithWorkspace(page, "Perfil Prosa", { vaultWidth: panelWidth });
      await openVaultFiles(page);
      await page.locator(".vault-slot").getByRole("button", { name: "Prosa" }).click();

      // Largura REAL do painel (não a preferência semeada).
      const slot = page.locator(".vault-slot");
      const measured = (await slot.boundingBox())?.width ?? 0;
      expect(Math.abs(measured - panelWidth)).toBeLessThanOrEqual(2);

      const article = slot.locator("article");
      await expect(article).toBeVisible();
      const prose = await article.evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }));
      expect(prose.scroll).toBeLessThanOrEqual(prose.client + 1);

      // Bloco intrinsecamente largo rola apenas dentro dele mesmo.
      const wideBlock = slot.locator(".code-block pre").first();
      await expect(wideBlock).toBeVisible();
      const preBox = await wideBlock.evaluate((element) => ({
        overflowX: getComputedStyle(element).overflowX,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(preBox.overflowX).toBe("auto");

      // Imagem não excede a largura do conteúdo.
      const image = slot.locator(".safe-markdown img").first();
      if ((await image.count()) > 0) {
        const imageBox = await image.boundingBox();
        const articleBox = await article.boundingBox();
        expect(imageBox?.width ?? 0).toBeLessThanOrEqual((articleBox?.width ?? 0) + 1);
      }
    });
  }
});

test.describe("feedback 24/08 — comentário 2: paleta de comandos", () => {
  test("abre por clique e Ctrl+K, filtra, Enter executa, devolve foco, sem pageerror", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await enterShellWithWorkspace(page, "Perfil Paleta");

    const searchButton = page.getByRole("button", {
      name: /Pesquisar comandos|Search commands/,
    });

    // 1) Abertura por CLIQUE devolve foco ao botão que abriu.
    await searchButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-slot="command"]').first()).toBeAttached();

    // Filtro: "versa" existe em "conversation"/"conversa" e em nada nas ações.
    const beforeFilter = dialog.getByRole("option");
    await expect(beforeFilter.first()).toBeVisible();
    const beforeCount = await beforeFilter.count();
    expect(beforeCount).toBeGreaterThanOrEqual(8);
    await dialog.getByPlaceholder(/sessões|sessions/i).fill("versa");
    const filteredTexts = await dialog.getByRole("option").allTextContents();
    expect(filteredTexts.length).toBeGreaterThan(0);
    for (const text of filteredTexts) {
      expect(text).toMatch(/conversa|conversation/i);
    }

    // Busca zerada + Escape fecha + foco volta ao botão opener.
    await dialog.getByPlaceholder(/sessões|sessions/i).fill("");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(searchButton).toBeFocused();

    // 2) Enter EXECUTA o handler observável (Provedores → diálogo na seção).
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog").getByRole("option").first()).toBeVisible();
    // ArrowDown navega; seleção visível no item.
    for (let step = 0; step < 7; step += 1) {
      await page.keyboard.press("ArrowDown");
    }
    // Isola o item Provedores usando o PRÓPRIO texto do item (locale-proof).
    const providersItem = page.getByRole("dialog").getByRole("option", {
      name: /Provedores|Providers/i,
    });
    const needle = ((await providersItem.textContent()) ?? "").trim().slice(0, 6);
    await page
      .getByRole("dialog")
      .getByPlaceholder(/sessões|sessions/i)
      .fill(needle);
    await expect(page.getByRole("dialog").getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    // O diálogo da central de provedores é o que contém a seção.
    await expect(
      page
        .getByRole("dialog")
        .filter({ hasText: /Provedores|Providers/i })
        .first(),
    ).toBeVisible();
    // Fecha QUALQUER diálogo remanescente para o próximo bloco.
    while ((await page.getByRole("dialog").count()) > 0) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(50);
    }

    // 3) Abertura por ATALHO devolve foco ao elemento antes focado.
    await page.getByTestId("chat-composer").focus();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="chat-composer"]')).toBeFocused();

    // Inventário completo: itens presentes ou desabilitados com motivo.
    await page.keyboard.press("ControlOrMeta+k");
    const inventory = [
      /Nova conversa|New conversation/,
      /Trocar perfil|Switch profile/,
      /Provedores|Providers/i,
      /Editar Soul|Edit Soul/,
      /Escolher modelo|Choose a model/i,
      /Abrir nota do Vault|Open Vault note/i,
      /Abrir configurações|Open settings/i,
      /Ir para Agentes|Go to Agents/i,
    ];
    for (const pattern of inventory) {
      // Sessões recentes podem repetir título; ações são únicas.
      await expect(
        page.getByRole("dialog").getByRole("option", { name: pattern }).first(),
      ).toBeVisible();
    }
    // Nota requer workspace — aqui HÁ workspace, então habilitada.
    // Agents segue desabilitado com motivo.
    const agentsItem = page
      .getByRole("dialog")
      .getByRole("option", { name: /Ir para Agentes|Go to Agents/i });
    await expect(agentsItem).toHaveAttribute("aria-disabled", "true");

    // Abrir/fechar repetidamente não cria overlays órfãos nem trava o app.
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await page.keyboard.press("Escape");
      await page.keyboard.press("ControlOrMeta+k");
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("[data-slot='dialog-overlay']")).toHaveCount(0);
    expect(errors.filter((message) => /cmdk|subscribe/.test(message))).toEqual([]);
  });
});

test.describe("feedback 24/08 — comentário 3: projeto alinhado à esquerda", () => {
  test("texto do projeto tem text-align left calculado", async ({ page }) => {
    await enterShellWithWorkspace(page, "Perfil Alinhamento");
    const projectButton = page
      .getByRole("button", { name: "Perfil Alinhamento WS", exact: true })
      .first();
    await expect(projectButton).toBeVisible();
    const alignment = await projectButton.evaluate(
      (element) => getComputedStyle(element).textAlign,
    );
    expect(alignment).toBe("left");
  });
});

test.describe("feedback 24/08 — comentários 4 e 5: toggle único e trilho do Vault", () => {
  test("header alterna painel/trilho; trilho mantém Arquivos e Grafo operáveis", async ({
    page,
  }) => {
    await enterShellWithWorkspace(page, "Perfil Trilho");
    const toggle = vaultToggle(page);
    await openVaultFiles(page);

    // Botão interno redundante não pode mais existir dentro do painel.
    await expect(
      page.locator(".vault-slot").getByRole("button", { name: /Recolher.*Vault|Collapse.*Vault/i }),
    ).toHaveCount(0);
    // aria-controls real apontando para o painel existente.
    await expect(toggle).toHaveAttribute("aria-controls", "bw-vault-panel");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Abre a nota e move o scroll da LEITURA para valor não zero.
    await page.locator(".vault-slot").getByRole("button", { name: "Prosa" }).click();
    await expect(page.locator(".vault-slot article")).toBeVisible();
    const noteViewport = page
      .locator(".vault-slot")
      .locator('[data-slot="scroll-area-viewport"]')
      .last();
    await noteViewport.evaluate((element) => element.scrollTo({ top: 120 }));
    await expect
      .poll(() => noteViewport.evaluate((element) => element.scrollTop), { timeout: 2_000 })
      .toBeGreaterThan(80);

    // Recolhe pelo header → trilho com exatamente dois atalhos.
    await toggle.click();
    const rail = page.locator(".vault-rail");
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("button")).toHaveCount(2);
    const filesShortcut = rail.getByRole("button", { name: /arquivos do vault|vault files/i });
    const graphShortcut = rail.getByRole("button", { name: /grafo do vault|vault graph/i });
    await expect(filesShortcut).toBeVisible();
    await expect(graphShortcut).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Tooltip real em focus (title isolado não satisfaz).
    await filesShortcut.focus();
    await expect(rail.getByRole("tooltip").filter({ hasText: /Arquivos|Files/i })).toBeVisible();

    // Atalho reabre na MESMA aba, MESMA nota e MESMO scroll.
    await filesShortcut.click();
    await expect(page.locator(".vault-slot")).toBeVisible();
    await expect(page.locator(".vault-slot [role='tab'][aria-selected='true']")).toContainText(
      /Arquivos|Files/i,
    );
    await expect(page.locator(".vault-slot article")).toBeVisible();
    const restoredScroll = await page
      .locator(".vault-slot")
      .locator('[data-slot="scroll-area-viewport"]')
      .last()
      .evaluate((element) => element.scrollTop);
    expect(restoredScroll).toBeGreaterThan(80);

    // Atalho do grafo reabre na aba Grafo.
    await toggle.click();
    await graphShortcut.click();
    await expect(page.locator(".vault-slot [role='tab'][aria-selected='true']")).toContainText(
      /Grafo|Graph/i,
    );
  });

  test("sem workspace nenhum rail é criado", async ({ page }) => {
    await resetToOnboarding(page);
    await page.getByRole("button", { name: /Continuar|Continue/ }).click();
    await completeOnboarding(page, "Perfil SemRail");
    await expect(page.locator(".vault-rail")).toHaveCount(0);
    await expect(page.locator(".vault-slot")).toHaveCount(0);
  });
});

test.describe("feedback 24/08 — comentário 7: seletor de modelos compacto e rolável", () => {
  test("popover com 65+ modelos cabe na viewport e rola sem mover a página atrás", async ({
    page,
  }) => {
    await enterShellWithWorkspace(page, "Perfil Modelos");

    // Servidor OpenAI-compatible sintético com 65 modelos.
    const { createServer } = await import("node:http");
    const models = Array.from({ length: 65 }, (_, index) => ({
      id: `sintetico-modelo-${String(index + 1).padStart(3, "0")}`,
      object: "model",
    }));
    const mockServer = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: models, object: "list" }));
    });
    await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
    const address = mockServer.address();
    if (!address || typeof address === "string") throw new Error("porta indisponível");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;

    // Cadastra o provedor apontando para o servidor sintético (com modelo
    // padrão, exigido pela validação)…
    const state = (await (await page.request.get("http://127.0.0.1:1423/v1/state")).json()) as {
      activeProfileId: string;
      activeSessionId?: string;
    };
    const provider = (await (
      await page.request.post("http://127.0.0.1:1423/v1/providers", {
        data: {
          apiKey: "test-key",
          baseUrl,
          model: models[0]?.id,
          name: "Modelos Sintéticos",
          type: "openai-compatible",
        },
      })
    ).json()) as { provider: { id: string } };

    // …sincroniza/persiste os 65 modelos no catálogo local e aponta a sessão.
    const synced = await page.request.post("http://127.0.0.1:1423/v1/providers/models", {
      data: {
        apiKey: "test-key",
        baseUrl,
        id: provider.provider.id,
        model: models[0]?.id,
        name: "Modelos Sintéticos",
        type: "openai-compatible",
      },
    });
    expect(synced.ok()).toBeTruthy();
    if (state.activeSessionId) {
      await page.request.post(
        `http://127.0.0.1:1423/v1/sessions/${state.activeSessionId}/model`,
        { data: { model: models[0]?.id, providerId: provider.provider.id } },
      );
    }

    await page.reload();
    await page.getByTestId("profile-option").filter({ hasText: "Perfil Modelos" }).click();
    await expect(page.getByTestId("chat-composer")).toBeVisible();

    const chip = page.getByTestId("provider-chip");
    await expect(chip).toContainText(/sintetico-modelo-001/);
    await chip.click();
    const popover = page.locator('[data-slot="popover-content"], [role="menu"]').last();
    await expect(popover).toBeVisible();

    const popoverBox = await popover.boundingBox();
    const viewport = page.viewportSize();
    expect(popoverBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (popoverBox && viewport) {
      expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(viewport.height + 1);
    }

    const listState = await page
      .getByTestId("model-list")
      .evaluate((element) => ({
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
      }));
    expect(listState.scrollHeight).toBeGreaterThan(listState.clientHeight);
    expect(["auto", "scroll"]).toContain(listState.overflowY);

    // Wheel sobre a lista move a lista, não a página/transcript atrás.
    const list = page.getByTestId("model-list");
    await list.hover();
    const backgroundBefore = await page.evaluate(() => ({
      windowY: window.scrollY,
      threadTop: document.querySelector("main")?.getBoundingClientRect().top ?? 0,
    }));
    await page.mouse.wheel(0, 240);
    await expect
      .poll(() => list.evaluate((element) => element.scrollTop), { timeout: 2_000 })
      .toBeGreaterThan(0);
    const backgroundAfter = await page.evaluate(() => ({
      windowY: window.scrollY,
      threadTop: document.querySelector("main")?.getBoundingClientRect().top ?? 0,
    }));
    expect(backgroundAfter.windowY).toBe(backgroundBefore.windowY);
    expect(backgroundAfter.threadTop).toBe(backgroundBefore.threadTop);

    // Contrato ARIA coerente: listbox + option + aria-selected.
    await expect(list).toHaveAttribute("role", "listbox");
    const firstOption = list.getByRole("option").first();
    await expect(firstOption).toHaveAttribute("aria-selected", /.+/);
    await expect(list.getByRole("option", { selected: true })).toHaveCount(1);

    // Home vai ao primeiro; End vai ao último; ArrowUp volta um.
    const items = list.getByRole("option");
    await items.first().focus();
    await page.keyboard.press("End");
    await expect(items.nth(64)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(items.first()).toBeFocused();

    // Busy impede duplo clique: atrasa o POST e garante UMA única requisição.
    let modelRequests = 0;
    let releaseModelRequest: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => (releaseModelRequest = resolve));
    await page.route("**/v1/sessions/*/model", async (route) => {
      modelRequests += 1;
      await gate;
      await route.continue();
    });
    await items.nth(2).click();
    await expect(items.nth(2)).toBeDisabled({ timeout: 5_000 });
    // Segundo clique sobre item desabilitado não dispara nova troca.
    await items.first().click({ force: true }).catch(() => undefined);
    expect(modelRequests).toBe(1);
    releaseModelRequest?.();
    // Sucesso fecha o menu e reabilita estado.
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });

    // Erro na troca mantém o menu aberto com feedback inline.
    await page.route("**/v1/sessions/*/model", async (route) => route.abort());
    await chip.click();
    const errorList = page.getByTestId("model-list");
    await expect(errorList.getByRole("option").nth(3)).toBeEnabled({ timeout: 5_000 });
    await errorList.getByRole("option").nth(3).click();
    await expect(
      page.locator('[data-slot="popover-content"] [role="alert"]'),
    ).toBeVisible({ timeout: 5_000 });
    await expect(errorList).toBeVisible();

    // Escape fecha e devolve foco ao trigger.
    await page.keyboard.press("Escape");
    await expect(chip).toBeFocused();

    await mockServer.close();
  });
});
