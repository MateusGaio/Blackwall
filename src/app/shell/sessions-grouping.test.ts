// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import type { SessionSummary, Workspace } from "../../shared/api/sidecar";
import { groupSessionsByWorkspace } from "./sessions-grouping";

const workspace = (id: string, name: string): Workspace =>
  ({
    id,
    name,
  }) as unknown as Workspace;

const session = (id: string, overrides: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    createdAt: 1_000,
    id,
    profileId: "profile-1",
    selectedModel: null,
    selectedProviderId: null,
    title: `Sessão ${id}`,
    updatedAt: 1_000,
    workspaceId: null,
    ...overrides,
  }) as unknown as SessionSummary;

const wsA = workspace("ws-a", "Projeto A");
const wsB = workspace("ws-b", "Projeto B");

describe("groupSessionsByWorkspace", () => {
  it("agrupa cada sessão exatamente uma vez sob o workspace correto", () => {
    const groups = groupSessionsByWorkspace(
      [
        session("s1", { workspaceId: "ws-a" }),
        session("s2", { workspaceId: "ws-a" }),
        session("s3", { workspaceId: "ws-b" }),
      ],
      [wsA, wsB],
      "ws-a",
    );
    const flat = groups.flatMap((group) => group.sessions.map((item) => item.id));
    expect(flat).toHaveLength(3);
    expect(new Set(flat).size).toBe(3);
    expect(groups.find((group) => group.workspace?.id === "ws-a")?.sessionIdOrder).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("coloca sessões sem workspace no grupo final 'Sem workspace'", () => {
    const groups = groupSessionsByWorkspace(
      [session("s-livre"), session("s1", { workspaceId: "ws-a" })],
      [wsA],
      null,
    );
    expect(groups.at(-1)?.workspace).toBeNull();
    expect(groups.at(-1)?.sessions.map((item) => item.id)).toEqual(["s-livre"]);
  });

  it("ordena por updatedAt DESC com desempate createdAt DESC", () => {
    const groups = groupSessionsByWorkspace(
      [
        session("antiga", {
          createdAt: 100,
          updatedAt: 500,
          workspaceId: "ws-a",
        }),
        session("recente", {
          createdAt: 900,
          updatedAt: 900,
          workspaceId: "ws-a",
        }),
        session("empate", {
          createdAt: 700,
          updatedAt: 500,
          workspaceId: "ws-a",
        }),
      ],
      [wsA],
      null,
    );
    expect(groups[0].sessionIdOrder).toEqual(["recente", "empate", "antiga"]);
  });

  it("preserva a ordem dos workspaces do estado e destaca o ativo como expandido", () => {
    const groups = groupSessionsByWorkspace(
      [session("a1", { workspaceId: "ws-b" }), session("b1", { workspaceId: "ws-a" })],
      [wsA, wsB],
      "ws-b",
    );
    expect(groups.map((group) => group.workspace?.id)).toEqual(["ws-a", "ws-b"]);
    expect(groups.find((group) => group.workspace?.id === "ws-b")?.isExpandedByDefault).toBe(true);
    expect(groups.find((group) => group.workspace?.id === "ws-a")?.isExpandedByDefault).toBe(false);
  });

  it("sem workspace ativo, o grupo 'Sem workspace' nasce expandido", () => {
    const groups = groupSessionsByWorkspace(
      [session("livre"), session("x", { workspaceId: "ws-a" })],
      [wsA],
      null,
    );
    expect(groups.at(-1)?.workspace).toBeNull();
    expect(groups.at(-1)?.isExpandedByDefault).toBe(true);
    expect(groups[0].isExpandedByDefault).toBe(false);
  });
});
