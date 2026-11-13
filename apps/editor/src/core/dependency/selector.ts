import { z } from "zod";

/**
 * Persistent instance id. Invalidation can be scoped to this unit.
 * Shape: `<prefix>_<ULID>` (Crockford base32, 26 characters).
 */
export const persistentInstanceIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]*_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, "instanceId는 <prefix>_<ULID> 형식이어야 합니다.");

const instanceFields = {
  instanceId: persistentInstanceIdSchema.optional(),
  /** WorldAsset.id. Bound by World lane Phase 1 validation. */
  assetId: z.string().min(1).optional(),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/**
 * Canonical selector grammar. Raw action-graph fields (`contact_id`, `actor_id`,
 * `kind: "motion"`) are normalized into this shape by `productionSelectorSchema`.
 * Contact may name `actorId` and `part` so one actor's rig part does not match every contact.
 */
const canonicalSelectorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("contact"),
    contactId: z.string().min(1).optional(),
    actorId: z.string().min(1).optional(),
    part: z.string().min(1).optional(),
    ...instanceFields,
  }),
  z.object({
    kind: z.literal("actor"),
    actorId: z.string().min(1),
    motion: z.enum(["motion", "root_motion"]).optional(),
    ...instanceFields,
  }),
  z.object({
    kind: z.literal("object"),
    objectId: z.string().min(1),
    ...instanceFields,
  }),
  z.object({
    kind: z.literal("camera_track"),
    cameraTrackId: z.string().min(1).optional(),
    ...instanceFields,
  }),
  z.object({
    kind: z.literal("set_layout"),
    setLayoutId: z.string().min(1).optional(),
    ...instanceFields,
  }),
  z.object({
    kind: z.literal("render_pass"),
    renderPassId: z.string().min(1),
    ...instanceFields,
  }),
]);

export type ProductionSelector = z.infer<typeof canonicalSelectorSchema>;

const sharedFields = (record: Record<string, unknown>) => {
  const instanceId = text(record.instanceId) ?? text(record.instance_id);
  const assetId = text(record.assetId);
  return {
    ...(instanceId ? { instanceId } : {}),
    ...(assetId ? { assetId } : {}),
  };
};

/**
 * Map one raw selector onto the canonical grammar.
 * `"dependent"` is the producer `render_passes` token, not a stored selector.
 * This is the only normalization. `interpretScopeEntry` calls it too.
 */
export const normalizeProductionSelector = (value: unknown): ProductionSelector | "dependent" | undefined => {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }
  if (value.kind === "render_passes" || value.kind === "dependent_render_passes") {
    return "dependent";
  }
  const actorId = text(value.actor_id) ?? text(value.actorId);
  const part = text(value.part) ?? text(value.rig_part);
  const shared = sharedFields(value);
  let canonical: unknown;
  if (value.kind === "contact" || value.kind === "contact_constraints") {
    const contactId = text(value.contact_id) ?? text(value.contactId);
    if (!contactId && !actorId) {
      return undefined;
    }
    canonical = {
      kind: "contact",
      ...(contactId ? { contactId } : {}),
      ...(actorId ? { actorId } : {}),
      ...(part ? { part } : {}),
      ...shared,
    };
  } else if (value.kind === "actor" || value.kind === "motion" || value.kind === "root_motion") {
    if (!actorId) {
      return undefined;
    }
    const motion = value.kind === "root_motion"
      ? "root_motion"
      : value.kind === "motion"
        ? "motion"
        : value.motion === "root_motion" || value.motion === "motion"
          ? value.motion
          : undefined;
    canonical = { kind: "actor", actorId, ...(motion ? { motion } : {}), ...shared };
  } else if (value.kind === "object" || value.kind === "prop") {
    const objectId = text(value.objectId) ?? text(value.object_id) ?? text(value.subjectId);
    if (!objectId) {
      return undefined;
    }
    canonical = { kind: "object", objectId, ...shared };
  } else if (value.kind === "camera_track" || value.kind === "camera" || value.kind === "camera_take") {
    const cameraTrackId = text(value.cameraTrackId) ?? text(value.takeId) ?? text(value.take_id);
    canonical = { kind: "camera_track", ...(cameraTrackId ? { cameraTrackId } : {}), ...shared };
  } else if (value.kind === "set_layout" || value.kind === "background" || value.kind === "room") {
    const setLayoutId = text(value.setLayoutId) ?? text(value.worldId) ?? text(value.world_id);
    canonical = { kind: "set_layout", ...(setLayoutId ? { setLayoutId } : {}), ...shared };
  } else if (value.kind === "render_pass") {
    const renderPassId = text(value.renderPassId) ?? text(value.render_pass_id);
    if (!renderPassId) {
      return undefined;
    }
    canonical = { kind: "render_pass", renderPassId, ...shared };
  } else {
    return undefined;
  }
  const parsed = canonicalSelectorSchema.safeParse(canonical);
  return parsed.success ? parsed.data : undefined;
};

/** Accepts canonical selectors and raw action-graph selectors. Output is canonical. */
export const productionSelectorSchema = z.unknown().transform((value, ctx): ProductionSelector => {
  const normalized = normalizeProductionSelector(value);
  if (!normalized || normalized === "dependent") {
    ctx.addIssue({ code: "custom", message: "셀렉터를 정규화할 수 없습니다." });
    return z.NEVER;
  }
  return normalized;
});

export const DEPENDENT_RENDER_PASSES = "dependent_render_passes";

export type SelectorQuery =
  | { kind: "contact"; contactId?: string; actorId?: string; part?: string; instanceId?: string }
  | { kind: "actor"; actorId: string; motion: "motion" | "root_motion"; instanceId?: string }
  | { kind: "object"; objectId?: string; instanceId?: string }
  | { kind: "camera_track"; cameraTrackId?: string; instanceId?: string }
  | { kind: "set_layout"; setLayoutId?: string; instanceId?: string }
  | { kind: "render_pass"; renderPassId?: string; instanceId?: string };

const actorIdPattern = /^actor_[A-Za-z0-9_]+$/;

/** Scope token used by revision events, derived from the selector grammar. */
export const selectorScopeToken = (selector: ProductionSelector): string => {
  switch (selector.kind) {
    case "contact":
      return selector.contactId
        ? `contact:${selector.contactId}`
        : `contact:${selector.actorId ?? "*"}:${selector.part ?? "*"}`;
    case "actor":
      return selector.motion === "root_motion"
        ? `${selector.actorId}_root_motion`
        : `${selector.actorId}_motion`;
    case "object":
      return `object:${selector.objectId}`;
    case "camera_track":
      return selector.cameraTrackId ? `camera_track:${selector.cameraTrackId}` : "camera_track";
    case "set_layout":
      return selector.setLayoutId ? `set_layout:${selector.setLayoutId}` : "set_layout";
    case "render_pass":
      return `render_pass:${selector.renderPassId}`;
    default: {
      const exhaustive: never = selector;
      return exhaustive;
    }
  }
};

/**
 * Parse a preserve/recompute token into a selector query.
 * `dependent_render_passes` is resolved from the downstream closure, not here.
 */
export const tokenToSelectorQuery = (token: string): SelectorQuery | typeof DEPENDENT_RENDER_PASSES | undefined => {
  if (token === "camera_track" || token === "camera" || token === "camera_take") {
    return { kind: "camera_track" };
  }
  if (token === "set_layout" || token === "room" || token === "background" || token === "room/background") {
    return { kind: "set_layout" };
  }
  if (token === "contact_constraints") {
    return { kind: "contact" };
  }
  if (token === DEPENDENT_RENDER_PASSES) {
    return DEPENDENT_RENDER_PASSES;
  }

  const contact = /^contact:(.+)$/.exec(token);
  if (contact?.[1]) {
    return { kind: "contact", contactId: contact[1] };
  }
  const objectToken = /^object:(.+)$/.exec(token);
  if (objectToken?.[1]) {
    return { kind: "object", objectId: objectToken[1] };
  }
  const renderPass = /^render_pass:(.+)$/.exec(token);
  if (renderPass?.[1]) {
    return { kind: "render_pass", renderPassId: renderPass[1] };
  }
  const camera = /^camera_track:(.+)$/.exec(token);
  if (camera?.[1]) {
    return { kind: "camera_track", cameraTrackId: camera[1] };
  }
  const setLayout = /^set_layout:(.+)$/.exec(token);
  if (setLayout?.[1]) {
    return { kind: "set_layout", setLayoutId: setLayout[1] };
  }

  const root = /^(.+)_root_motion$/.exec(token);
  if (root?.[1] && actorIdPattern.test(root[1])) {
    return { kind: "actor", actorId: root[1], motion: "root_motion" };
  }
  const motion = /^(.+)_motion$/.exec(token);
  if (motion?.[1] && actorIdPattern.test(motion[1])) {
    return { kind: "actor", actorId: motion[1], motion: "motion" };
  }
  return undefined;
};

export const selectorToQuery = (selector: ProductionSelector): SelectorQuery => {
  switch (selector.kind) {
    case "contact":
      return {
        kind: "contact",
        contactId: selector.contactId,
        actorId: selector.actorId,
        part: selector.part,
        instanceId: selector.instanceId,
      };
    case "actor":
      return {
        kind: "actor",
        actorId: selector.actorId,
        motion: selector.motion ?? "motion",
        instanceId: selector.instanceId,
      };
    case "object":
      return { kind: "object", objectId: selector.objectId, instanceId: selector.instanceId };
    case "camera_track":
      return { kind: "camera_track", cameraTrackId: selector.cameraTrackId, instanceId: selector.instanceId };
    case "set_layout":
      return { kind: "set_layout", setLayoutId: selector.setLayoutId, instanceId: selector.instanceId };
    case "render_pass":
      return { kind: "render_pass", renderPassId: selector.renderPassId, instanceId: selector.instanceId };
    default: {
      const exhaustive: never = selector;
      return exhaustive;
    }
  }
};

const instanceMatches = (outputInstanceId: string | undefined, queryInstanceId: string | undefined): boolean =>
  queryInstanceId === undefined || outputInstanceId === queryInstanceId;

/** A query without an id matches every output of that kind. Instance id narrows the unit. */
export const selectorMatches = (selector: ProductionSelector, query: SelectorQuery): boolean => {
  if (selector.kind !== query.kind || !instanceMatches(selector.instanceId, query.instanceId)) {
    return false;
  }
  switch (selector.kind) {
    case "contact":
      if (query.kind !== "contact") {
        return false;
      }
      if (query.contactId !== undefined) {
        return selector.contactId === query.contactId;
      }
      return (
        (query.actorId === undefined || selector.actorId === query.actorId) &&
        (query.part === undefined || selector.part === query.part)
      );
    case "actor":
      return (
        query.kind === "actor" &&
        selector.actorId === query.actorId &&
        (selector.motion ?? "motion") === query.motion
      );
    case "object":
      return query.kind === "object" && (query.objectId === undefined || selector.objectId === query.objectId);
    case "camera_track":
      return (
        query.kind === "camera_track" &&
        (query.cameraTrackId === undefined || selector.cameraTrackId === query.cameraTrackId)
      );
    case "set_layout":
      return (
        query.kind === "set_layout" &&
        (query.setLayoutId === undefined || selector.setLayoutId === query.setLayoutId)
      );
    case "render_pass":
      return (
        query.kind === "render_pass" &&
        (query.renderPassId === undefined || selector.renderPassId === query.renderPassId)
      );
    default: {
      const exhaustive: never = selector;
      return exhaustive;
    }
  }
};
