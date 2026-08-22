// MIT License — Copyright (c) 2026 Mateus Gaio
import type { ConnectedProvider } from "../../../../shared/api/sidecar";

export type ProviderForm = {
  apiKey: string;
  baseUrl: string;
  model: string;
  name: string;
  type: ConnectedProvider["type"];
};

export const emptyForm: ProviderForm = {
  apiKey: "",
  baseUrl: "http://127.0.0.1:11434",
  model: "",
  name: "Ollama local",
  type: "ollama",
};
