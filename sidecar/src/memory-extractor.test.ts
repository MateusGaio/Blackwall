// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import { memoryExtractionMessages, parseMemoryExtraction } from "./memory-extractor.js";

describe("extrator de memória", () => {
  it("aceita somente o schema estrito e no máximo cinco candidatos", () => {
    expect(parseMemoryExtraction("[]")).toEqual([]);
    expect(
      parseMemoryExtraction(
        JSON.stringify([
          {
            confidence: 0.98,
            kind: "preference",
            reasonCode: "user_preference",
            scope: "profile",
            statement: "Prefere respostas curtas.",
            subject: "estilo",
            value: "respostas curtas",
          },
        ]),
      ),
    ).toHaveLength(1);
    expect(() => parseMemoryExtraction('{"scope":"profile","extra":true}')).toThrow(
      "formato do extrator",
    );
    expect(() =>
      parseMemoryExtraction(
        JSON.stringify([
          {
            confidence: 2,
            kind: "preference",
            reasonCode: "user_preference",
            scope: "profile",
            statement: "x",
            subject: "x",
            value: "x",
          },
        ]),
      ),
    ).toThrow("confiança");
  });

  it("monta exatamente system + user redigido", () => {
    const messages = memoryExtractionMessages("Prefiro respostas objetivas. api_key=secret123");
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[1]?.content).not.toContain("secret123");
  });
});
