import type { RenderCacheEntry } from "../../domain/rendering/types";
import type { EnvironmentView, Motion, Shot, ShotModelInput } from "../../domain/shot";
import { prepareModelInput } from "../../domain/shot";
import type { WorldAsset } from "../../domain/worlds/types";
import { contactHandDownstreamId, contactHandId } from "./editScope";
import { computePassHash, dependencyFingerprintSchema, productionOutputSchema, type ProductionOutput } from "./fingerprint";
import { shotRecordFps, type ShotFpsSource } from "./shotFps";
import type { ProductionSelector } from "./selector";
import { bindWorldPhase1Selectors, resolveWorldAssetId } from "./worldPhase1";

/**
 * Dependency nodes projected from a shot record.
 *
 * The shot keeps one motion per subject and one selected camera take.
 * Root motion reads placement plus key positions. Contact-hand pose reads
 * key rotation and scale. The room is `environment.worldId`, a `WorldAsset.id`.
 * Frames are integers. fps comes from `ShotFpsSource` (`shot.time.fps`).
 */

export type ShotDependencyEntity = "actor" | "prop" | "room" | "pose" | "camera_take";

export interface PoseFrame {
  frame: number;
  position?: readonly [number, number, number];
  rotationEuler?: readonly [number, number, number];
  scale?: readonly [number, number, number];
}

export interface ShotDependencyNode {
  output: ProductionOutput;
  entity: ShotDependencyEntity;
  /** Subject id, camera take id, or `WorldAsset.id`. */
  unitId: string;
  channel?: "root_motion" | "contact_hand" | "contact_hand_downstream";
  /** Pass slice stored in the cache. Its normalized hash is `hash`. */
  value: unknown;
  hash: string;
  downstreamNodeIds: string[];
}

export type ShotDependencyGraph =
  | {
      ok: true;
      fps: number;
      assetId: string;
      revisionId: string;
      nodes: ShotDependencyNode[];
      outputs: ProductionOutput[];
      downstreamByNodeId: Record<string, string[]>;
      caches: Record<string, RenderCacheEntry>;
    }
  | { ok: false; error: "invalid_shot" | "unresolved_asset"; message: string };

const defaultContext = { selectionIds: [] as string[], locale: "en" as const };

const cacheEntry = (node: { cacheId: string; nodeId: string; hash: string }, clipId: string): RenderCacheEntry => ({
  id: node.cacheId,
  clipId,
  nodeId: node.nodeId,
  label: node.nodeId,
  kind: "node_evaluation",
  status: "valid",
  updatedAt: "t0",
  invalidatedByNodeIds: [],
  dependencyHash: node.hash,
});

const readPoseFrames = (
  motion: Motion,
  channel: "root_motion" | "contact_hand",
): { ok: true; frames: PoseFrame[]; prompt?: string } | { ok: false; message: string } => {
  if (motion.channel === "unset") {
    return { ok: true, frames: [] };
  }
  if (motion.channel === "text") {
    return { ok: true, frames: [], prompt: motion.prompt };
  }
  const frames: PoseFrame[] = [];
  for (const key of motion.keys) {
    if (!Number.isInteger(key.frame)) {
      return { ok: false, message: "포즈 시간은 정수 프레임이어야 합니다." };
    }
    frames.push(
      channel === "root_motion"
        ? { frame: key.frame, position: key.position }
        : { frame: key.frame, rotationEuler: key.rotationEuler, scale: key.scale },
    );
  }
  return { ok: true, frames };
};

const integerKeys = (keys: readonly { frame: number }[]): boolean => keys.every((key) => Number.isInteger(key.frame));

const poseNode = (
  subject: Extract<ShotModelInput["subjects"][number], { kind: "human" | "object" }>,
  channel: "root_motion" | "contact_hand",
  fps: number,
): { ok: true; value: unknown } | { ok: false; message: string } => {
  const frames = readPoseFrames(subject.motion, channel);
  if (!frames.ok) {
    return frames;
  }
  return {
    ok: true,
    value: {
      entity: "pose",
      channel,
      subjectId: subject.id,
      shotAssetId: subject.assetId,
      uri: subject.uri,
      ...(channel === "root_motion" ? { placement: subject.placement } : {}),
      frames: frames.frames,
      ...(frames.prompt ? { prompt: frames.prompt } : {}),
      fps,
    },
  };
};

/**
 * Project stage subjects, pose, and the selected camera take into dependency
 * outputs. Does not write the shot or the render cache.
 *
 * Asset revision `assetId` is `WorldAsset.id` from `resolveWorldAssetId`.
 * Subject file ids stay inside the pass slice and are not references.
 */
export const projectShotDependencies = (input: {
  shot: Shot;
  worlds: Record<string, WorldAsset>;
  environment?: EnvironmentView;
  modelVersion: string;
  seed: number;
  outputAspect?: string;
  fps?: ShotFpsSource;
  computedAt?: string;
}): ShotDependencyGraph => {
  const shot = input.shot;
  const worldRef = shot.environment?.worldId;
  if (!worldRef) {
    return { ok: false, error: "invalid_shot", message: "룸은 shot.environment.worldId 입니다." };
  }
  const resolved = resolveWorldAssetId(input.worlds, worldRef, defaultContext);
  if (!resolved.ok) {
    return { ok: false, error: "unresolved_asset", message: resolved.message };
  }
  const world = input.worlds[resolved.assetId];
  if (!world) {
    return { ok: false, error: "unresolved_asset", message: `"${resolved.assetId}"는 WorldAsset.id가 아닙니다.` };
  }

  const fps = (input.fps ?? shotRecordFps).fps(shot);
  if (!Number.isFinite(fps) || fps <= 0) {
    return { ok: false, error: "invalid_shot", message: "fps는 Shot.time.fps 에서만 읽습니다." };
  }

  const prepared = prepareModelInput(shot, input.environment, input.outputAspect ?? "16:9");
  if (!prepared.ok) {
    return { ok: false, error: "invalid_shot", message: prepared.blocker.message };
  }
  const model = prepared.input;
  if (!integerKeys(model.camera.keys)) {
    return { ok: false, error: "invalid_shot", message: "카메라 테이크 시간은 정수 프레임이어야 합니다." };
  }

  const assetId = resolved.assetId;
  const revisionId = String(world.version);
  const computedAt = input.computedAt ?? "2026-11-12T00:00:00.000Z";
  const nodes: ShotDependencyNode[] = [];
  const downstreamByNodeId: Record<string, string[]> = {};

  const push = (
    entity: ShotDependencyEntity,
    unitId: string,
    nodeId: string,
    selector: ProductionSelector,
    value: unknown,
    downstreamNodeIds: string[],
    channel?: ShotDependencyNode["channel"],
  ): { ok: true } | { ok: false; message: string } => {
    const fingerprint = dependencyFingerprintSchema.safeParse({
      assetRevision: { assetId, revisionId },
      modelVersion: input.modelVersion,
      seed: input.seed,
      passHash: computePassHash(value),
    });
    if (!fingerprint.success) {
      return { ok: false, message: "의존성 키가 올바르지 않습니다." };
    }
    const parsed = productionOutputSchema.safeParse({
      outputId: `out:${nodeId}`,
      nodeId,
      cacheId: `cache:${nodeId}`,
      selector,
      fingerprint: fingerprint.data,
      constraint: "generative",
      computedAt,
    });
    if (!parsed.success) {
      return { ok: false, message: "의존성 출력을 만들지 못했습니다." };
    }
    nodes.push({
      output: parsed.data,
      entity,
      unitId,
      channel,
      value,
      hash: fingerprint.data.passHash,
      downstreamNodeIds,
    });
    downstreamByNodeId[nodeId] = downstreamNodeIds;
    return { ok: true };
  };

  for (const subject of model.subjects) {
    if (subject.kind === "light") {
      continue;
    }
    if (subject.kind === "human") {
      const rooted = poseNode(subject, "root_motion", fps);
      if (!rooted.ok) {
        return { ok: false, error: "invalid_shot", message: rooted.message };
      }
      const contact = poseNode(subject, "contact_hand", fps);
      if (!contact.ok) {
        return { ok: false, error: "invalid_shot", message: contact.message };
      }
      const contactNodeId = `pose:${subject.id}:contact_hand`;
      const downstreamId = `pose:${subject.id}:contact_hand:downstream`;
      const rootResult = push(
        "pose",
        subject.id,
        `pose:${subject.id}:root_motion`,
        { kind: "actor", actorId: subject.id, motion: "root_motion", assetId },
        rooted.value,
        [],
        "root_motion",
      );
      if (!rootResult.ok) {
        return { ok: false, error: "invalid_shot", message: rootResult.message };
      }
      const contactHash = computePassHash(contact.value);
      const contactResult = push(
        "pose",
        subject.id,
        contactNodeId,
        { kind: "contact", contactId: contactHandId(subject.id), assetId },
        contact.value,
        [downstreamId],
        "contact_hand",
      );
      if (!contactResult.ok) {
        return { ok: false, error: "invalid_shot", message: contactResult.message };
      }
      const downstreamResult = push(
        "pose",
        subject.id,
        downstreamId,
        { kind: "render_pass", renderPassId: contactHandDownstreamId(subject.id), assetId },
        {
          entity: "pose",
          channel: "contact_hand_downstream",
          subjectId: subject.id,
          upstreamPassHash: contactHash,
          fps,
        },
        [],
        "contact_hand_downstream",
      );
      if (!downstreamResult.ok) {
        return { ok: false, error: "invalid_shot", message: downstreamResult.message };
      }
      continue;
    }
    const propResult = push(
      "prop",
      subject.id,
      `prop:${subject.id}`,
      { kind: "object", objectId: subject.id, assetId },
      {
        entity: "prop",
        subjectId: subject.id,
        shotAssetId: subject.assetId,
        uri: subject.uri,
        placement: subject.placement,
        motion: subject.motion,
        fps,
      },
      [],
    );
    if (!propResult.ok) {
      return { ok: false, error: "invalid_shot", message: propResult.message };
    }
  }

  const roomResult = push(
    "room",
    assetId,
    `room:${assetId}`,
    { kind: "set_layout", setLayoutId: assetId, assetId },
    {
      entity: "room",
      fps,
      environment: model.environment ?? { worldId: assetId },
    },
    [],
  );
  if (!roomResult.ok) {
    return { ok: false, error: "invalid_shot", message: roomResult.message };
  }

  const cameraResult = push(
    "camera_take",
    model.camera.takeId,
    `camera:${model.camera.takeId}`,
    { kind: "camera_track", cameraTrackId: model.camera.takeId, assetId },
    {
      entity: "camera_take",
      fps,
      takeId: model.camera.takeId,
      interpolation: model.camera.interpolation,
      lens: model.camera.lens,
      keys: model.camera.keys,
    },
    [],
  );
  if (!cameraResult.ok) {
    return { ok: false, error: "invalid_shot", message: cameraResult.message };
  }

  const bound = bindWorldPhase1Selectors({
    worlds: input.worlds,
    assetRef: worldRef,
    selectors: nodes.map((node) => node.output.selector),
    ctx: defaultContext,
  });
  if (!bound.ok) {
    const message = bound.issues[0]?.message ?? "WorldAsset.id로 묶지 못했습니다.";
    return { ok: false, error: bound.error === "unresolved_asset" ? "unresolved_asset" : "invalid_shot", message };
  }
  if (bound.bindings.some((binding) => binding.assetId !== assetId)) {
    return { ok: false, error: "unresolved_asset", message: "참조는 WorldAsset.id 만 허용됩니다." };
  }

  const outputs = nodes.map((node) => node.output);
  const caches = Object.fromEntries(
    nodes.map((node) => [node.output.cacheId, cacheEntry({ cacheId: node.output.cacheId, nodeId: node.output.nodeId, hash: node.hash }, shot.id)]),
  );
  return { ok: true, fps, assetId, revisionId, nodes, outputs, downstreamByNodeId, caches };
};
