// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../../shared/api/sidecar";
import { groupThreadItems } from "./groupThreadItems";

const tool = (id: string): ChatMessage =>
  ({ content: "ok", id, role: "tool", toolCallId: id, toolName: "read_file" }) as ChatMessage;
const assistant = (id: string, content = ""): ChatMessage =>
  ({ content, id, role: "assistant" }) as ChatMessage;
const user = (id: string): ChatMessage => ({ content: "oi", id, role: "user" }) as ChatMessage;

describe("agrupamento da thread (#218)", () => {
  it("associa os passos À RESPOSTA SEGUINTE do assistente", () => {
    const items = groupThreadItems([tool("t1"), tool("t2"), assistant("a1", "pronto")]);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("message");
    if (items[0]?.kind === "message") {
      expect(items[0].steps.map((step) => step.id)).toEqual(["t1", "t2"]);
      expect(items[0].message.id).toBe("a1");
    }
  });

  it("passos órfãos no fim viram bloco de fallback preservado", () => {
    const items = groupThreadItems([assistant("a1", "x"), tool("t9")]);
    expect(items).toHaveLength(2);
    expect(items[1]?.kind).toBe("orphan-steps");
    if (items[1]?.kind === "orphan-steps") expect(items[1].steps.map((s) => s.id)).toEqual(["t9"]);
  });

  it("passos seguidos por mensagem do usuário não desaparecem (órfão antes dela)", () => {
    const items = groupThreadItems([tool("t1"), user("u1")]);
    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe("orphan-steps");
    expect(items[1]?.kind).toBe("message");
  });

  it("resposta sem passos carrega lista vazia (sem disclosure)", () => {
    const items = groupThreadItems([assistant("a1", "direto")]);
    if (items[0]?.kind === "message") expect(items[0].steps).toEqual([]);
  });
});
