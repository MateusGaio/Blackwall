// MIT License — Copyright (c) 2026 Mateus Gaio
module.exports = {
  forbidden: [
    {
      name: "ui-must-not-import-sidecar",
      comment:
        "A interface fala apenas com contratos IPC/HTTP, nunca com a implementação do sidecar.",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^sidecar/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.app.json" },
    reporterOptions: { dot: { collapsePattern: "node_modules/[^/]+" } },
  },
};
