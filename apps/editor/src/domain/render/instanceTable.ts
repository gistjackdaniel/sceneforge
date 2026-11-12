import type { Shot } from "../shot/types";
import type { InstanceIdEntry } from "./types";

const byId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

export type InstanceMembership = {
  persistentId: string;
  role: InstanceIdEntry["role"];
};

/** Visible instances the raster can name. Order is not yet the pixel index. */
export const instanceMembership = (shot: Shot): InstanceMembership[] => {
  const members: InstanceMembership[] = [];
  const roomId = shot.environment?.worldId;
  if (roomId) members.push({ persistentId: roomId, role: "room" });
  for (const subject of shot.subjects) {
    if (!subject.visible || subject.kind === "light") continue;
    members.push({
      persistentId: subject.id,
      role: subject.kind === "human" ? "actor" : "object",
    });
  }
  return members;
};

/**
 * Stable uint32 encoding. Index 0 is a miss and is not an entry.
 * Rows are sorted by the current persistent id so array order in the shot
 * does not change pixel values. The id strings stay in the table; pass hashes
 * other than `instance_id` do not read them.
 */
export const deriveInstanceTable = (shot: Shot): InstanceIdEntry[] => {
  return [...instanceMembership(shot)]
    .sort((left, right) => byId(left.persistentId, right.persistentId))
    .map((member, index) => ({
      index: index + 1,
      persistentId: member.persistentId,
      role: member.role,
    }));
};

export const instanceTableError = (
  shot: Shot,
  table: readonly InstanceIdEntry[],
): string | undefined => {
  const expected = instanceMembership(shot);
  const expectedIds = [...expected].map((member) => member.persistentId).sort(byId);
  const actualIds = table.map((entry) => entry.persistentId);
  const sortedActual = [...actualIds].sort(byId);
  if (expectedIds.length !== sortedActual.length || expectedIds.some((id, index) => id !== sortedActual[index])) {
    return "Instance table ids must be the scene's current persistent ids.";
  }
  const indices = new Set<number>();
  const ids = new Set<string>();
  for (const entry of table) {
    if (!Number.isInteger(entry.index) || entry.index <= 0 || entry.index > 0xffffffff) {
      return "Instance pixel values must be positive uint32 indices.";
    }
    if (indices.has(entry.index)) return "Instance pixel values must be unique.";
    if (ids.has(entry.persistentId)) return "Instance ids must be unique.";
    indices.add(entry.index);
    ids.add(entry.persistentId);
    const member = expected.find((item) => item.persistentId === entry.persistentId);
    if (!member || member.role !== entry.role) return "Instance role does not match the scene.";
  }
  return undefined;
};
