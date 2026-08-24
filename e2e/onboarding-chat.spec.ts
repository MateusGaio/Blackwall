// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("onboarding cria workspace e restaura a sessão após recarregar", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = await mkdtemp(join(tmpdir(), "blackwall-harness-e2e-"));
  await mkdir(join(fixture, "src"));
  await mkdir(join(fixture, "tests"));
  await writeFile(join(fixture, "README.md"), "# Harness fixture\n\nConsulte [[ARCHITECTURE]].\n");
  await writeFile(join(fixture, "ARCHITECTURE.md"), "# Architecture\n\nTypeScript local-first.\n");
  await writeFile(join(fixture, "src/index.ts"), "export const main = () => 'ok';\n");
  await writeFile(
    join(fixture, "tests/index.test.ts"),
    "import { expect, test } from 'vitest'; test('main', () => expect(true).toBe(true));\n",
  );
  await writeFile(join(fixture, "package.json"), '{"name":"harness-fixture","type":"module"}\n');
  // O seletor nativo de diretórios não expõe um evento controlável pelo
  // Playwright. Forçamos o fallback `webkitdirectory`, que representa o
  // mesmo fluxo de seleção de pasta no navegador e permite anexar a pasta
  // temporária do teste de forma determinística.
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/");
  const initialSetup = page.getByRole("region", { name: /Initial setup|Configuração inicial/ });
  await expect(initialSetup).toBeVisible();
  {
    const language = page.getByRole("button", { name: /Portuguese|Português/ }).first();
    await language.click();
    const continueButton = page.getByRole("button", { name: /Continuar|Continue/ });
    await continueButton.click();
    await page.getByLabel(/Nome do perfil|Profile name/).fill("Perfil E2E");
    await continueButton.click();
    await page.getByLabel(/Nome do workspace|Workspace name/).fill("Workspace E2E");
    await continueButton.click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /Escolher pasta|Choose folder/ }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixture);
    await continueButton.click();
    await continueButton.click();
    await continueButton.click();
    await page.getByLabel(/Nome do provedor|Provider name/).fill("Mock provider");
    await page
      .getByLabel(/Endpoint|Endpoint compatível com OpenAI|OpenAI-compatible endpoint/)
      .fill("http://127.0.0.1:17999/v1");
    await page.getByLabel(/Modelo|Model/).fill("mock-model");
    await page.getByLabel(/Chave de API|API key/).fill("test-key");
    await page.getByRole("button", { name: /Conectar e continuar|Connect and continue/ }).click();
    await expect(
      page.getByRole("button", { name: /Entrar no Blackwall|Enter Blackwall/ }),
    ).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /Entrar no Blackwall|Enter Blackwall/ }).click();
    const vaultToggle = page.getByRole("button", { name: "Vault", exact: true });
    await expect(vaultToggle).toBeVisible();
    // Sidebar v2: o workspace ativo aparece como grupo expandido na árvore.
    await expect(
      page
        .getByRole("navigation", { name: /Lista de conversas|Thread list/ })
        .getByText("Workspace E2E"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Abrir configurações da Soul do workspace/i }),
    ).toHaveCount(0);
    // Com um workspace ativo, o Vault já inicia aberto. Só alternamos o
    // botão quando o painel não estiver presente (por exemplo, após uma
    // preferência de recolhimento persistida).
    const vaultSlot = page.locator(".vault-slot");
    if ((await vaultSlot.count()) === 0) await vaultToggle.click();
    const graphTab = page.getByRole("tab", { name: /Grafo|Graph/, exact: true });
    await expect(graphTab).toBeVisible();
    await graphTab.click();
    const graphCanvas = page.locator(".vault-graph-canvas");
    await expect(graphCanvas).toBeVisible();
    const graphHeight = await graphCanvas.evaluate((element) => element.getBoundingClientRect().height);
    const graphBackground = await page.locator(".vault-graph").evaluate((element) =>
      getComputedStyle(element).backgroundColor,
    );
    const slotHeight = await page
      .locator(".vault-slot")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(graphHeight).toBeGreaterThan(slotHeight * 0.55);
    expect(graphBackground).toBe("rgb(10, 10, 11)");
    await page.getByRole("button", { name: /Esconder sidebar|Hide sidebar/ }).click();
    await expect(page.getByRole("button", { name: /Mostrar sidebar|Show sidebar/ })).toBeVisible();
    await expect(page.getByRole("img", { name: "Blackwall" })).toBeHidden();
    await page.getByRole("button", { name: /Mostrar sidebar|Show sidebar/ }).click();
  }
  const composer = page.getByTestId("chat-composer");
  await composer.fill("Olá Blackwall");
  await composer.press("Enter");
  await expect(page.getByText("Resposta de teste.")).toBeVisible();
  await page.reload();
  const profileChooser = page.getByRole("heading", {
    name: /Quem está usando o Blackwall\?|Who is using Blackwall\?/,
  });
  await expect(profileChooser).toBeVisible();
  await page.getByTestId("profile-option").click();
  await expect(page.locator("li.message-user").getByText("Olá Blackwall", { exact: true })).toBeVisible();
  await expect(page.getByText("Resposta de teste.")).toBeVisible();

  await page.getByRole("button", { name: /Modo de permissões|Permission mode/ }).click();
  await page
    .getByRole("menuitemradio", { name: /Perguntar sempre|Ask every time/ })
    .click();
  const acceptancePrompt =
    "Explore o workspace selecionado e entenda o projeto dentro dele. Comece listando a raiz e use apenas os caminhos realmente retornados pelas ferramentas. Ignore dependências, ambientes virtuais, caches, builds e arquivos gerados. Leia a documentação, manifests, configurações, pontos de entrada, código principal e testes relevantes. Crie ou atualize `BLACKWALL_CONTEXT.md` na raiz do workspace com um resumo técnico completo. Inclua wikilinks para arquivos Markdown existentes e links Markdown para os arquivos de código citados. Ao terminar, releia o resumo, valide todos os links e informe o que foi criado.";
  await page.getByTestId("chat-composer").fill(acceptancePrompt);
  await page.getByTestId("chat-composer").press("Enter");
  const finalResponse = page.getByText(/Workspace analisado\. Criei e validei BLACKWALL_CONTEXT\.md/);
  for (let index = 0; index < 8; index += 1) {
    const allow = page.getByRole("button", { name: /Permitir uma vez|Allow once/ });
    await expect(allow).toBeVisible({ timeout: 10_000 });
    await allow.click();
  }
  await expect(finalResponse).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: /Arquivos|Files/, exact: true }).click();
  await expect(page.getByText("Blackwall Context", { exact: true })).toBeVisible();
});
