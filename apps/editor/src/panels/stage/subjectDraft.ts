import type { SubjectDraft } from "../../domain/shot";
import type { SceneObject } from "../../domain/worlds/sceneObjects";

export const subjectDraftFromObject = (object: SceneObject): SubjectDraft => {
  const placement = { position: object.position, rotationEuler: object.rotation, scale: object.scale };
  if (object.kind === "light") return { kind: "light", id: object.id, name: object.name, placement };
  if (object.representation === "mesh" && object.uri) {
    return object.kind === "actor"
      ? { kind: "human", id: object.id, name: object.name, fileUri: object.uri, placement }
      : { kind: "object", id: object.id, name: object.name, fileUri: object.uri, placement };
  }
  if (object.representation === "box" || object.representation === "sphere") {
    return { kind: "object", id: object.id, name: object.name, primitive: object.representation, placement };
  }
  return { kind: "marker", id: object.id, name: object.name, role: object.kind === "actor" ? "human" : "object", placement };
};
