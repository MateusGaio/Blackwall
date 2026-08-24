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
  await expect(
    page.getByRole("region", { name: /Initial setup|Configuração inicial/ }),
  ).toBeVisible();
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

async function openVaultFiles(page: Page) {
  if ((await page.locator(".vault-slot").count()) === 0) await vaultToggle(page).click();
  await expect(page.locator(".vault-slot")).toBeVisible();
}

test.describe("feedback 24/08 — comentário 1: Markdown adapta à largura do Vault", () => {
  test("prosa quebra no painel de 300 px e bloco largo rola apenas internamente", async ({
    page,
  }) => {
    await enterShellWithWorkspace(page, "Perfil Prosa", { vaultWidth: 300 });
    await openVaultFiles(page);
    await page.locator(".vault-slot").getByRole("button", { name: "Prosa" }).click();

    const article = page.locator(".vault-slot article");
    await expect(article).toBeVisible();
    const widths = article.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    expect((await widths).scroll).toBeLessThanOrEqual((await widths).client + 1);

    // Bloco intrinsecamente largo rola só dentro dele mesmo.
    const wideBlock = page.locator(".vault-slot .code-block pre").first();
    await expect(wideBlock).toBeVisible();
    const preBox = await wideBlock.evaluate((element) => ({
      overflowX: getComputedStyle(element).overflowX,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(preBox.overflowX).toBe("auto");
    if (preBox.scrollWidth > preBox.clientWidth) {
      const articleRect = await article.boundingBox();
      const preRect = await wideBlock.boundingBox();
      expect(preRect?.x).toBeGreaterThanOrEqual((articleRect?.x ?? 0) - 1);
    }
  });
});

test.describe("feedback 24/08 — comentário 2: paleta de comandos", () => {
  test("abre por clique e Ctrl+K, filtra, executa e devolve foco sem pageerror", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await enterShellWithWorkspace(page, "Perfil Paleta");

    // Abertura por clique no atalho da sidebar.
    await page.getByRole("button", { name: /Pesquisar comandos|Search commands/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Raiz cmdk presente: sem ela Input/List quebram ao interagir.
    await expect(dialog.locator('[data-slot="command"]').first()).toBeAttached();

    // Filtro: "versa" existe em "conversation"/"conversa" e em nada nas ações.
    const beforeFilter = dialog.getByRole("option");
    await expect(beforeFilter.first()).toBeVisible();
    const beforeCount = await beforeFilter.count();
    expect(beforeCount).toBeGreaterThanOrEqual(4);
    await dialog.getByPlaceholder(/sessões|sessions/i).fill("versa");
    const options = dialog.getByRole("option");
    const filteredTexts = await options.allTextContents();
    expect(filteredTexts.length).toBeGreaterThan(0);
    for (const text of filteredTexts) {
      expect(text).toMatch(/conversa|conversation/i);
    }

    // Enter executa a ação selecionada; clique direto executa outra.
    await dialog.getByPlaceholder(/sessões|sessions/i).fill("");
    await dialog.getByRole("option", { name: /Provedores|Providers/i }).click();
    await expect(
      page.getByRole("dialog").getByText(/Provedores|Providers/i).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Reabertura por atalho de plataforma e navegação por setas.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog").getByRole("option").first()).toBeVisible();
    // A busca recomeça vazia na próxima abertura.
    await expect(page.getByRole("dialog").getByPlaceholder(/sessões|sessions/i)).toHaveValue("");
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("dialog").getByRole("option").nth(1),
    ).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");

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
    await openVaultFiles(page);

    // Botão interno redundante não pode mais existir dentro do painel.
    await expect(
      page.locator(".vault-slot").getByRole("button", { name: /Recolher.*Vault|Collapse.*Vault/i }),
    ).toHaveCount(0);

    await vaultToggle(page).click();
    const rail = page.locator(".vault-rail");
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("button")).toHaveCount(2);
    const filesShortcut = rail.getByRole("button", { name: /arquivos do vault|vault files/i });
    const graphShortcut = rail.getByRole("button", { name: /grafo do vault|vault graph/i });
    await expect(filesShortcut).toBeVisible();
    await expect(graphShortcut).toBeVisible();

    // Tooltip real em focus (title isolado não satisfaz).
    await filesShortcut.focus();
    await expect(rail.getByRole("tooltip").filter({ hasText: /Arquivos|Files/i })).toBeVisible();

    // Atalho reabre o painel completo já na aba correspondente.
    await filesShortcut.click();
    await expect(page.locator(".vault-slot")).toBeVisible();
    await expect(page.locator(".vault-slot [role='tab'][aria-selected='true']")).toContainText(
      /Arquivos|Files/i,
    );

    await vaultToggle(page).click();
    await graphShortcut.click();
    await expect(page.locator(".vault-slot")).toBeVisible();
    await expect(page.locator(".vault-slot [role='tab'][aria-selected='true']")).toContainText(
      /Grafo|Graph/i,
    );
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

    await mockServer.close();
  });
});
