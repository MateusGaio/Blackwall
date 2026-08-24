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
  await page.getByRole("button", { name: /Configurações|Settings/ }).click();
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
