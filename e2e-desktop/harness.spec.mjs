// MIT License — Copyright (c) 2026 Mateus Gaio
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const prompt =
  "Explore o workspace selecionado e entenda o projeto dentro dele. Comece listando a raiz e use apenas os caminhos realmente retornados pelas ferramentas. Ignore dependências, ambientes virtuais, caches, builds e arquivos gerados. Leia a documentação, manifests, configurações, pontos de entrada, código principal e testes relevantes. Crie ou atualize `BLACKWALL_CONTEXT.md` na raiz do workspace com um resumo técnico completo. Inclua wikilinks para arquivos Markdown existentes e links Markdown para os arquivos de código citados. Ao terminar, releia o resumo, valide todos os links e informe o que foi criado.";

describe("Blackwall desktop harness", () => {
  it("explora, autoriza, escreve, abre no Vault e restaura", async () => {
    const profile = await $("button*=Perfil Desktop E2E");
    await profile.waitForDisplayed();
    await profile.click();
    const composer = await $('[data-testid="chat-composer"]');
    await composer.waitForDisplayed();
    await composer.setValue(prompt);
    await browser.keys("Enter");
    for (let index = 0; index < 8; index += 1) {
      const allow = await $("button*=Permitir uma vez");
      await allow.waitForDisplayed();
      await allow.click();
    }
    const finalResponse = await $("*=Workspace analisado. Criei e validei BLACKWALL_CONTEXT.md");
    await finalResponse.waitForDisplayed();
    const contextPath = join(process.env.BLACKWALL_HARNESS_WORKSPACE, "BLACKWALL_CONTEXT.md");
    await access(contextPath);
    const content = await readFile(contextPath, "utf8");
    expect(content).toContain("[[README]]");
    expect(content).toContain("[entrada](src/index.ts)");
    const filesTab = await $("button*=Arquivos");
    await filesTab.click();
    const note = await $("button*=Blackwall Context");
    await note.waitForDisplayed();
    await browser.reloadSession();
    const restoredProfile = await $("button*=Perfil Desktop E2E");
    await restoredProfile.waitForDisplayed();
    await restoredProfile.click();
    await $("*=Workspace analisado. Criei e validei BLACKWALL_CONTEXT.md").waitForDisplayed();
  });
});
