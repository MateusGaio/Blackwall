// MIT License — Copyright (c) 2026 Mateus Gaio
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
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
import { judge, type TaskExpect } from "./judge.js";

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

/** Digest recursivo da árvore: caminho relativo → hash(tamanho+conteúdo). */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  async function walk(current: string, prefix: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = `${current}/${entry.name}`;
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, key);
      } else {
        const info = await stat(absolute);
        map.set(
          key,
          createHash("sha256").update(`${info.size}:`).update(await readFile(absolute)).digest("hex"),
        );
      }
    }
  }
  await walk(root, "");
  return map;
}

function diffTrees(before: Map<string, string>, after: Map<string, string>): string[] {
  const changes: string[] = [];
  for (const [key, value] of before) if (after.get(key) !== value) changes.push(`M ${key}`);
  for (const key of after.keys()) if (!before.has(key)) changes.push(`A ${key}`);
  for (const key of before.keys()) if (!after.has(key)) changes.push(`D ${key}`);
  return changes;
}

type TaskResult = { id: string; passed: boolean; detail?: string };

describe("evals determinísticos (#211) — camada 1 de CI", () => {
  it(
    `executa as ${TOOL_TASKS.length} tarefas com medição real de mutação/escape`,
    async () => {
      expect(TOOL_TASKS.length).toBe(34);
      const results: TaskResult[] = [];
      let improperCardsInAutomatic = 0;
      let readOnlyMutations = 0;
      let escapes = 0;

      for (const task of TOOL_TASKS) {
        const { directory, state } = await setupTask(task);
        // Medição REAL por diff de digests do workspace e do diretório
        // controlado (pai de ws/) — nada é contador declarado.
        const workspaceRoot = join(directory, "ws");
        const beforeWs = await snapshotTree(workspaceRoot);
        const beforeControlled = await snapshotTree(directory);

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
        execution.catch(() => undefined);

        await new Promise((resolveDone) => setTimeout(resolveDone, 5));
        if (approvalCount > 0 && task.approve)
          await resolveApproval(`${task.id}-req`, "allow_once", directory);
        else if (approvalCount > 0 && !task.approve)
          await resolveApproval(`${task.id}-req`, "deny", directory);

        const settledResult = await execution.then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );

        let judged: TaskResult;
        if (!settledResult.ok) {
          const error = settledResult.error;
          const rawCode = (error as { code?: unknown })?.code;
          judged = judge(task.expect as TaskExpect, {
            ok: false,
            errorCode:
              error instanceof ToolPolicyDenied
                ? error.code
                : typeof rawCode === "string"
                  ? rawCode
                  : undefined,
            message: error instanceof Error ? error.message : String(error),
          });
        } else {
          const outcome = settledResult.value;
          judged = judge(task.expect as TaskExpect, {
            ok: true,
            data:
              typeof outcome === "object" && outcome !== null
                ? (outcome as Record<string, unknown>)
                : outcome,
          });
        }
        results.push({ id: task.id, passed: judged.passed, detail: judged.detail });

        if (task.mode === "automatic" && !task.approve && approvalCount > 0)
          improperCardsInAutomatic += 1;

        const afterWs = await snapshotTree(workspaceRoot);
        const afterControlled = await snapshotTree(directory);
        const mutated = diffTrees(beforeWs, afterWs);
        const outside = diffTrees(beforeControlled, afterControlled).filter((change) => {
          // Artefatos de infraestrutura do sidecar não são fugas.
          if (/blackwall\.db(-shm|-wal)?$/.test(change)) return false;
          return !mutated.some((mutation) => change.endsWith(mutation.slice(2)));
        });
        if (task.mode === "read-only" && task.category === "edit" && mutated.length > 0) {
          readOnlyMutations += 1;
          console.info(`[evals] MUTAÇÃO em read-only (${task.id}):`, mutated.join(", "));
        }
        if (outside.length > 0) {
          escapes += 1;
          console.info(`[evals] ESCAPE (${task.id}):`, outside.join(", "));
        }
      }

      const total = results.length;
      const passed = results.filter((result) => result.passed).length;
      const failures = results.filter((result) => !result.passed);
      console.info(
        `[evals] conclusão determinística: ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)` +
          ` · cards indevidos em Automático: ${improperCardsInAutomatic}` +
          ` · mutações em Read-only: ${readOnlyMutations} · escapes: ${escapes}`,
      );
      if (failures.length > 0)
        console.info(
          "[evals] falhas:",
          failures.map((failure) => `${failure.id}: ${failure.detail ?? "?"}`).join(" | "),
        );

      expect(passed / total).toBeGreaterThanOrEqual(DETERMINISTIC_GOALS.conclusionRate);
      expect(improperCardsInAutomatic).toBe(0);
      expect(readOnlyMutations).toBe(0);
      expect(escapes).toBe(0);
    },
    60_000,
  );

  it("corpus cobre as categorias na proporção mínima exigida", () => {
    const counts = TOOL_TASKS.reduce<Record<string, number>>((acc, task) => {
      acc[task.category] = (acc[task.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.explore).toBeGreaterThanOrEqual(10);
    expect(counts.edit).toBeGreaterThanOrEqual(10);
    expect(counts.execute).toBeGreaterThanOrEqual(8);
    expect(counts.recovery).toBeGreaterThanOrEqual(6);
  });
});
