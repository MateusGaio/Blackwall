// MIT License — Copyright (c) 2026 Mateus Gaio
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "progress", "html", "json"],
  // O job agendado começa pelo núcleo de observabilidade; novos módulos podem
  // ser adicionados quando tiverem testes de mutação dedicados.
  mutate: ["sidecar/src/observability.ts"],
  coverageAnalysis: "off",
  tempDirName: ".stryker-tmp",
};
