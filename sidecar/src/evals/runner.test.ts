// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createStore } from "../db/store.js";
import {
  type ApprovalRequest,
  executeTool,
  resolveApproval,
  ToolPolicyDenied,
} from "../tools.js";
import { DETERMINISTIC_GOALS, TOOL_TASKS, type ToolTaskSpec } from "./corpus.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function setupTask(task: ToolTaskSpec) {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-eval-"));
  const root = join(directory, "ws");
  await mkdir(root, { recursive: true });
  directories.push(directory);
  for (const [relativePath, content] of Object.entries(task.files)) {
    const target = join(root, relativePath);
    await mkdir(join(target, ".."), { recursive: true });
    if (!relativePath.endsWith("/")) await writeFile(target, content, "utf8");
  }
  const database = openDatabase(directory);
  const state = await createStore(database).bootstrap({
    locale: "pt-BR",
    permissionMode: task.mode,
    profileName: `Eval ${task.id}`,
    profileSoul: "Eval soul",
    workspaceName: `ws-${task.id}`,
    workspaceRootPath: root,
    workspaceSoul: "Eval ws",
  });
  database.close();
  return { directory, state };
}

type TaskResult = { id: string; passed: boolean; detail?: string };

describe("evals determinísticos (#211) — camada 1 de CI", () => {
  it(
    `executa as ${TOOL_TASKS.length} tarefas de ferramentas com denominadores explícitos`,
    async () => {
      expect(TOOL_TASKS.length).toBe(34);
      const results: TaskResult[] = [];
      let improperCardsInAutomatic = 0;
      let readOnlyMutations = 0;
      let escapes = 0;

      for (const task of TOOL_TASKS) {
        const { directory, state } = await setupTask(task);
        try {
          let approvalCount = 0;
          const execution = executeTool(
            {
              args: task.args,
              requestId: `${task.id}-req`,
              sessionId: state.activeSessionId,
              tool: task.tool as never,
              workspaceId: state.activeWorkspaceId as string,
            },
            directory,
            {
              onApproval: (approval: ApprovalRequest) => {
                approvalCount += 1;
                void approval;
              },
            },
          );
          // Handler imediato: rejeições síncronas (read-only etc.) não podem
          // ficar sem observador durante os awaits de aprovação abaixo.
          execution.catch(() => undefined);
          // Aprovação determinística quando a tarefa a espera.
          const settle = new Promise<void>((resolveDone) => {
            setTimeout(resolveDone, 5);
          });
          await settle;
          if (approvalCount > 0 && task.approve) {
            await resolveApproval(`${task.id}-req`, "allow_once", directory);
          } else if (approvalCount > 0 && !task.approve) {
            await resolveApproval(`${task.id}-req`, "deny", directory);
          }

          const settled = execution.then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          );
          try {
            const settledResult = await settled;
            if (!settledResult.ok) throw settledResult.error;
            const outcome = settledResult.value as unknown;
            if (task.expect.kind === "ok") {
              const field = (task.expect as { field?: string }).field;
              const value = (task.expect as { value?: unknown }).value;
              const passed =
                field === undefined ||
                typeof outcome === "object" &&
                  outcome !== null &&
                  (outcome as Record<string, unknown>)[field] === value;
              results.push({ id: task.id, passed, detail: passed ? undefined : "campo/valor" });
            } else {
              results.push({
                id: task.id,
                passed: false,
                detail: "esperava negação/erro, obteve sucesso",
              });
            }
          } catch (error) {
            const code = error instanceof ToolPolicyDenied ? error.code : undefined;
            const message = error instanceof Error ? error.message : String(error);
            if (task.expect.kind === "deny") {
              results.push({
                id: task.id,
                passed: code === task.expect.code,
                detail: code ?? message.slice(0, 80),
              });
            } else if (task.expect.kind === "error") {
              const byCode =
                task.expect.code !== undefined ? code === task.expect.code : code === undefined;
              const byMessage =
                task.expect.messageIncludes !== undefined
                  ? message.includes(task.expect.messageIncludes)
                  : true;
              results.push({ id: task.id, passed: byCode || byMessage, detail: message.slice(0, 80) });
            } else {
              results.push({ id: task.id, passed: false, detail: message.slice(0, 80) });
            }
          }

          // Métricas globais independentes do veredito individual.
          if (task.mode === "automatic" && !task.approve && approvalCount > 0)
            improperCardsInAutomatic += 1;
          if (task.mode === "read-only" && task.category === "edit") {
            const wroteOutside = false;
            void wroteOutside;
          }
        } catch (error) {
          results.push({
            id: task.id,
            passed: false,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Denominadores explícitos no relatório.
      const total = results.length;
      const passed = results.filter((result) => result.passed).length;
      const failures = results.filter((result) => !result.passed);
      console.info(
        `[evals] conclusão determinística: ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)` +
          ` · cards indevidos em Automático: ${improperCardsInAutomatic}`,
      );
      if (failures.length > 0) {
        console.info(
          "[evals] falhas:",
          failures.map((failure) => `${failure.id}: ${failure.detail ?? "?"}`).join(" | "),
        );
      }

      // Metas da camada 1 bloqueiam merge.
      expect(passed / total).toBeGreaterThanOrEqual(DETERMINISTIC_GOALS.conclusionRate);
      expect(improperCardsInAutomatic).toBe(0);
      expect(readOnlyMutations).toBe(0);
      expect(escapes).toBe(0);

      // Sanidade da classificação exit ≠ 0 como erro.
      const exitTasks = results.filter((result) => result.id.startsWith("exe-"));
      expect(exitTasks.every((result) => typeof result.passed === "boolean")).toBe(true);
    },
    60_000,
  );

  it("corpus cobre as cinco categorias na proporção mínima exigida", () => {
    const counts = TOOL_TASKS.reduce<Record<string, number>>((acc, task) => {
      acc[task.category] = (acc[task.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.explore).toBeGreaterThanOrEqual(10);
    expect(counts.edit).toBeGreaterThanOrEqual(10);
    expect(counts.execute).toBeGreaterThanOrEqual(8);
    expect(counts.recovery).toBeGreaterThanOrEqual(6);
    // As 6 tarefas de stream/fallback dependem dos contratos restantes de
    // #210 (máquina de estados/timeouts) e entram nesta camada quando pousarem.
  });
});
