export interface SceneGroup { id: string; name: string; members: string[]; collapsed: boolean }
export interface SceneOrganization { groups: SceneGroup[] }
export const emptyOrganization = (): SceneOrganization => ({ groups: [] });

export function parseOrganization(value: unknown, objectIds: Set<string>): SceneOrganization {
  if (value === undefined) return emptyOrganization();
  if (!value || typeof value !== "object") throw new Error("Invalid scene organization.");
  const raw = value as Record<string, unknown>;
  const ids = (input: unknown): string[] => {
    if (!Array.isArray(input) || input.some(id => typeof id !== "string")) throw new Error("Invalid scene object list.");
    return [...new Set(input as string[])].filter(id => objectIds.has(id));
  };
  if (!Array.isArray(raw.groups)) throw new Error("Invalid scene groups.");
  const assigned = new Set<string>(), groupIds = new Set<string>();
  const groups = raw.groups.map(value => {
    if (!value || typeof value !== "object") throw new Error("Invalid scene group.");
    const group = value as SceneGroup;
    if (typeof group.id !== "string" || !group.id || groupIds.has(group.id) || typeof group.name !== "string" || !group.name.trim()) throw new Error("Invalid scene group identity.");
    groupIds.add(group.id);
    const members = ids(group.members).filter(id => { if (assigned.has(id)) return false; assigned.add(id); return true; });
    return { id: group.id, name: group.name.trim(), members, collapsed: group.collapsed === true };
  });
  // Older projects may include visibility/lock flags. Ignore them so all objects remain usable.
  return { groups };
}
export function moveToGroup(value: SceneOrganization, ids: string[], groupId: string | null): SceneOrganization {
  const moving = new Set(ids);
  return { ...value, groups: value.groups.map(group => ({ ...group,
    members: [...group.members.filter(id => !moving.has(id)), ...(group.id === groupId ? ids : [])],
    collapsed: group.id === groupId ? false : group.collapsed,
  })) };
}
export function rangeSelection(visibleIds: string[], anchor: string | null, target: string): string[] {
  const a = visibleIds.indexOf(anchor ?? ""), b = visibleIds.indexOf(target);
  return a < 0 || b < 0 ? [target] : visibleIds.slice(Math.min(a, b), Math.max(a, b) + 1);
}
