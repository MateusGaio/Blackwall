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
    .fill("http://127.0.0.1:17999/v1");
  await page.getByLabel(/Modelo padrão|Default model/).fill("mock-model");
  await page.getByLabel(/Chave de API|API key/).fill("test-key");
  await page.getByRole("button", { name: /Conectar e continuar|Connect and continue/ }).click();
  await page.getByRole("button", { name: /Entrar no Blackwall|Enter Blackwall/ }).click();
  await expect(page.getByTestId("chat-composer")).toBeVisible();
}

/** Sai do perfil atual via Configurações e aguarda o chooser. */
async function signOutViaSettings(page: Page) {
  await page.getByRole("button", { name: /Abrir configurações|Open settings/ }).click();
  await page.getByRole("button", { name: /Sair do perfil|Sign out/ }).click();
  await expect(page.getByRole("heading", { name: chooserHeading })).toBeVisible();
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
      .fill("http://127.0.0.1:17999/v1");
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
});
