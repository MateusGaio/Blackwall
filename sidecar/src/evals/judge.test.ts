// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { judge, type TaskExpect } from "./judge.js";

describe("judge — negativos: expectativa errada NÃO passa (#211)", () => {
  const denyExpect: TaskExpect = { kind: "deny", code: "READ_ONLY_MUTATION" };
  const errorBoth: TaskExpect = {
    kind: "error",
    code: "COMMAND_EXIT_CODE",
    messageIncludes: "código 7",
  };

  it("deny com código diferente falha", () => {
    expect(judge(denyExpect, { ok: false, errorCode: "READ_ONLY_COMMAND" }).passed).toBe(false);
    expect(judge(denyExpect, { ok: true, data: {} }).passed).toBe(false);
  });

  it("erro com código certo e mensagem errada falha (conjunção)", () => {
    const result = judge(errorBoth, {
      ok: false,
      errorCode: "COMMAND_EXIT_CODE",
      message: "O comando saiu com o código 3.",
    });
    expect(result.passed).toBe(false);
  });

  it("erro com mensagem certa e código errado falha", () => {
    const result = judge(errorBoth, {
      ok: false,
      errorCode: "COMMAND_SPAWN_FAILED",
      message: "saiu com o código 7",
    });
    expect(result.passed).toBe(false);
  });

  it("ok com campo/valor divergentes falha", () => {
    const expect_: TaskExpect = { kind: "ok", field: "code", value: 0 };
    expect(judge(expect_, { ok: true, data: { code: 3 } }).passed).toBe(false);
    expect(judge(expect_, { ok: false, errorCode: "x" }).passed).toBe(false);
  });

  it("positivos de controle passam", () => {
    expect(judge(denyExpect, { ok: false, errorCode: "READ_ONLY_MUTATION" }).passed).toBe(true);
    expect(
      judge(errorBoth, {
        ok: false,
        errorCode: "COMMAND_EXIT_CODE",
        message: "O comando saiu com o código 7.",
      }).passed,
    ).toBe(true);
  });
});
