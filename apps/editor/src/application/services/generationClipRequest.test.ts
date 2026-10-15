import { describe, it, expect } from "vitest";
import type { Project } from "../../domain/project/types";
import { createNodeBase } from "./nodeFactory";
import type { TimelineClip } from "../../domain/timeline/types";
import { createEmptyClipDraft } from "../../domain/generation/clipDraft";
import { getModelProfile, validateDraftAgainstProfile } from "../../domain/rendering/modelProfile";
import { CameraMovementDescriber } from "../../domain/rendering/cameraMovement";
import { buildGenerationRequestFromDraft } from "./generationClipRequest";
import type { NodeBase } from "../../domain/graph/types";
import { prepareGenerationHandoff } from "./generationHandoff";
import { applyCommand } from "../commands/apply";
import type { ApplyCommandContext } from "../commands/apply";
import type { DomainCommand } from "../commands/types";
import { MODEL_PROFILES } from "../../domain/rendering/modelProfile";

const now = "2026-01-01T00:00:00.000Z";

const projectFixture = (): { project: Project; clip: TimelineClip } => {
  const clip: TimelineClip = {
    id: "clip-001",
    name: "Clip 01",
    start: 0,
    end: 96,
    duration: 96,
    startFrame: 0,
    durationFrames: 96,
    sourceType: "empty",
    clipGraphId: "g-1",
    cameraPathNodeId: "camera",
    performancePlanNodeId: "performance",
    cacheStatus: "valid",
  };
  const lensId = `node-${clip.id}-lens`;
  const nodes: Record<string, NodeBase> = {
    camera: createNodeBase({
      id: "camera",
      name: "Camera",
      kind: "CameraPathNode",
      category: "capture",
      parameters: {
        keyframes: [
          { frame: 0, position: [0, 1.5, 3], rotation: [0, 0, 0, 1], focalLengthMm: 36 },
          { frame: 48, position: [0, 2.5, 3], rotation: [0, 0, 0, 1], focalLengthMm: 36 },
        ],
        interpolation: "linear",
        frameCount: 96,
      },
      timestamp: now,
      downstreamNodeIds: [],
    }),
    [lensId]: createNodeBase({
      id: lensId,
      name: "Lens",
      kind: "LensNode",
      category: "capture",
      parameters: { focalLengthMm: 36, sensorPreset: "full-frame" },
      timestamp: now,
    }),
    performance: createNodeBase({
      id: "performance",
      name: "Performance Plan",
      kind: "PerformancePlanNode",
      category: "performance",
      parameters: { sources: [], cues: [], audioGuide: {} },
      timestamp: now,
    }),
  };
  const project: Project = {
    id: "p1",
    name: "Test",
    createdAt: now,
    updatedAt: now,
    metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq-1",
    sequences: { "seq-1": { id: "seq-1", name: "Main", clipIds: [clip.id], playhead: 0, visibleRange: [0, 200] } },
    clips: { [clip.id]: clip },
    clipGraphs: { "g-1": { id: "g-1", clipId: clip.id, rootNodeId: "performance", nodeIds: ["performance", "camera", lensId], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] } },
    nodes,
    references: {},
    dependencyMap: {
      downstreamByNodeId: { performance: [], camera: [] },
      clipsByNodeId: { performance: [clip.id], camera: [clip.id] },
      referencesByNodeId: {},
      cacheHashesByClipId: { [clip.id]: "h1" },
    },
    worlds: {},
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
    clipDrafts: {},
  };
  return { project, clip };
};

describe("Model profile validation", () => {
  it("enforces reference limits and resolution constraints", () => {
    const profile = getModelProfile("lyra-2.0");
    const result = validateDraftAgainstProfile({
      model: profile,
      width: 1280,
      height: 720,
      fps: 24,
      durationSeconds: 12, // too long
      outputCount: 5, // too many
      references: new Array(9).fill(0).map((_, i) => ({ kind: "image" as const })), // 9 images > perKind 8
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === "durationSeconds")).toBe(true);
    expect(result.issues.some((i) => i.field === "outputCount")).toBe(true);
    expect(result.issues.some((i) => i.field === "references.image")).toBe(true);
  });
});

describe("Camera movement description", () => {
  it("describes crane up for vertical moves", () => {
    const { project, clip } = projectFixture();
    const params = (project.nodes["camera"].parameters as any);
    expect(CameraMovementDescriber.describe(params)).toMatch(/crane up/i);
  });
});

describe("ClipDraft to GenerationRequest", () => {
  it("builds a request with Backbone v0.1 camera and pose conditions", () => {
    const { project, clip } = projectFixture();
    const draft = createEmptyClipDraft(clip, { prompt: "Walk forward", durationSeconds: 4, fps: 16, width: 1280, height: 720 });

    // Create a minimal SMPL-X pose node so exportBackboneSmplxForClip succeeds
    const poseNode = createNodeBase({
      id: "pose",
      name: "Actor Pose",
      kind: "ActorPoseNode",
      category: "performance",
      parameters: {
        actorElementId: "actor-a",
        interpolation: "slerp",
        keyframes: [
          { frame: 0, pose: { global_orient: [0, 0, 0], transl: [0, 0, 0], body_pose: Array(63).fill(0), left_hand_pose: Array(45).fill(0), right_hand_pose: Array(45).fill(0), jaw_pose: [0,0,0], expression: Array(10).fill(0) } },
          { frame: 48, pose: { global_orient: [0, 0, 0], transl: [0, 0, 0], body_pose: Array(63).fill(0), left_hand_pose: Array(45).fill(0), right_hand_pose: Array(45).fill(0), jaw_pose: [0,0,0], expression: Array(10).fill(0) } },
        ],
      },
      timestamp: now,
    });
    const projectWithPose: Project = { ...project, nodes: { ...project.nodes, pose: poseNode }, dependencyMap: {
      downstreamByNodeId: { performance: [], camera: [], pose: [] },
      clipsByNodeId: { performance: [clip.id], camera: [clip.id], pose: [clip.id] },
      referencesByNodeId: {},
      cacheHashesByClipId: { [clip.id]: "h1" },
    }};

    const { request, validation } = buildGenerationRequestFromDraft({
      project: projectWithPose,
      clip,
      nodes: projectWithPose.nodes,
      draft,
    });
    expect(request.task).toBe("world_to_video");
    const camera = request.conditions.find((c) => c.type === "camera");
    expect(camera?.payload?.format).toBe("backbone_v0.1");
    const pose = request.conditions.find((c) => c.type === "pose");
    expect(pose?.payload?.format).toBe("backbone_v0.1");
    expect(validation.ok).toBe(true);
  });
});

describe("Image anchors: reference mode by default, hard only on toggle", () => {
  it("excludes images from hard conditions by default and sends soft guidance; toggling to hard moves to conditions", () => {
    const { project, clip } = projectFixture();
    let draft = createEmptyClipDraft(clip, { durationSeconds: 4, fps: 16, width: 1280, height: 720 });
    draft = { ...draft, references: [...(draft.references ?? []), { id: "img-1", kind: "image", assetId: "asset-img-1" }] };
    const { request, validation } = buildGenerationRequestFromDraft({ project, clip, nodes: project.nodes, draft });
    expect(validation.ok).toBe(true);
    // No hard image conditions by default
    expect(request.conditions.some((c) => c.type === "image")).toBe(false);
    // Soft guidance present
    expect((request.backendOptions as any).softGuidanceImages?.length).toBe(1);
    expect((request.backendOptions as any).softGuidanceImages[0].assetId).toBe("asset-img-1");

    // Toggle to hard via DomainCommand (undoable)
    const ctx: ApplyCommandContext = { timestamp: now };
    const created = applyCommand({ ...project, clipDrafts: { [clip.id]: draft } } as Project, { type: "SET_DRAFT_IMAGE_MODE", clipId: clip.id, referenceId: "img-1", mode: "hard" } as DomainCommand, ctx);
    const hardened = created.project.clipDrafts![clip.id]!;
    const { request: req2, validation: val2 } = buildGenerationRequestFromDraft({ project, clip, nodes: project.nodes, draft: hardened });
    expect(val2.ok).toBe(true);
    expect(req2.conditions.some((c) => c.type === "image" && c.assetId === "asset-img-1")).toBe(true);
    expect(((req2.backendOptions as any).softGuidanceImages ?? []).length).toBe(0);

    // Undo toggle
    const inverse = created.result.inverse!;
    const undone = applyCommand(created.project, inverse as DomainCommand, ctx);
    const reverted = undone.project.clipDrafts![clip.id]!;
    const { request: req3 } = buildGenerationRequestFromDraft({ project, clip, nodes: project.nodes, draft: reverted });
    expect(req3.conditions.some((c) => c.type === "image")).toBe(false);
    expect((req3.backendOptions as any).softGuidanceImages?.length).toBe(1);
  });
});

describe("Model capability for image guidance/conditioning", () => {
  it("warns and drops soft guidance when unsupported; errors on hard when unsupported", () => {
    // Register a test-only profile without soft guidance and hard conditioning
    (MODEL_PROFILES as any)["no-soft"] = {
      id: "no-soft",
      label: "NoSoft",
      allowedResolutions: [{ width: 1280, height: 720, fps: [16, 24] }],
      maxDurationSeconds: 10,
      maxOutputCount: 4,
      referenceLimits: { total: 10, perKind: { image: 5 } },
      supportsSoftImageGuidance: false,
      supportsHardImageConditioning: true,
    };
    (MODEL_PROFILES as any)["no-hard"] = {
      id: "no-hard",
      label: "NoHard",
      allowedResolutions: [{ width: 1280, height: 720, fps: [16, 24] }],
      maxDurationSeconds: 10,
      maxOutputCount: 4,
      referenceLimits: { total: 10, perKind: { image: 5 } },
      supportsSoftImageGuidance: true,
      supportsHardImageConditioning: false,
    };

    const { project, clip } = projectFixture();
    // Soft guidance unsupported
    let draft = createEmptyClipDraft(clip, { durationSeconds: 4, fps: 16, width: 1280, height: 720, modelId: "no-soft" });
    draft = { ...draft, references: [{ id: "img-1", kind: "image", assetId: "asset-img-1" }] };
    const { request, validation } = buildGenerationRequestFromDraft({ project, clip, nodes: project.nodes, draft });
    expect(validation.ok).toBe(true);
    expect(validation.warnings.some((w) => /does not support soft image guidance/i.test(w))).toBe(true);
    expect(((request.backendOptions as any).softGuidanceImages ?? []).length).toBe(0);

    // Hard conditioning unsupported
    let draft2 = createEmptyClipDraft(clip, { durationSeconds: 4, fps: 16, width: 1280, height: 720, modelId: "no-hard" });
    draft2 = { ...draft2, references: [{ id: "img-2", kind: "image", assetId: "asset-img-2", imageMode: "hard" }] };
    const { validation: v2 } = buildGenerationRequestFromDraft({ project, clip, nodes: project.nodes, draft: draft2 });
    expect(v2.ok).toBe(false);
    expect(v2.issues.some((i) => /does not support hard image conditioning/i.test(i.message))).toBe(true);
  });
});

describe("Generation handoff DTO", () => {
  it("includes clipId, depHash, and final:clipId:depHash cacheKey; returns failure when invalid", () => {
    const { project, clip } = projectFixture();
    const valid = createEmptyClipDraft(clip, { durationSeconds: 4, fps: 16, width: 1280, height: 720, prompt: "" });
    const ok = prepareGenerationHandoff({ project, clip, nodes: project.nodes, draft: valid });
    if (!ok.ok) throw new Error("expected ok handoff");
    expect(ok.dto.clipId).toBe(clip.id);
    expect(ok.dto.depHash).toBe("h1");
    expect(ok.dto.cacheKey).toBe(`final:${clip.id}:h1`);

    const invalid = createEmptyClipDraft(clip, { durationSeconds: 999, fps: 120, width: 1024, height: 1024 });
    const fail = prepareGenerationHandoff({ project, clip, nodes: project.nodes, draft: invalid });
    expect(fail.ok).toBe(false);
    if (fail.ok) return;
    expect(fail.failure.code).toBe("VALIDATION_ERROR");
    expect(fail.failure.clipId).toBe(clip.id);
    expect(fail.failure.cacheKey).toBe(`final:${clip.id}:h1`);
    expect(fail.failure.retryable).toBe(false);
  });
});

describe("Draft and plan separation", () => {
  it("does not mutate camera path or lens when editing draft", () => {
    const { project, clip } = projectFixture();
    const draft = createEmptyClipDraft(clip);
    const beforeCamera = JSON.stringify(project.nodes["camera"].parameters);
    const lensId = `node-${clip.id}-lens`;
    const beforeLens = JSON.stringify((project.nodes[lensId] as any).parameters);
    // Local edit to draft
    draft.width = 1920;
    draft.height = 1080;
    draft.prompt = "Run and jump";
    // Ensure nodes unchanged
    expect(JSON.stringify(project.nodes["camera"].parameters)).toBe(beforeCamera);
    expect(JSON.stringify((project.nodes[lensId] as any).parameters)).toBe(beforeLens);
  });
});

