// MIT License — Copyright (c) 2026 Mateus Gaio
import type { SessionSummary, Workspace } from "../../shared/api/sidecar";

export type SessionGroup = {
  /** null = grupo "Sem workspace" (sessões com workspaceId nulo). */
  workspace: Workspace | null;
  isExpandedByDefault: boolean;
  sessionIdOrder: string[];
  sessions: SessionSummary[];
};

/**
 * Agrupa as sessões recentes por workspace para a sidebar em árvore:
 * - cada sessão aparece exatamente uma vez, sob o workspace dela;
 * - `workspaceId === null` vai para o grupo "Sem workspace", sempre por último;
 * - dentro do grupo: `updatedAt DESC`, desempate `createdAt DESC`;
 * - workspaces com chats ordenam pelo chat mais recente;
 * - empates e workspaces sem chats preservam a ordem original do estado;
 * - o grupo do workspace ativo nasce expandido.
 */
export function groupSessionsByWorkspace(
  sessions: ReadonlyArray<SessionSummary>,
  workspaces: ReadonlyArray<Workspace>,
  activeWorkspaceId?: string | null,
): SessionGroup[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const groups: SessionGroup[] = [];
  const groupByWorkspaceId = new Map<string | null, SessionGroup>();

  function ensureGroup(workspaceId: string | null): SessionGroup {
    let group = groupByWorkspaceId.get(workspaceId);
    if (!group) {
      group = {
        workspace: workspaceId
          ? (workspaces.find((item) => item.id === workspaceId) ?? null)
          : null,
        isExpandedByDefault: false,
        sessionIdOrder: [],
        sessions: [],
      };
      groupByWorkspaceId.set(workspaceId, group);
      groups.push(group);
    }
    return group;
  }

  for (const workspace of workspaces) ensureGroup(workspace.id);

  for (const session of [...sessions].sort((left, right) => {
    const delta = right.updatedAt - left.updatedAt || right.createdAt - left.createdAt;
    return delta || left.id.localeCompare(right.id);
  })) {
    const workspaceId = session.workspaceId ?? null;
    // Sessões cujo workspace não veio na lista ainda pertencem ao grupo dele.
    const group = ensureGroup(workspaceId);
    if (!group.sessionIdOrder.includes(session.id)) {
      group.sessions.push(byId.get(session.id) ?? session);
      group.sessionIdOrder.push(session.id);
    }
  }

  const withoutWorkspace = groupByWorkspaceId.get(null);
  const workspaceOrder = new Map(groups.map((group, index) => [group, index]));
  const latestByGroup = new Map<SessionGroup, { createdAt: number; updatedAt: number }>();
  for (const group of groups) {
    const latest = group.sessions.reduce<{ createdAt: number; updatedAt: number } | null>(
      (current, session) => {
        if (
          !current ||
          session.updatedAt > current.updatedAt ||
          (session.updatedAt === current.updatedAt && session.createdAt > current.createdAt)
        ) {
          return { createdAt: session.createdAt, updatedAt: session.updatedAt };
        }
        return current;
      },
      null,
    );
    if (latest) latestByGroup.set(group, latest);
  }
  const ordered = groups
    .filter((group) => group !== withoutWorkspace)
    .sort((left, right) => {
      const leftLatest = latestByGroup.get(left);
      const rightLatest = latestByGroup.get(right);
      if (!leftLatest && !rightLatest) {
        return (workspaceOrder.get(left) ?? 0) - (workspaceOrder.get(right) ?? 0);
      }
      if (!leftLatest) return 1;
      if (!rightLatest) return -1;
      return (
        rightLatest.updatedAt - leftLatest.updatedAt ||
        rightLatest.createdAt - leftLatest.createdAt ||
        (workspaceOrder.get(left) ?? 0) - (workspaceOrder.get(right) ?? 0)
      );
    });
  if (withoutWorkspace?.sessions.length) ordered.push(withoutWorkspace);

  for (const group of ordered) {
    // Grupo ativo nasce expandido: o do workspace ativo, ou o "Sem
    // workspace" quando nenhum workspace está ativo.
    group.isExpandedByDefault = group.workspace
      ? group.workspace.id === activeWorkspaceId
      : !activeWorkspaceId;
  }
  return ordered.filter((group) => group.sessions.length > 0 || group.workspace);
}
