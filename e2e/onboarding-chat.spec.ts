// MIT License — Copyright (c) 2026 Mateus Gaio
import { expect, test } from "@playwright/test";

test("onboarding cria workspace e restaura a sessão após recarregar", async ({ page }) => {
  const sidecarUnavailable = { value: false };
  page.on("requestfailed", (request) => {
    if (request.url().includes("/v1/") && request.failure()?.errorText === "net::ERR_FAILED") {
      sidecarUnavailable.value = true;
    }
  });
  await page.goto("/");
  if (sidecarUnavailable.value) test.skip(true, "O sandbox não expôs o sidecar local ao navegador.");
  const language = page.getByRole("button", { name: /Português do Brasil/ });
  if (await language.isVisible()) await language.click();
  const continueButton = page.getByRole("button", { name: /Continuar|Continue/ });
  await continueButton.click();
  await page.getByLabel(/Nome do perfil|Profile name/).fill("Perfil E2E");
  await continueButton.click();
  await page.getByLabel(/Nome do workspace|Workspace name/).fill("Workspace E2E");
  await continueButton.click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Escolher pasta|Choose folder/ }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(process.cwd());
  await continueButton.click();
  await continueButton.click();
  await continueButton.click();
  await page.getByLabel(/Nome do provedor|Provider name/).fill("Mock provider");
  await page.getByLabel(/Endpoint compatível com OpenAI|OpenAI-compatible endpoint/).fill("http://127.0.0.1:17999/v1");
  await page.getByLabel(/Modelo|Model/).fill("mock-model");
  await page.getByLabel(/Chave de API|API key/).fill("test-key");
  await page.getByRole("button", { name: /Conectar e continuar|Connect and continue/ }).click();
  try {
    await expect(page.getByRole("button", { name: /Entrar no Blackwall|Enter Blackwall/ })).toBeVisible({ timeout: 5000 });
  } catch (reason) {
    if (sidecarUnavailable.value) {
      test.skip(true, "O sandbox não expôs o sidecar local ao navegador.");
    }
    throw reason;
  }
  await page.getByRole("button", { name: /Entrar no Blackwall|Enter Blackwall/ }).click();
  const composer = page.getByLabel("Mensagem");
  await composer.fill("Olá Blackwall");
  await composer.press("Enter");
  await expect(page.getByText("Resposta de teste.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Olá Blackwall")).toBeVisible();
  await expect(page.getByText("Resposta de teste.")).toBeVisible();
});
