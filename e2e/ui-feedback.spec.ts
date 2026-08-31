// MIT License — Copyright (c) 2026 Mateus Gaio
import { expect, test, type Page } from "@playwright/test";

/**
 * Feedback de UI do owner (2026-08-24) — cenários E2E por pacote.
 * Dados 100% sintéticos; o sidecar roda em modo mock (BLACKWALL_E2E_MOCK=1).
 */

const chooserHeading = /Quem está usando o Blackwall\?|Who is using Blackwall\?/;
const startWithoutRegex = /Começar sem um workspace|Start without a workspace/;
const deleteProfileButton = (name: string) =>
  new RegExp(`Excluir perfil: ${name}|Delete profile: ${name}`);

/** Remove perfis remanescentes de testes anteriores (sidecar compartilhado). */
async function resetToOnboarding(page: Page) {
  await page.goto("/");
  // O bootstrap do app é assíncrono: até getAppState resolver, o onboarding é
  // renderizado provisoriamente. Só decida após o chooser aparecer ou
  // esgotar a espera — nunca confie num count() imediato.
  const chooser = page.getByRole("heading", { name: chooserHeading });
  for (let guard = 0; guard < 10; guard += 1) {
    if (!(await chooser.isVisible().catch(() => false))) {
      try {
        await chooser.waitFor({ state: "visible", timeout: 1_500 });
      } catch {
        break; // Onboarding real (sem perfis salvos).
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

/** Percorre o onboarding até completar, conectando um provedor simulado. */
async function completeOnboarding(page: Page, profileName: string) {
  const continueButton = page.getByRole("button", { name: /Continuar|Continue/ });
  // "Criar novo perfil" reinicia o fluxo na etapa de idioma.
  const languageButton = page.getByRole("button", { name: /Portuguese|Português/ }).first();
  if (await languageButton.isVisible().catch(() => false)) {
    await languageButton.click();
    await continueButton.click();
  }
  await page.getByLabel(/Nome do perfil|Profile name/).fill(profileName);
  await continueButton.click();
  await page.getByLabel(/Nome do workspace|Workspace name/).fill(`${profileName}-ws`);
  await continueButton.click();
  await page.getByRole("button", { name: startWithoutRegex }).click();
  await continueButton.click(); // → Soul do perfil
  await continueButton.click(); // → Provedor (contexto pulado)
  await page.getByLabel(/Nome do provedor|Provider name/).fill("Mock provider");
  await page
    .getByLabel(/Endpoint|Endpoint compatível com OpenAI|OpenAI-compatible endpoint/)
    .fill("https://mock.invalid/v1");
  await page.getByLabel(/Modelo padrão|Default model/).fill("mock-model");
  await page.getByLabel(/Chave de API|API key/).fill("test-key");
  await page.getByRole("button", { name: /Conectar e continuar|Connect and continue/ }).click();
  await page.getByRole("button", { name: /Entrar no Blackwall|Enter Blackwall/ }).click();
  await expect(page.getByTestId("chat-composer")).toBeVisible();
}

/** Sai do perfil atual via Configurações e aguarda o chooser. */
async function signOutViaSettings(page: Page) {
  await page.getByRole("button", { name: /Abrir configurações|Open settings/ }).click();
  await page.getByTestId("settings-tab-profile").click();
  await page.getByRole("button", { name: /Sair do perfil|Sign out/ }).click();
  await expect(page.getByRole("heading", { name: chooserHeading })).toBeVisible();
}

  /** Perfil com workspace ativo para permitir Vault e medições de layout. */
  async function shellWithWorkspace(page: Page, profileName: string) {
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
      .fill("https://mock.invalid/v1");
    await page.getByLabel(/Modelo padrão|Default model/).fill("mock-model");
    await page.getByLabel(/Chave de API|API key/).fill("test-key");
    await page.getByRole("button", { name: /Conectar e continuar|Connect and continue/ }).click();
    await page.getByRole("button", { name: /Entrar no Blackwall|Enter Blackwall/ }).click();
    // Cria um workspace real (temporário) pela API e abre-o.
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const state = (await (await page.request.get("http://127.0.0.1:1423/v1/state")).json()) as {
      activeProfileId: string;
    };
    const created = (await (
      await page.request.post("http://127.0.0.1:1423/v1/workspaces", {
        data: {
          name: `${profileName} Workspace`,
          profileId: state.activeProfileId,
          rootPath: await mkdtemp(join(tmpdir(), "blackwall-e2e-ws-")),
          soul: "",
        },
      })
    ).json()) as { workspace: { id: string } };
    await page.request.post(`http://127.0.0.1:1423/v1/workspaces/${created.workspace.id}/select`);
    await page.reload();
    await page
      .getByTestId("profile-option")
      .filter({ hasText: profileName })
      .click();
    await expect(page.getByTestId("chat-composer")).toBeVisible();
  }

test.describe("feedback de UI — perfis e onboarding", () => {
  test("excluir perfil pelo chooser pede confirmação, cancela e confirma", async ({ page }) => {
    await resetToOnboarding(page);
    for (const [index, name] of ["Perfil Alfa", "Perfil Beta"].entries()) {
      if (index > 0) {
        await page.getByRole("button", { name: /Criar novo perfil|Create new profile/ }).click();
      }
      await completeOnboarding(page, name);
      await signOutViaSettings(page);
    }

    // Cancelar não exclui.
    await page.getByRole("button", { name: deleteProfileButton("Perfil Beta") }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Perfil Beta");
    await dialog.getByRole("button", { name: /Cancelar|Cancel/ }).click();
    await expect(page.getByTestId("profile-option")).toHaveCount(2);

    // Confirmar exclui apenas o perfil alvo.
    await page.getByRole("button", { name: deleteProfileButton("Perfil Beta") }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Excluir perfil$|^Delete profile$/ })
      .click();
    await expect(page.getByTestId("profile-option")).toHaveCount(1);
    await expect(page.getByTestId("profile-option").first()).toContainText("Perfil Alfa");

    // Excluir o último perfil devolve ao onboarding.
    await page.getByRole("button", { name: deleteProfileButton("Perfil Alfa") }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Excluir perfil$|^Delete profile$/ })
      .click();
    await expect(
      page.getByRole("region", { name: /Initial setup|Configuração inicial/ }),
    ).toBeVisible();
  });

  test("iniciar sem workspace pula o contexto do workspace e recalcula o progresso", async ({
    page,
  }) => {
    await resetToOnboarding(page);
    // Etapa de idioma: segue com o locale detectado.
    await page.getByRole("button", { name: /Continuar|Continue/ }).click();
    await page.getByLabel(/Nome do perfil|Profile name/).fill("Perfil Sem Pasta");
    const continueButton = page.getByRole("button", { name: /Continuar|Continue/ });
    await continueButton.click();
    await page.getByLabel(/Nome do workspace|Workspace name/).fill("Workspace Livre");
    await continueButton.click();
    await page.getByRole("button", { name: startWithoutRegex }).click();
    await continueButton.click(); // → Soul do perfil
    await continueButton.click(); // → Provedor (contexto do workspace pulado)
    await expect(
      page.getByRole("heading", {
        name: /Conecte sua primeira inteligência\.|Connect your first intelligence\./,
      }),
    ).toBeVisible();
    // Contador usa o total real de etapas visíveis (07), não o fantasma (08);
    // etapa atual é 06 de 07.
    await expect(page.getByText(/06 \/ 07/)).toBeVisible();

    // Voltar a partir do provedor retorna à Soul, nunca à tela pulada.
    await page.getByRole("button", { name: /Voltar|Back/ }).click();
    await expect(
      page.getByRole("heading", {
        name: /Comece com uma Soul pronta\.|Start with a ready-made Soul\./,
      }),
    ).toBeVisible();

    // Conclui sem contexto fictício de workspace.
    await continueButton.click();
    await page.getByLabel(/Nome do provedor|Provider name/).fill("Mock provider");
    await page
      .getByLabel(/Endpoint|Endpoint compatível com OpenAI|OpenAI-compatible endpoint/)
      .fill("https://mock.invalid/v1");
    await page.getByLabel(/Modelo padrão|Default model/).fill("mock-model");
    await page.getByLabel(/Chave de API|API key/).fill("test-key");
    await page.getByRole("button", { name: /Conectar e continuar|Connect and continue/ }).click();
    await page.getByRole("button", { name: /Entrar no Blackwall|Enter Blackwall/ }).click();
    await expect(page.getByTestId("chat-composer")).toBeVisible();
    // Modo sem workspace: Vault bloqueado, sem coluna direita reservada.
    await expect(page.locator(".vault-slot")).toHaveCount(0);
    // Limpa o estado para os próximos testes.
    await signOutViaSettings(page);
    await page.getByRole("button", { name: /Excluir perfil: |Delete profile: / }).first().click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Excluir perfil$|^Delete profile$/ })
      .click();
    await expect(page.getByTestId("profile-option")).toHaveCount(0);
  });

  test("card Escolher pasta mantém texto centrado e altura consistente", async ({ page }) => {
    await resetToOnboarding(page);
    // Etapa de idioma: segue com o locale detectado.
    await page.getByRole("button", { name: /Continuar|Continue/ }).click();
    await page.getByLabel(/Nome do perfil|Profile name/).fill("Perfil Card");
    await page.getByRole("button", { name: /Continuar|Continue/ }).click();
    await page.getByLabel(/Nome do workspace|Workspace name/).fill("Workspace Card");
    await page.getByRole("button", { name: /Continuar|Continue/ }).click();

    const folderCard = page.getByRole("button", { name: /Escolher pasta|Choose folder/ });
    const alternative = page.getByRole("button", { name: startWithoutRegex });
    await expect(folderCard).toBeVisible();
    // Mesma altura das alternativas do passo.
    const cardBox = await folderCard.boundingBox();
    const altBox = await alternative.boundingBox();
    expect(Math.abs((cardBox?.height ?? 0) - (altBox?.height ?? 0))).toBeLessThanOrEqual(2);

    // O bloco textual (título + subtítulo) fica centrado no espaço útil: o
    // centro do título desloca do centro do cartão no máximo a largura do
    // ícone esquerdo (~30 px + folga).
    const title = folderCard.getByText(/Escolher pasta|Choose folder/).first();
    const titleBox = await title.boundingBox();
    const cardCenterX = (cardBox?.x ?? 0) + (cardBox?.width ?? 0) / 2;
    const titleCenterX = (titleBox?.x ?? 0) + (titleBox?.width ?? 0) / 2;
    expect(Math.abs(titleCenterX - cardCenterX)).toBeLessThanOrEqual(36);
  });
});

test.describe("feedback de UI — sidebar agrupada", () => {
  /** Semeia dois workspaces sintéticos e sessões via API local do sidecar. */
  async function seedSidebarData(page: Page) {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const state = (await (
      await page.request.get("http://127.0.0.1:1423/v1/state")
    ).json()) as {
      activeProfileId: string;
      profiles: Array<{ id: string; name: string }>;
    };
    const profileId = state.activeProfileId;
    const workspace = async (name: string) =>
      (
        (await (
          await page.request.post("http://127.0.0.1:1423/v1/workspaces", {
            data: {
              name,
              profileId,
              rootPath: await mkdtemp(join(tmpdir(), "blackwall-e2e-fixture-")),
              soul: "",
            },
          })
        ).json()) as { workspace: { id: string } }
      ).workspace.id;
    const session = async (workspaceId?: string) =>
      (
        (await (
          await page.request.post("http://127.0.0.1:1423/v1/sessions", {
            data: { profileId, workspaceId: workspaceId ?? null },
          })
        ).json()) as { session: { id: string } }
      ).session.id;

    const wsA = await workspace("Projeto A");
    const wsB = await workspace("Projeto B");
    await session(wsA); // A · mais antiga
    await session(wsA); // A · mais recente
    await session(wsB);
    await session(); // Sem workspace
    return profileId;
  }

  test("sidebar agrupa sessões por projeto e Sem workspace sem duplicatas", async ({
    page,
  }) => {
    await resetToOnboarding(page);
    // Fluxo completo até o shell com um perfil dedicado.
    await page.getByRole("button", { name: /Continuar|Continue/ }).click();
    await completeOnboarding(page, "Perfil Sidebar");
    await seedSidebarData(page);

    // Recarrega para passar pelo chooser e abrir o perfil com os dados novos.
    await page.reload();
    await page.getByRole("heading", { name: chooserHeading }).waitFor();
    await page
      .getByTestId("profile-option")
      .filter({ hasText: "Perfil Sidebar" })
      .click();
    const nav = page.getByRole("navigation", { name: /Lista de conversas|Thread list/ });
    await expect(nav).toBeVisible();

    // Grupos na ordem do estado, com "Sem workspace" por último.
    for (const label of [/^Projeto A$/, /^Projeto B$/, /^Sem workspace$|^No workspace$/]) {
      await expect(nav.getByText(label)).toBeVisible();
    }
    // Cada sessão aparece exatamente uma vez ao expandir os grupos (5 no
    // total: 2 em A, 1 em B, 2 em Sem workspace — a do bootstrap + a semeada,
    // que já nasce expandido por ser o grupo ativo).
    const expandButton = (label: string) =>
      nav.getByRole("button", { name: new RegExp(`(Expand|Collapse|Expandir|Recolher): ${label}`) });
    await expandButton("Projeto A").click();
    await expect(nav.locator("[data-session-menu]")).toHaveCount(4);
    await expandButton("Projeto B").click();
    await expect(nav.locator("[data-session-menu]")).toHaveCount(5);
    // Recolher novamente esconde as sessões do grupo.
    await expandButton("Projeto B").click();
    await expect(nav.locator("[data-session-menu]")).toHaveCount(4);
  });

  test("Novo cria uma única sessão sob clique repetido e não exibe o sol", async ({
    page,
  }) => {
    await resetToOnboarding(page);
    await page.getByRole("button", { name: /Continuar|Continue/ }).click();
    await completeOnboarding(page, "Perfil Novo");
    const nav = page.getByRole("navigation", { name: /Lista de conversas|Thread list/ });
    const novo = page.getByRole("button", { name: /^Novo$|^New$/ });
    await expect(novo).toBeVisible();

    // Grupo ativo (Sem workspace) nasce expandido com a sessão do bootstrap.
    const before = await nav.locator("[data-session-menu]").count();
    expect(before).toBeGreaterThanOrEqual(1);
    await novo.dblclick(); // duplo clique: cria apenas uma sessão
    await page.waitForTimeout(300);
    const after = await nav.locator("[data-session-menu]").count();
    expect(after - before).toBeLessThanOrEqual(1);

    // Estado vazio sem símbolo decorativo.
    await expect(page.getByText("✳")).toHaveCount(0);
  });

  test("o divisor mantém a sidebar entre 200 e 420 px e não a recolhe", async ({ page }) => {
    await shellWithWorkspace(page, "Perfil Limites Sidebar");
    const sidebar = page.locator("#bw-sidebar");
    const divider = page.getByRole("separator", { name: /Redimensionar sidebar|Resize sidebar/ });
    const dividerBox = await divider.boundingBox();
    expect(dividerBox).not.toBeNull();
    if (!dividerBox) return;

    const y = dividerBox.y + dividerBox.height / 2;
    await page.mouse.move(dividerBox.x + dividerBox.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(1, y);
    await page.mouse.up();
    expect((await sidebar.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(200);

    const refreshedDivider = await divider.boundingBox();
    expect(refreshedDivider).not.toBeNull();
    if (!refreshedDivider) return;
    await page.mouse.move(refreshedDivider.x + refreshedDivider.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(900, y);
    await page.mouse.up();
    expect((await sidebar.boundingBox())?.width ?? 0).toBeLessThanOrEqual(420);
  });
});

test.describe("feedback de UI — composer e provedores", () => {
  test("superfície de configurações abre em Uso e troca para as abas diretas", async ({
    page,
  }) => {
    await shellWithWorkspace(page, "Perfil Scroll");
    await page.getByRole("button", { name: /Abrir configurações|Open settings/ }).click();
    const settings = page.getByTestId("settings-surface");
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("heading", { name: /Uso|Usage/ })).toBeVisible();
    await expect(page.getByTestId("settings-tab-usage")).toHaveAttribute("aria-current", "page");

    const cursorAvoidance = page.getByRole("checkbox", {
      name: /Afastar texto do cursor|Move text away from cursor/,
    });
    await cursorAvoidance.check();
    await expect(cursorAvoidance).toBeChecked();
    await cursorAvoidance.uncheck();

    await page.getByTestId("settings-tab-profile").click();
    await expect(settings.getByRole("heading", { name: /Como você quer|What should/ })).toBeVisible();

    await page.getByTestId("settings-tab-workspaces").click();
    await expect(settings.getByRole("heading", { name: /Workspaces/ })).toBeVisible();

    await page.getByTestId("settings-tab-providers").click();
    await expect(settings.getByText(/Adicionar provedor|Add provider/).first()).toBeVisible();
  });

  test("a superfície de configurações mantém o viewport da aba ativa", async ({ page }) => {
    await shellWithWorkspace(page, "Perfil Scroll Longo");
    await page.getByRole("button", { name: /Abrir configurações|Open settings/ }).click();
    const settings = page.getByTestId("settings-surface");
    const viewport = settings.locator('[data-slot="scroll-area-viewport"]');
    await expect(viewport).toBeVisible();
    await page.getByTestId("settings-tab-providers").click();
    await expect(settings.getByText(/Adicionar provedor|Add provider/).first()).toBeVisible();

    const initialTop = await viewport.evaluate((element) => element.scrollTop);
    const scrollable = await viewport.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    );
    expect(scrollable).toBeGreaterThanOrEqual(0);

    await viewport.evaluate((element) =>
      element.scrollTo({ behavior: "auto", top: element.scrollHeight }),
    );
    const afterScroll = await viewport.evaluate((element) => element.scrollTop);
    expect(afterScroll).toBeGreaterThanOrEqual(initialTop);
    expect(afterScroll).toBeLessThanOrEqual(scrollable);

    await expect(settings.getByText(/Adicionar provedor|Add provider/).first()).toBeInViewport({
      ratio: 0.5,
    });
  });

  test("atalho Provedores abre a aba direta de provedores", async ({ page }) => {
    await shellWithWorkspace(page, "Perfil Atalho");
    await expect(
      page.getByRole("button", { name: /Provedores|Providers/ }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: /Provedores|Providers/ }).first().click();
    const settings = page.getByTestId("settings-surface");
    await expect(settings).toBeVisible();
    await expect(page.getByTestId("settings-tab-providers")).toHaveAttribute("aria-current", "page");
    await expect(settings.getByText(/Adicionar provedor|Add provider/).first()).toBeInViewport({
      ratio: 0.5,
    });
  });

  test("composer mantém a ancoragem vertical ao alternar painéis", async ({ page }) => {
    await shellWithWorkspace(page, "Perfil Estavel");
    const composer = page.getByTestId("chat-composer");

    const yWithSidebarOpen = (await composer.boundingBox())?.y ?? 0;

    // Recolhe a sidebar esquerda.
    await page.getByRole("button", { name: /Esconder sidebar|Hide sidebar/ }).click();
    const yWithSidebarClosed = (await composer.boundingBox())?.y ?? 0;
    expect(Math.abs(yWithSidebarClosed - yWithSidebarOpen)).toBeLessThanOrEqual(2);

    // Abre o Vault à direita.
    const vaultToggle = page.locator("header").getByRole("button", { name: /Vault/i }).first();
    if ((await page.locator(".vault-slot").count()) === 0) await vaultToggle.click();
    await expect(page.locator(".vault-slot")).toHaveCount(1);
    const yWithBothOpen = (await composer.boundingBox())?.y ?? 0;
    expect(Math.abs(yWithBothOpen - yWithSidebarOpen)).toBeLessThanOrEqual(2);

    // Volta ao estado inicial.
    await vaultToggle.click();
    await expect(page.locator(".vault-slot")).toHaveCount(0);
    const yBackToBaseline = (await composer.boundingBox())?.y ?? 0;
    expect(Math.abs(yBackToBaseline - yWithSidebarOpen)).toBeLessThanOrEqual(2);
  });
});

test.describe("feedback de UI — Vault", () => {
  test("toggle do painel abre/recolhe o Vault; árvore filtra internas e abre nota", async ({
    page,
  }) => {
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    await resetToOnboarding(page);
    await page.getByRole("button", { name: /Continuar|Continue/ }).click();
    await page.getByLabel(/Nome do perfil|Profile name/).fill("Perfil Vault");
    const continueButton = page.getByRole("button", { name: /Continuar|Continue/ });
    await continueButton.click();
    await page.getByLabel(/Nome do workspace|Workspace name/).fill("Workspace Vault");
    await continueButton.click();
    await page.getByRole("button", { name: startWithoutRegex }).click();
    await continueButton.click();
    await continueButton.click();
    await page.getByLabel(/Nome do provedor|Provider name/).fill("Mock provider");
    await page
      .getByLabel(/Endpoint|Endpoint compatível com OpenAI|OpenAI-compatible endpoint/)
      .fill("https://mock.invalid/v1");
    await page.getByLabel(/Modelo padrão|Default model/).fill("mock-model");
    await page.getByLabel(/Chave de API|API key/).fill("test-key");
    await page.getByRole("button", { name: /Conectar e continuar|Connect and continue/ }).click();
    await page.getByRole("button", { name: /Entrar no Blackwall|Enter Blackwall/ }).click();

    // Workspace real com notas aninhadas + diretórios internos que devem ser filtrados.
    const root = await mkdtemp(join(tmpdir(), "blackwall-e2e-vault-"));
    await mkdir(join(root, "notas", "profunda"), { recursive: true });
    await writeFile(join(root, "notas", "visivel.md"), "# Nota Visível\n\nConteúdo sintético.\n");
    await writeFile(join(root, "notas", "profunda", "fundo.md"), "# Fundo\n");
    await mkdir(join(root, ".venv"));
    await writeFile(join(root, ".venv", "secreta.md"), "# Ignorada\n");
    await mkdir(join(root, ".pytest_cache"));
    await writeFile(join(root, ".pytest_cache", "cache.md"), "# Ignorada 2\n");

    const state = (await (await page.request.get("http://127.0.0.1:1423/v1/state")).json()) as {
      activeProfileId: string;
    };
    const created = (await (
      await page.request.post("http://127.0.0.1:1423/v1/workspaces", {
        data: { name: "Vault WS", profileId: state.activeProfileId, rootPath: root, soul: "" },
      })
    ).json()) as { workspace: { id: string } };
    await page.request.post(
      `http://127.0.0.1:1423/v1/workspaces/${created.workspace.id}/select`,
    );

    await page.reload();
    await page.getByTestId("profile-option").filter({ hasText: "Perfil Vault" }).click();
    await expect(page.getByTestId("chat-composer")).toBeVisible();

    // Toggle direito espelhado abre o painel.
    const vaultToggle = page
      .locator("header")
      .getByRole("button", { name: /painel do Vault|Vault panel/ })
      .first();
    if ((await page.locator(".vault-slot").count()) === 0) await vaultToggle.click();
    await expect(page.locator(".vault-slot")).toHaveCount(1);
    await expect(vaultToggle).toHaveAttribute("aria-expanded", "true");

    // Diretórios internos não aparecem; pasta visível inicia recolhida.
    const nav = page.locator(".vault-slot");
    await expect(nav.getByText(".venv")).toHaveCount(0);
    await expect(nav.getByText(".pytest_cache")).toHaveCount(0);
    const notesFolder = nav.getByRole("button", { name: /Expandir notas/i });
    await expect(notesFolder).toBeVisible();
    await expect(nav.getByText("Visível")).toBeHidden();

    // Expandir revela subpasta recolhida; abrir nota exibe caminho no preview.
    await notesFolder.click();
    await nav.getByRole("button", { name: /Expandir profunda/i }).click();
    await nav.getByRole("button", { name: "Fundo" }).click();
    await expect(nav.getByText(/^notas\/profunda\/fundo\.md$/)).toBeVisible();

    // Recolher o painel pelo mesmo toggle.
    await vaultToggle.click();
    await expect(page.locator(".vault-slot")).toHaveCount(0);
  });

  test("sem workspace, o botão do Vault permanece visível e explica o bloqueio", async ({
    page,
  }) => {
    await resetToOnboarding(page);
    await page.getByRole("button", { name: /Continuar|Continue/ }).click();
    await completeOnboarding(page, "Perfil SemWS");
    const vaultToggle = page
      .locator("header")
      .getByRole("button", { name: /painel do Vault|Vault panel/ })
      .first();
    await expect(vaultToggle).toBeVisible();
    await vaultToggle.click();
    // Bloqueio explicado sem reservar coluna direita vazia.
    await expect(page.locator(".vault-slot")).toHaveCount(0);
    await expect(
      page.getByText(/selecione uma pasta|select a folder/i),
    ).toBeVisible();
  });
});

test.describe("feedback de UI — visibilidade no tema OLED", () => {
  /** Aponta svgs pretos-sobre-preto, textos ilegíveis e ícones gigantes. */
  async function auditOledVisibility(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const problems: string[] = [];
      const BLACK: [number, number, number, number] = [0, 0, 0, 1];
      // Converte rgb()/oklab()/oklch() para luminância relativa (0..1),
      // compondo alfa sobre um fundo opaco quando informado.
      // Luminância relativa de uma cor rgb()/oklab(), sem composição.
      const lumPure = (value: string): { lum: number; alpha: number } => {
        const numbers = value.match(/-?[\d.]+(?:e-?\d+)?/g);
        if (!numbers) return { lum: 0, alpha: 1 };
        const nums = numbers.map(Number);
        let [r, g, b] = [0, 0, 0];
        let alpha = 1;
        if (value.includes("oklab")) {
          const [L, a, bAxis, rawAlpha] = nums;
          alpha = rawAlpha === undefined ? 1 : Math.min(rawAlpha, 1);
          const l = (L + 0.3963377774 * a + 0.2158037573 * bAxis) ** 3;
          const m = (L - 0.1055613458 * a - 0.0638541728 * bAxis) ** 3;
          const s2 = (L - 0.0894841775 * a - 1.291485548 * bAxis) ** 3;
          r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s2;
          g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s2;
          b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s2;
        } else {
          const [rr, gg, bb, rawAlpha] = nums;
          r = rr / 255;
          g = gg / 255;
          b = bb / 255;
          alpha = rawAlpha === undefined ? 1 : Math.min(rawAlpha, 1);
        }
        const srgbToLinear = (channel: number) => {
          const clamped = Math.min(Math.max(channel, 0), 1);
          return clamped <= 0.04045
            ? clamped / 12.92
            : ((clamped + 0.055) / 1.055) ** 2.4;
        };
        return {
          alpha,
          lum:
            0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b),
        };
      };
      const BLACK_LUM = lumPure("rgb(10 10 11)").lum;
      // Compõe o alfa da cor sobre um fundo opaco informado.
      const luminanceOf = (
        value: string,
        under?: [number, number, number, number],
      ): number => {
        const { alpha, lum } = lumPure(value);
        const backdropLum = under
          ? lumPure(`rgb(${under[0]} ${under[1]} ${under[2]})`).lum
          : BLACK_LUM;
        return alpha * lum + (1 - alpha) * backdropLum;
      };
      const effectiveBackground = (element: Element): [number, number, number, number] => {
        let node: Element | null = element;
        while (node) {
          const background = getComputedStyle(node).backgroundColor;
          const alpha = Number(background.match(/\/\s*([\d.]+)\)?$/)?.[1] ?? 1);
          if (!background.includes("oklab") || alpha > 0.9) {
            const match = background.match(/[\d.]+/g);
            if (match && !background.includes("oklab")) {
              const [r, g, b, a = 1] = match.map(Number);
              if (a > 0.9) return [r, g, b, a];
            }
          }
          node = node.parentElement;
        }
        return [10, 10, 11, 1];
      };

      // Ícones: stroke não pode ser preto puro nem transparente; caixa ≤ 20px.
      for (const svg of Array.from(document.querySelectorAll("svg"))) {
        const box = svg.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const style = getComputedStyle(svg);
        const stroke = style.stroke;
        const fill = style.fill;
        const background = effectiveBackground(svg);
        const bgLum = luminanceOf(`rgb(${background.slice(0, 3).join(" ")})`);
        const strokeLum = stroke === "none" ? 0 : luminanceOf(stroke);
        const usesFillOnly =
          fill !== "none" &&
          fill !== "currentColor" &&
          !fill.includes("currentColor") &&
          luminanceOf(fill) > bgLum + 0.05;
        const strokeInvisible = !usesFillOnly && strokeLum - bgLum < 0.12;
        if (strokeInvisible) {
          problems.push(
            `svg invisível: ${svg.outerHTML.slice(0, 90)} stroke=${stroke} bg=rgb(${background.join(",")})`,
          );
        }
        if (box.width > 22 || box.height > 22) {
          problems.push(`svg gigante (${Math.round(box.width)}x${Math.round(box.height)}): ${svg.getAttribute("class") ?? ""}`);
        }
      }

      // Textos de controles: cor precisa se distinguir do fundo efetivo.
      for (const control of Array.from(document.querySelectorAll("button, a, kbd, output"))) {
        if ((control as HTMLButtonElement).disabled) continue;
        const text = (control.textContent ?? "").trim();
        if (!text) continue;
        const style = getComputedStyle(control);
        const bg = effectiveBackground(control);
        const colorLum = luminanceOf(style.color, bg);
        const bgLum = luminanceOf(`rgb(${bg.slice(0, 3).join(" ")})`);
        const opacity = Number(style.opacity || 1);
        if (opacity > 0.4 && Math.abs(colorLum - bgLum) < 0.08) {
          problems.push(
            `texto ilegível "${text.slice(0, 40)}" color=${style.color} bg=rgb(${effectiveBackground(control).join(",")})`,
          );
        }
      }
      return problems;
    });
  }

  test("nenhum elemento invisível por cor na sidebar, header, composer, Vault e configurações", async ({
    page,
  }) => {
    await shellWithWorkspace(page, "Perfil Contraste");

    // Superfície principal com Vault aberto.
    const vaultToggle = page
      .locator("header")
      .getByRole("button", { name: /painel do Vault|Vault panel/ })
      .first();
    if ((await page.locator(".vault-slot").count()) === 0) await vaultToggle.click();
    await expect(page.locator(".vault-slot")).toHaveCount(1);
    expect(await auditOledVisibility(page)).toEqual([]);

    // Superfície de configurações aberta (formulário de provedor incluso).
    await page.getByRole("button", { name: /Provedores|Providers/ }).first().click();
    const settings = page.getByTestId("settings-surface");
    await expect(settings).toBeVisible();
    expect(await auditOledVisibility(page)).toEqual([]);

    // Fecha as configurações e abre o popover do chip provedor › modelo.
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
    await page.getByTestId("model-trigger").click();
    expect(await auditOledVisibility(page)).toEqual([]);
  });
});
