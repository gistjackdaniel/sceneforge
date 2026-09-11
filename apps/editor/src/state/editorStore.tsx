import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  attemptConnectNodes,
  attemptDeleteNode,
  loadAndMigrateProject,
  migrateLoadedProject,
  resolveNodesToRemoveWithClip,
  linkWorldToClip,
} from "../application/services";
import { serializeProject, writeAtomicLocalStorage } from "../infrastructure/persistence";
import { invalidateCachesForNodeChange } from "../core/cache/invalidation";
import type { RenderCacheEntry } from "../core/cache/types";
import type { LyraJobState, LyraVideoRenderJobState } from "../core/lyra/types";
import { lyraAdapter } from "../core/lyra/cloudAdapter";
import { buildVideoRenderInput } from "../core/lyra/videoRenderInput";
import {
  defaultPorts,
  edgeSourceId,
  edgeTargetId,
  type GraphEdge,
  type NodeBase,
  type NodeCategory,
  type NodeKind,
} from "../core/nodes/types";
import { syncClipCacheFields } from "../core/project/clipCacheStatus";
import type {
  ExternalConnector,
  PerformanceMetrics,
  Project,
  Sequence,
  TimelineClip,
} from "../core/project/types";
import type { NodeReference, ReferenceType } from "../core/references/types";
import { buildDependencyMap } from "../core/clipgraph/dependency";
import { buildImpactSentence, collectReferencedNodeIds, getAffectedClips } from "../core/dependency";
import {
  createEmptyRenderQueue,
  enqueueAffectedClips,
  markQueueItem,
  type RenderQueueKind,
} from "../core/render/queue";
import { createStageRenderPassStub } from "../core/render/stageRenderPass";
import { runGenerativeRefinementStub } from "../core/render/refinementStub";
import type { WorldAsset, WorldMode } from "../core/world/types";
import { assetFromWorld } from "../domain/assets";
import { sampleViewportWorlds } from "../domain/worlds";
import { applyDirtyEventToNodes } from "../domain/graph/dependencyService";
import { collectAllEdges, markDirty } from "../domain/graph/dirty";
import { computeNodeContentHash } from "../domain/graph/cacheKey";
import {
  cameraPathParamsFromNode,
  deleteCameraKeyframe,
  interpolateCameraPose,
  isFrameInsideClip,
  keyframeAtExactFrame,
  trimKeyframesToDuration,
  upsertCameraKeyframe,
} from "../domain/graph/cameraPath";
import { clipDurationFrames, clipStartFrame, withClipTiming } from "../domain/timeline/timing";
import { normalizeLegacyRig, type CameraRigPreset } from "../domain/graph/cameraRig";
import { defaultLensParams, lensNodeIdForClip, lensParamsFromNode } from "../domain/graph/lens";
import { validateLookAtElement } from "../application/services/cameraCraft";
import { createClipVariant, ensureClipVariants, setActiveVariant } from "../domain/timeline/variants";
import { validateClipTemporalNodes } from "../domain/timeline/temporalValidation";
import {
  emptyCommandBusState,
  executeCommand,
  redoCommand,
  undoCommand,
  type CommandBusState,
  type DomainCommand,
} from "../application/commands";
import {
  persistWorldGeneration,
  registerSourceImageAsset,
} from "../application/services/worldGeneration";
import { parseWorldGenerationArtifacts } from "../application/services/worldGenerationRequest";
import {
  buildCameraKeyframePatch,
  buildPlacementParams,
  cameraPathNodeIdForClip as cameraPathNodeIdFromClip,
  eulerToQuaternionApprox,
  quaternionToEulerApprox,
  nodeKindForObject,
  placementNodeIdForElement,
  type ViewportObjectKind,
} from "../application/services/viewportCommit";
import { createNodeBase } from "../application/services/nodeFactory";
import { WorkspaceFocus } from "../application/services/workspaceFocus";
import type { OverlayKind } from "../domain/worlds/viewportRepresentation";
import {
  DEFAULT_OUTPUT_ASPECT,
  parseOutputAspectPreset,
  type OutputAspectPreset,
} from "../domain/rendering";
import { parseViewportWorkspace, type ViewportWorkspace } from "./viewportWorkspace";
import {
  cancelRenderJob,
  createEmptyJobQueue,
  type RenderJobQueue,
} from "../domain/rendering/jobQueue";
import {
  createPerformancePlanNode,
  diffPerformancePlanDirectionInvalidations,
  performancePlanFromNode,
  performancePlanNodeIdForClip,
  validatePerformancePlan,
  type PerformancePlanParams,
} from "../domain/performance";
import type { DirectionChannelInvalidation } from "../domain/direction";
import { evaluateShotWorkflow } from "../domain/workflow";

const STORAGE_KEY = "sceneforge-editor-state-v3";

/** User-facing left panel tabs. Graph/Library/Inspector are backend-only structures. */
export type PanelTab = "viewport" | "world-generation" | "direction";

/** Main content area (center pane) selection. */
export type MainPanel = "playback" | "graph";

const normalizePanelTab = (value: unknown): PanelTab =>
  value === "world-generation" || value === "direction" ? value : "viewport";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
}

export interface EditorUiState {
  selectedClipId: string;
  selectedNodeId: string;
  selectedLibraryNodeId?: string;
  panelTab: PanelTab;
  /** Which main (center) panel is visible — playback or graph */
  mainPanel: MainPanel;
  playback: "stopped" | "playing";
  workflowLog: string[];
  assistantMessages: AssistantMessage[];
  highlightedNodeIds: string[];
  lyraJob?: LyraJobState;
  videoRenderJob?: LyraVideoRenderJobState;
  worldGenDraft: {
    imageName: string;
    imageAssetId: string;
    imageThumbnailUri: string;
    prompt: string;
    trajectoryLabel: string;
    seed: string;
  };
  worldGenJob?: WorldGenJobView;
  previewWorldId?: string;
  viewportTool: ViewportTool;
  viewportWorkspace: ViewportWorkspace;
  outputAspect: OutputAspectPreset;
  viewportOverlays: Record<OverlayKind, boolean>;
  cameraViz: CameraVizState;
  pendingRerender?: {
    nodeId: string;
    affectedClipIds: string[];
    impactSentence: string;
  };
  renderQueue: ReturnType<typeof createEmptyRenderQueue>;
  commandBus: CommandBusState;
  showWorldOverlay: boolean;
  domainJobQueue: RenderJobQueue;
}

export type ViewportTool = "navigate" | "select" | "translate" | "rotate" | "scale" | "camera";
export type { ViewportWorkspace } from "./viewportWorkspace";

export interface CameraVizState {
  frustum: boolean;
  path: boolean;
  lookAtLine: boolean;
  keyframeMarkers: boolean;
}

const defaultCameraViz = (): CameraVizState => ({
  frustum: true,
  path: true,
  lookAtLine: true,
  keyframeMarkers: true,
});

export type WorldGenJobStatus =
  | "idle"
  | "validating"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorldGenJobView {
  requestId: string;
  status: WorldGenJobStatus;
  progress: number;
  message: string;
  error?: string;
  worldId?: string;
  executionId?: string;
}

const defaultViewportOverlays = (): Record<OverlayKind, boolean> => ({
  actorMarks: true,
  cameraAnchors: true,
  lightSockets: true,
  propSockets: true,
  walkableZones: true,
});

export interface EditorState {
  project: Project;
  ui: EditorUiState;
}

type EditorAction =
  | { type: "add-empty-clip" }
  | { type: "delete-clip"; clipId: string }
  | { type: "delete-node"; nodeId: string }
  | { type: "connect-nodes"; clipId: string; sourceNodeId: string; targetNodeId: string; label?: string }
  | { type: "select-clip"; clipId: string }
  | { type: "select-node"; nodeId: string }
  | { type: "set-panel-tab"; tab: PanelTab }
  | { type: "set-main-panel"; panel: MainPanel }
  | { type: "scrub-playhead"; playhead: number }
  | { type: "trim-clip"; clipId: string; duration: number }
  | { type: "set-world"; clipId: string; worldId: string; worldMode: WorldMode }
  | { type: "apply-shot-preset"; clipId: string; preset: "WS" | "MS" | "CU" | "OTS" }
  | { type: "set-camera-rig"; clipId: string; rig: CameraRigPreset | "dolly" | "handheld" | "crane" | "orbit" | "shoulder" }
  | { type: "set-lighting-rig"; clipId: string; rig: "3-point" | "sunset" | "neon" | "interior practical" }
  | { type: "capture-keyframe"; clipId: string; pose?: {
      camera: {
        position: [number, number, number];
        rotation: [number, number, number];
        focalLength: number;
      };
      objects: Array<{
        id: string;
        kind: "actor" | "prop" | "light";
        position: [number, number, number];
        rotation: [number, number, number];
      }>;
    } }
  | { type: "update-node-parameter"; nodeId: string; key: string; value: unknown }
  | { type: "set-performance-plan"; clipId: string; plan: PerformancePlanParams }
  | { type: "set-reference-type"; referenceId: string; referenceType: ReferenceType }
  | { type: "add-library-reference"; clipId: string; libraryNodeId: string; referenceType: ReferenceType }
  | { type: "break-link"; referenceId: string }
  | { type: "make-node-local"; nodeId: string }
  | { type: "set-node-reference-type"; nodeId: string; referenceType: ReferenceType }
  | { type: "override-reference-value"; referenceId: string; patch: Record<string, unknown> }
  | { type: "reveal-references"; nodeId: string }
  | { type: "render-proxy"; clipId: string }
  | { type: "render-final"; clipId: string }
  | { type: "toggle-playback" }
  | { type: "run-connector"; connectorId: string; clipId: string }
  | { type: "set-lyra-job"; job?: LyraJobState }
  | {
      type: "set-world-gen-draft";
      draft: Partial<EditorUiState["worldGenDraft"]>;
    }
  | { type: "set-world-gen-job"; job?: WorldGenJobView }
  | {
      type: "register-source-image";
      input: { id: string; name: string; uri: string; thumbnailUri?: string };
    }
  | { type: "clear-source-image" }
  | { type: "preview-world"; worldId?: string }
  | { type: "complete-world-generation"; job: LyraJobState; imageAssetId: string }
  | { type: "set-viewport-tool"; tool: ViewportTool }
  | { type: "set-viewport-workspace"; workspace: ViewportWorkspace }
  | { type: "set-output-aspect"; aspect: OutputAspectPreset }
  | { type: "set-viewport-overlays"; overlays: Partial<Record<OverlayKind, boolean>> }
  | { type: "set-camera-viz"; viz: Partial<CameraVizState> }
  | {
      type: "update-lens";
      clipId: string;
      patch: Partial<{ focalLengthMm: number; focusDistanceM: number; aperture: number; sensorPreset: "full-frame" | "super35" | "micro-four-thirds" }>;
    }
  | { type: "set-look-at"; clipId: string; elementId?: string; trackingStrength?: number }
  | { type: "delete-camera-keyframe"; clipId: string; frame: number }
  | { type: "trim-camera-keyframes"; clipId: string }
  | {
      type: "commit-object-transform";
      clipId: string;
      worldElementId: string;
      kind: ViewportObjectKind;
      position: [number, number, number];
      rotation: [number, number, number];
      scale?: [number, number, number];
    }
  | { type: "run-stage-pass"; clipId: string }
  | { type: "set-actor-placement"; clipId: string; mark: string; position?: [number, number, number]; rotation?: [number, number, number] }
  | { type: "set-prop-placement"; clipId: string; prop: string; position?: [number, number, number]; rotation?: [number, number, number] }
  | { type: "set-light-transform"; clipId: string; lightId: string; position: [number, number, number]; rotation: [number, number, number] }
  | { type: "submit-video-render"; clipId: string }
  | { type: "set-video-render-job"; job?: LyraVideoRenderJobState }
  | { type: "complete-video-render"; clipId: string; job: LyraVideoRenderJobState }
  | { type: "assistant-message"; message: string }
  | { type: "approve-partial-rerender" }
  | { type: "dismiss-partial-rerender" }
  | { type: "retry-failed-render"; clipId: string; kind: RenderQueueKind }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "create-variant"; clipId: string; name?: string }
  | { type: "set-active-variant"; clipId: string; variantId: string }
  | { type: "toggle-world-overlay" }
  | { type: "add-camera-keyframe"; clipId: string; frame: number; position: [number, number, number]; rotation: [number, number, number, number]; focalLengthMm: number; focusDistanceM?: number; aperture?: number }
  | { type: "cancel-domain-job"; jobId: string }
  | { type: "trim-clip-frames"; clipId: string; durationFrames: number }
  | { type: "load"; state: EditorState };

interface EditorContextValue {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

const EditorContext = createContext<EditorContextValue | null>(null);

const now = () => new Date().toISOString();

const makeId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

const createMetrics = (): PerformanceMetrics => ({
  editLatencyMs: 38,
  regenerationCount: 0,
  nodeReuseRate: 0.64,
  cacheHitRate: 0.71,
});

const createLibraryNodes = (): NodeBase[] => [
  createNode(
    "lib-lens-50mm",
    "Standard 50mm Lens",
    "LensNode",
    "library",
    { focalLength: 50, sensorPreset: "full-frame", dof: "medium" },
    "shared",
    "project",
  ),
  createNode(
    "lib-light-sunset",
    "Sunset Lighting Rig",
    "LightingRigNode",
    "library",
    { preset: "sunset", intensity: 0.76, direction: "window" },
    "shared",
    "project",
  ),
  createNode(
    "lib-look-cool",
    "Cool Interior Look",
    "ColorGradeNode",
    "library",
    { temperature: -8, contrast: 0.16, saturation: 0.9 },
    "shared",
    "project",
  ),
];

const createNode = (
  id: string,
  name: string,
  kind: NodeKind,
  category: NodeCategory,
  parameters: Record<string, unknown>,
  referenceType: ReferenceType = "local",
  scope: NodeBase["scope"] = "clip",
): NodeBase => {
  const ports = defaultPorts();
  const timestamp = now();
  return {
    id,
    name,
    kind,
    type: kind,
    category,
    scope,
    enabled: true,
    tags: [],
    version: 1,
    referenceType,
    parameters,
    params: parameters,
    downstreamNodeIds: [],
    status: "clean",
    inputPorts: ports.inputPorts,
    outputPorts: ports.outputPorts,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const cameraPathNodeIdForClip = (clipId: string) => `node-${clipId}-trajectory`;

const createClipNodes = (clipId: string, worldId?: string): NodeBase[] => [
  createNode(
    `node-${clipId}-clip`,
    "Timeline Clip Root",
    "TimelineClipNode",
    "capture",
    { clipId, linkedWorldId: worldId, worldMode: worldId ? "referenced" : undefined },
  ),
  createNode(
    cameraPathNodeIdForClip(clipId),
    "Camera Path",
    "CameraPathNode",
    "cinematic",
    { path: "default", frameCount: 120, interpolation: "linear", keyframes: [] },
  ),
  createNode(`node-${clipId}-source`, "Source Stub", "ImageSourceNode", "source", {
    sourceType: "empty",
    label: "Empty clip stub",
  }),
  createNode(`node-${clipId}-render`, "Render Stub", "RenderSettingsNode", "render", {
    quality: "proxy",
    renderer: "SceneForge Preview",
  }),
  createNode(`node-${clipId}-overlay`, "World Overlay", "WorldElementRefNode", "scene", {
    visible: true,
    elementKinds: ["actor_mark", "camera_anchor", "light_socket"],
  }),
  createPerformancePlanNode(clipId, now()),
];

const makeEdge = (
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  label: string,
): GraphEdge => ({
  id,
  sourceNodeId,
  sourcePort: "out",
  targetNodeId,
  targetPort: "in",
  kind: "data",
  label,
});

const createClipEdges = (clipId: string): GraphEdge[] => [
  makeEdge(
    `edge-${clipId}-source-to-render`,
    `node-${clipId}-source`,
    `node-${clipId}-render`,
    "feeds",
  ),
  makeEdge(
    `edge-${clipId}-trajectory-to-render`,
    cameraPathNodeIdForClip(clipId),
    `node-${clipId}-render`,
    "path",
  ),
  makeEdge(
    `edge-${clipId}-clip-to-render`,
    `node-${clipId}-clip`,
    `node-${clipId}-render`,
    "contains",
  ),
  {
    ...makeEdge(
      `edge-${clipId}-performance-to-render`,
      performancePlanNodeIdForClip(clipId),
      `node-${clipId}-render`,
      "performance direction",
    ),
    sourcePort: "direction",
  },
];

const createCacheEntry = (
  label: string,
  kind: RenderCacheEntry["kind"],
  clipId: string,
  previewText: string,
): RenderCacheEntry => ({
  id: makeId(`cache-${kind}`),
  clipId,
  label,
  kind,
  status: "valid",
  updatedAt: now(),
  invalidatedByNodeIds: [],
  previewText,
});

const createInitialProject = (): Project => {
  const sampleWorlds = sampleViewportWorlds();
  const world = sampleWorlds[0];
  const libraryNodes = createLibraryNodes();
  const clipId = "clip-001";
  const graphId = "graph-001";
  const clipNodes = createClipNodes(clipId, world.id);
  const allNodes = [...libraryNodes, ...clipNodes];
  const nodeMap = Object.fromEntries(allNodes.map((node) => [node.id, node]));
  const clip: TimelineClip = {
    id: clipId,
    name: "Empty Clip 01",
    trackId: "V1",
    start: 0,
    end: 120,
    duration: 120,
    startFrame: 0,
    durationFrames: 120,
    sourceInFrame: 0,
    playbackRate: 1,
    sourceType: "empty",
    linkedWorldId: world.id,
    clipGraphId: graphId,
    cameraPathNodeId: cameraPathNodeIdForClip(clipId),
    performancePlanNodeId: performancePlanNodeIdForClip(clipId),
    cameraTrajectoryNodeId: cameraPathNodeIdForClip(clipId),
    graphSnapshotId: graphId,
    cacheStatus: "invalid",
    worldMode: "referenced",
    variant: "main",
    activeVariantId: "main",
    variants: [{ id: "main", name: "Main", overridePatch: {} }],
  };
  const sequence: Sequence = {
    id: "sequence-001",
    name: "Main Sequence",
    clipIds: [clipId],
    playhead: 0,
    visibleRange: [0, 300],
  };
  const graph = {
    id: graphId,
    clipId,
    rootNodeId: `node-${clipId}-clip`,
    nodeIds: clipNodes.map((node) => node.id),
    edges: createClipEdges(clipId),
    previewFrames: ["Stage idle", "Proxy pending"],
    finalFrames: [],
    keyframeNodeIds: [],
  };
  const proxyCache = createCacheEntry(
    "Initial proxy preview",
    "proxy",
    clipId,
    "Source Stub -> Render Stub",
  );
  clip.proxyCacheId = proxyCache.id;
  clip.renderCacheNodeId = proxyCache.id;
  clip.cacheStatus = "valid";

  const connector: ExternalConnector = {
    id: "connector-preview-model",
    name: "Preview Model Connector",
    description: "외부 모델 커넥터 스텁. 프록시 결과를 생성 워크플로우 예제로 표시한다.",
    outputKinds: ["proxy", "look"],
  };

  const references: Record<string, NodeReference> = {
    "ref-world-root": {
      id: "ref-world-root",
      sourceNodeId: `node-${clipId}-clip`,
      targetNodeId: "lib-look-cool",
      scope: "project",
      referenceType: "instance",
      overridePatch: { clipId },
    },
  };

  const seeded = sampleWorlds.map((item) => {
    const asset = assetFromWorld(item);
    return {
      world: {
        ...item,
        sourceAssetIds: item.sourceAssetIds.includes(asset.id) ? item.sourceAssetIds : [...item.sourceAssetIds, asset.id],
      },
      asset,
    };
  });
  const worlds = Object.fromEntries(seeded.map((item) => [item.world.id, item.world]));
  const worldAssets = Object.fromEntries(seeded.map((item) => [item.asset.id, item.asset]));

  const project: Project = {
    id: "project-sceneforge-editor",
    name: "SceneForge MVP",
    createdAt: now(),
    updatedAt: now(),
    metrics: createMetrics(),
    activeSequenceId: sequence.id,
    sequences: { [sequence.id]: sequence },
    clips: { [clip.id]: clip },
    clipGraphs: { [graph.id]: graph },
    nodes: nodeMap,
    references,
    dependencyMap: {
      downstreamByNodeId: {},
      clipsByNodeId: {},
      referencesByNodeId: {},
      cacheHashesByClipId: {},
    },
    worlds,
    assets: worldAssets,
    caches: { [proxyCache.id]: proxyCache },
    connectors: { [connector.id]: connector },
    libraryNodeIds: libraryNodes.map((node) => node.id),
  };

  project.dependencyMap = buildDependencyMap(project.nodes, project.clips, project.references, project.clipGraphs);
  return project;
};

const createInitialState = (): EditorState => {
  const project = createInitialProject();
  return {
    project,
    ui: {
      selectedClipId: "clip-001",
      selectedNodeId: "node-clip-001-clip",
      mainPanel: "playback",
      panelTab: "viewport",
      playback: "stopped",
      workflowLog: [
        "Timeline-first editor shell initialized.",
        "Color-block mesh / splat / point-cloud sample worlds loaded.",
      ],
      assistantMessages: [],
      highlightedNodeIds: [],
      worldGenDraft: {
        imageName: "",
        imageAssetId: "",
        imageThumbnailUri: "",
        prompt: "",
        trajectoryLabel: "generation-explore",
        seed: "",
      },
      viewportTool: "navigate",
      viewportWorkspace: "build",
      outputAspect: DEFAULT_OUTPUT_ASPECT,
      viewportOverlays: defaultViewportOverlays(),
      cameraViz: defaultCameraViz(),
      renderQueue: createEmptyRenderQueue(),
      commandBus: emptyCommandBusState(),
      showWorldOverlay: true,
      domainJobQueue: createEmptyJobQueue(),
    },
  };
};

const cloneNode = (node: NodeBase, overrides?: Record<string, unknown>): NodeBase => ({
  ...node,
  id: makeId("node-clone"),
  scope: "clip",
  referenceType: "local",
  version: 1,
  createdAt: now(),
  updatedAt: now(),
  parameters: { ...node.parameters, ...overrides },
  downstreamNodeIds: [...node.downstreamNodeIds],
});

const invalidateCachesForNode = (
  project: Project,
  nodeId: string,
  directionInvalidations?: DirectionChannelInvalidation[],
): Project => {
  const node = project.nodes[nodeId];
  if (!node) {
    return project;
  }
  const timestamp = now();
  const edges = collectAllEdges(project.clipGraphs);
  const dirty = markDirty(
    { sourceNodeId: nodeId, reason: "params_changed", timestamp },
    project.nodes,
    project.dependencyMap,
    edges,
  );
  const { nodes } = applyDirtyEventToNodes(
    {
      nodes: project.nodes,
      references: project.references,
      clipGraphs: project.clipGraphs,
      dependencyMap: project.dependencyMap,
    },
    { sourceNodeId: nodeId, reason: "params_changed", timestamp },
  );
  const hashed = Object.fromEntries(
    Object.entries(nodes).map(([id, item]) => [
      id,
      dirty.dirtyNodeIds.includes(id)
        ? { ...item, contentHash: computeNodeContentHash(item) }
        : item,
    ]),
  );
  const caches = invalidateCachesForNodeChange(
    project.caches,
    project.dependencyMap,
    node,
    timestamp,
    directionInvalidations,
  );
  const clips = Object.fromEntries(
    Object.entries(project.clips).map(([id, clip]) => [
      id,
      syncClipCacheFields(clip, caches),
    ]),
  );
  return {
    ...project,
    nodes: hashed,
    caches,
    clips,
    metrics: {
      ...project.metrics,
      regenerationCount: project.metrics.regenerationCount + 1,
    },
  };
};

const runDomainCommand = (
  state: EditorState,
  command: DomainCommand,
  logMessage?: string | false,
  directionInvalidations?: DirectionChannelInvalidation[],
): EditorState => {
  const executed = executeCommand(state.project, state.ui.commandBus, command, now());
  if (!executed.result.ok) {
    return {
      ...state,
      ui: appendWorkflowLog(state.ui, executed.result.reason ?? "Command failed."),
    };
  }
  let project = updateProjectMetadata(executed.project);
  let sourceNodeId =
    "nodeId" in command && typeof command.nodeId === "string"
      ? command.nodeId
      : command.type === "OVERRIDE_VALUE"
        ? project.references[command.referenceId]?.sourceNodeId
        : undefined;
  if (!sourceNodeId) {
    const marked = executed.result.events.find((item) => item.type === "NodeMarkedDirty");
    if (typeof marked?.payload.nodeId === "string") {
      sourceNodeId = marked.payload.nodeId;
    }
  }
  if (sourceNodeId && executed.result.events.some((item) => item.type === "NodeMarkedDirty")) {
    project = invalidateCachesForNode(project, sourceNodeId, directionInvalidations);
  }
  return {
    project,
    ui:
      logMessage === false
        ? { ...state.ui, commandBus: executed.bus }
        : appendWorkflowLog(
            { ...state.ui, commandBus: executed.bus },
            logMessage ?? `${command.type} applied.`,
          ),
  };
};

const updateProjectMetadata = (project: Project): Project => {
  const dependencyMap = buildDependencyMap(
    project.nodes,
    project.clips,
    project.references,
    project.clipGraphs,
  );
  const clips = Object.fromEntries(
    Object.entries(project.clips).map(([id, clip]) => [
      id,
      syncClipCacheFields(clip, project.caches),
    ]),
  );
  return {
    ...project,
    assets: project.assets ?? {},
    clips,
    updatedAt: now(),
    dependencyMap,
  };
};

const applyProxyRender = (project: Project, clipId: string, playhead: number): Project => {
  const clip = project.clips[clipId];
  if (!clip) {
    return project;
  }
  const graph = project.clipGraphs[clip.clipGraphId];
  const previewText = graph.nodeIds
    .map((nodeId) => project.nodes[nodeId]?.name)
    .filter(Boolean)
    .join(" -> ");
  const cacheEntry = createCacheEntry(`${clip.name} Proxy`, "proxy", clip.id, previewText);
  cacheEntry.status = "valid";
  cacheEntry.dependencyHash = project.dependencyMap.cacheHashesByClipId[clip.id];
  cacheEntry.artifactPath = `proxy://${clip.id}/${playhead}`;
  return updateProjectMetadata({
    ...project,
    clips: {
      ...project.clips,
      [clip.id]: syncClipCacheFields(
        {
          ...clip,
          proxyCacheId: cacheEntry.id,
          renderCacheNodeId: cacheEntry.id,
        },
        { ...project.caches, [cacheEntry.id]: cacheEntry },
      ),
    },
    caches: { ...project.caches, [cacheEntry.id]: cacheEntry },
    clipGraphs: {
      ...project.clipGraphs,
      [graph.id]: {
        ...graph,
        previewFrames: [`Proxy: ${previewText}`, `Playhead ${playhead}f synced`, ...graph.previewFrames],
        proxyCacheId: cacheEntry.id,
      },
    },
  });
};

const appendWorkflowLog = (ui: EditorUiState, message: string): EditorUiState => ({
  ...ui,
  workflowLog: [message, ...ui.workflowLog].slice(0, 12),
  assistantMessages: [
    {
      id: makeId("assistant"),
      role: "assistant" as const,
      text: message,
      createdAt: now(),
    },
    ...ui.assistantMessages,
  ].slice(0, 24),
});

const reducer = (state: EditorState, action: EditorAction): EditorState => {
  if (action.type === "load") {
    return action.state;
  }

  const project = state.project;
  const activeSequence = project.sequences[project.activeSequenceId];

  switch (action.type) {
    case "add-empty-clip": {
      const clipId = makeId("clip");
      const graphId = makeId("graph");
      const sourceClip = project.clips[state.ui.selectedClipId];
      const inheritWorldId =
        sourceClip?.linkedWorldId && project.worlds[sourceClip.linkedWorldId]
          ? sourceClip.linkedWorldId
          : undefined;
      const clipNodes = createClipNodes(clipId, inheritWorldId);
      const nodes = { ...project.nodes };
      clipNodes.forEach((node) => {
        nodes[node.id] = node;
      });
      const clip: TimelineClip = {
        id: clipId,
        name: `Empty Clip ${activeSequence.clipIds.length + 1}`,
        trackId: "V1",
        start: activeSequence.visibleRange[1] + 12,
        end: activeSequence.visibleRange[1] + 132,
        duration: 120,
        startFrame: activeSequence.visibleRange[1] + 12,
        durationFrames: 120,
        sourceInFrame: 0,
        playbackRate: 1,
        sourceType: "empty",
        linkedWorldId: inheritWorldId,
        worldMode: inheritWorldId ? "referenced" : undefined,
        clipGraphId: graphId,
        cameraPathNodeId: cameraPathNodeIdForClip(clipId),
        performancePlanNodeId: performancePlanNodeIdForClip(clipId),
        cameraTrajectoryNodeId: cameraPathNodeIdForClip(clipId),
        graphSnapshotId: graphId,
        cacheStatus: "invalid",
        variant: "main",
        activeVariantId: "main",
        variants: [{ id: "main", name: "Main", overridePatch: {} }],
      };
      const clipGraphs = {
        ...project.clipGraphs,
        [graphId]: {
          id: graphId,
          clipId,
          rootNodeId: `node-${clipId}-clip`,
          nodeIds: clipNodes.map((node) => node.id),
          edges: createClipEdges(clipId),
          previewFrames: ["Empty clip ready"],
          finalFrames: [],
          keyframeNodeIds: [],
        },
      };
      let nextProject: Project = {
        ...project,
        clips: { ...project.clips, [clipId]: clip },
        clipGraphs,
        nodes,
        sequences: {
          ...project.sequences,
          [activeSequence.id]: {
            ...activeSequence,
            clipIds: [...activeSequence.clipIds, clipId],
            visibleRange: [activeSequence.visibleRange[0], clip.end + 24],
          },
        },
      };
      if (inheritWorldId) {
        nextProject = linkWorldToClip(nextProject, {
          clipId,
          worldId: inheritWorldId,
          timestamp: now(),
        }).project;
      }
      nextProject = updateProjectMetadata(nextProject);
      const worldName = inheritWorldId ? nextProject.worlds[inheritWorldId]?.name : undefined;
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          { ...state.ui, selectedClipId: clipId, selectedNodeId: `node-${clipId}-clip` },
          inheritWorldId
            ? `${clip.name} created and linked to shared world ${worldName ?? inheritWorldId}.`
            : `${clip.name} created with local ClipGraph stub.`,
        ),
      };
    }
    case "delete-clip": {
      if (activeSequence.clipIds.length <= 1) {
        return {
          ...state,
          ui: appendWorkflowLog(state.ui, "At least one clip must remain on the timeline."),
        };
      }
      const clip = project.clips[action.clipId];
      const graph = project.clipGraphs[clip.clipGraphId];
      const dependencyMap = buildDependencyMap(
        project.nodes,
        project.clips,
        project.references,
        project.clipGraphs,
      );
      const projectWithMap = { ...project, dependencyMap };
      const nodeIdsToRemove = new Set(
        resolveNodesToRemoveWithClip(projectWithMap, clip.id, graph?.nodeIds ?? []),
      );
      const nodes = Object.fromEntries(
        Object.entries(project.nodes).filter(([nodeId]) => !nodeIdsToRemove.has(nodeId)),
      );
      const cacheIdsToRemove = new Set(
        [clip.proxyCacheId, clip.finalCacheId].filter(Boolean) as string[],
      );
      const caches = Object.fromEntries(
        Object.entries(project.caches).filter(([cacheId]) => !cacheIdsToRemove.has(cacheId)),
      );
      const references = Object.fromEntries(
        Object.entries(project.references).filter(
          ([, reference]) =>
            !nodeIdsToRemove.has(reference.sourceNodeId) &&
            !nodeIdsToRemove.has(reference.targetNodeId),
        ),
      );
      const clips = { ...project.clips };
      delete clips[clip.id];
      const clipGraphs = { ...project.clipGraphs };
      delete clipGraphs[clip.clipGraphId];
      const remainingClipIds = activeSequence.clipIds.filter((id) => id !== clip.id);
      const nextSelectedClipId = remainingClipIds[0] ?? activeSequence.clipIds[0];
      const nextProject = updateProjectMetadata({
        ...project,
        nodes,
        caches,
        references,
        clips,
        clipGraphs,
        sequences: {
          ...project.sequences,
          [activeSequence.id]: {
            ...activeSequence,
            clipIds: remainingClipIds,
          },
        },
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          {
            ...state.ui,
            selectedClipId: nextSelectedClipId,
            selectedNodeId: `node-${nextSelectedClipId}-clip`,
          },
          `${clip.name} deleted. Shared nodes were preserved.`,
        ),
      };
    }
    case "delete-node": {
      const guard = attemptDeleteNode(project, action.nodeId);
      if (!guard.allowed) {
        return {
          ...state,
          ui: appendWorkflowLog(
            state.ui,
            guard.reason ?? "Node cannot be deleted while references remain.",
          ),
        };
      }
      const nodes = { ...project.nodes };
      delete nodes[action.nodeId];
      const references = Object.fromEntries(
        Object.entries(project.references).filter(
          ([, reference]) =>
            reference.sourceNodeId !== action.nodeId && reference.targetNodeId !== action.nodeId,
        ),
      );
      const clipGraphs = Object.fromEntries(
        Object.entries(project.clipGraphs).map(([id, graph]) => [
          id,
          {
            ...graph,
            nodeIds: graph.nodeIds.filter((nodeId) => nodeId !== action.nodeId),
            edges: graph.edges.filter(
              (edge) =>
                edgeSourceId(edge) !== action.nodeId && edgeTargetId(edge) !== action.nodeId,
            ),
          },
        ]),
      );
      const nextProject = updateProjectMetadata({
        ...project,
        nodes,
        references,
        clipGraphs,
        libraryNodeIds: project.libraryNodeIds.filter((id) => id !== action.nodeId),
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          {
            ...state.ui,
            selectedNodeId:
              state.ui.selectedNodeId === action.nodeId
                ? `node-${state.ui.selectedClipId}-clip`
                : state.ui.selectedNodeId,
            highlightedNodeIds: [],
          },
          `Node ${action.nodeId} deleted.`,
        ),
      };
    }
    case "connect-nodes": {
      const clip = project.clips[action.clipId];
      const graph = project.clipGraphs[clip.clipGraphId];
      const result = attemptConnectNodes(graph.edges, {
        id: makeId("edge"),
        sourceNodeId: action.sourceNodeId,
        targetNodeId: action.targetNodeId,
        label: action.label ?? "data",
      });
      if (!result.ok || !result.edges) {
        return {
          ...state,
          ui: appendWorkflowLog(state.ui, result.reason ?? "Edge connection rejected."),
        };
      }
      const nextProject = updateProjectMetadata({
        ...project,
        clipGraphs: {
          ...project.clipGraphs,
          [graph.id]: { ...graph, edges: result.edges },
        },
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          state.ui,
          `Connected ${action.sourceNodeId} → ${action.targetNodeId}.`,
        ),
      };
    }
    case "select-clip": {
      const clip = project.clips[action.clipId];
      if (!clip) {
        return {
          ...state,
          ui: appendWorkflowLog(state.ui, "선택한 클립을 찾을 수 없습니다."),
        };
      }
      return { ...state, ui: WorkspaceFocus.focusClipGraph(project, state.ui, action.clipId) };
    }
    case "select-node":
      return { ...state, ui: { ...state.ui, selectedNodeId: action.nodeId } };
    case "set-panel-tab":
      return { ...state, ui: { ...state.ui, panelTab: action.tab } };
    case "set-main-panel":
      return { ...state, ui: { ...state.ui, mainPanel: action.panel } };
    case "scrub-playhead": {
      const nextProject = updateProjectMetadata({
        ...project,
        sequences: {
          ...project.sequences,
          [activeSequence.id]: { ...activeSequence, playhead: action.playhead },
        },
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(state.ui, `Playhead moved to ${action.playhead}f.`),
      };
    }
    case "trim-clip": {
      const clip = project.clips[action.clipId];
      const next = withClipTiming(clip, clipStartFrame(clip), action.duration);
      const graph = project.clipGraphs[clip.clipGraphId];
      const temporal = validateClipTemporalNodes(next, project.nodes, graph?.nodeIds ?? []);
      const nextProject = updateProjectMetadata({
        ...project,
        clips: { ...project.clips, [clip.id]: next },
      });
      return {
        project: invalidateCachesForNode(nextProject, clip.cameraPathNodeId ?? `node-${clip.id}-trajectory`),
        ui: appendWorkflowLog(
          state.ui,
          `${clip.name} trimmed to ${action.duration}f.${temporal.ok ? "" : ` ${temporal.issues.join(" ")}`}`,
        ),
      };
    }
    case "set-world": {
      const clip = project.clips[action.clipId];
      if (!clip) {
        return { ...state, ui: appendWorkflowLog(state.ui, "현재 선택된 클립이 없습니다.") };
      }
      const world = project.worlds[action.worldId];
      if (!world) {
        return {
          ...state,
          ui: appendWorkflowLog(state.ui, "연결된 월드를 찾을 수 없습니다."),
        };
      }
      return runDomainCommand(
        {
          ...state,
          ui: { ...state.ui, previewWorldId: world.id, panelTab: "viewport" },
        },
        { type: "LINK_CLIP_WORLD", clipId: clip.id, worldId: world.id },
        `${clip.name} linked to ${world.name}.`,
      );
    }
    case "apply-shot-preset": {
      const nodeId = `node-${action.clipId}-shot`;
      const existing = project.nodes[nodeId];
      const nodes = {
        ...project.nodes,
        [nodeId]: existing
          ? {
              ...existing,
              parameters: { ...existing.parameters, preset: action.preset },
              updatedAt: now(),
            }
          : {
              ...createNode(nodeId, "Shot Preset", "ShotPresetNode", "cinematic", {
                preset: action.preset,
              }),
              downstreamNodeIds: [`node-${action.clipId}-render`],
            },
      };
      const graph = project.clipGraphs[project.clips[action.clipId].clipGraphId];
      const nextGraph = {
        ...graph,
        nodeIds: graph.nodeIds.includes(nodeId) ? graph.nodeIds : [...graph.nodeIds, nodeId],
        edges: graph.edges.some((edge) => edgeSourceId(edge) === nodeId)
          ? graph.edges
          : [
              ...graph.edges,
              makeEdge(makeId("edge-shot"), nodeId, `node-${action.clipId}-render`, "frames"),
            ],
      };
      const nextProject = updateProjectMetadata(
        invalidateCachesForNode(
          {
            ...project,
            nodes,
            clipGraphs: { ...project.clipGraphs, [graph.id]: nextGraph },
          },
          nodeId,
        ),
      );
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          { ...state.ui, selectedNodeId: nodeId },
          `Shot preset ${action.preset} applied.`,
        ),
      };
    }
    case "set-camera-rig": {
      const clip = project.clips[action.clipId];
      if (!clip) {
        return { ...state, ui: appendWorkflowLog(state.ui, "현재 선택된 클립이 없습니다.") };
      }
      const preset = normalizeLegacyRig(action.rig);
      const pathNode = project.nodes[cameraPathNodeIdFromClip(clip)];
      const sequence = project.sequences[project.activeSequenceId];
      const localFrame = Math.max(0, (sequence?.playhead ?? 0) - clipStartFrame(clip));
      const pose = pathNode
        ? interpolateCameraPose(cameraPathParamsFromNode(pathNode.parameters), localFrame)
        : undefined;
      const lensNode = project.nodes[lensNodeIdForClip(clip.id)];
      const lens = lensParamsFromNode(lensNode?.parameters ?? {});
      return runDomainCommand(
        state,
        {
          type: "APPLY_CAMERA_RIG",
          clipId: clip.id,
          preset,
          durationFrames: Math.max(2, clipDurationFrames(clip)),
          startPosition: pose?.position ?? [2.5, 1.8, 3.2],
          startRotation: pose ? quaternionToEulerApprox(pose.rotation) : [0, 0, 0],
          focalLengthMm: lens.focalLengthMm,
        },
        `Camera rig ${preset} applied to CameraRigNode.`,
      );
    }
    case "set-lighting-rig": {
      const nodeId = `node-${action.clipId}-light`;
      const graph = project.clipGraphs[project.clips[action.clipId].clipGraphId];
      const nodes = {
        ...project.nodes,
        [nodeId]: {
          ...createNode(nodeId, "Lighting Rig", "LightingRigNode", "cinematic", {
            preset: action.rig,
            intensity: action.rig === "neon" ? 0.92 : 0.74,
          }),
          downstreamNodeIds: [`node-${action.clipId}-render`],
        },
      };
      const nextProject = updateProjectMetadata(
        invalidateCachesForNode(
          {
            ...project,
            nodes,
            clipGraphs: {
              ...project.clipGraphs,
              [graph.id]: {
                ...graph,
                nodeIds: graph.nodeIds.includes(nodeId) ? graph.nodeIds : [...graph.nodeIds, nodeId],
                edges: graph.edges.some((edge) => edgeSourceId(edge) === nodeId)
                  ? graph.edges
                  : [
                      ...graph.edges,
                      makeEdge(makeId("edge-light"), nodeId, `node-${action.clipId}-render`, "lights"),
                    ],
              },
            },
          },
          nodeId,
        ),
      );
      return {
        project: nextProject,
        ui: appendWorkflowLog({ ...state.ui, selectedNodeId: nodeId }, `Lighting rig ${action.rig} set.`),
      };
    }
    case "capture-keyframe": {
      const clip = project.clips[action.clipId];
      const graph = project.clipGraphs[clip.clipGraphId];
      const keyframeId = makeId("node-keyframe");
      const keyframeNode = createNode(keyframeId, "Captured Keyframe", "KeyframeNode", "capture", {
        playhead: activeSequence.playhead,
        clipId: clip.id,
        camera: action.pose?.camera ?? {
          position: [2.5, 1.8, 3.2],
          rotation: [0, 0, 0],
          focalLength: 35,
        },
        objects: action.pose?.objects ?? [],
      });
      keyframeNode.downstreamNodeIds = [`node-${clip.id}-render`];
      const localFrame = Math.max(0, activeSequence.playhead - clipStartFrame(clip));
      const cameraNodeId = clip.cameraPathNodeId ?? cameraPathNodeIdForClip(clip.id);
      const cameraNode = project.nodes[cameraNodeId];
      const cameraParams = cameraPathParamsFromNode(cameraNode?.parameters ?? {});
      const rotation = action.pose?.camera.rotation ?? [0, 0, 0];
      const nextCameraParams =
        cameraNode && isFrameInsideClip(localFrame, clipDurationFrames(clip))
          ? upsertCameraKeyframe(cameraParams, {
              frame: localFrame,
              position: action.pose?.camera.position ?? [2.5, 1.8, 3.2],
              rotation: eulerToQuaternionApprox(rotation),
              focalLengthMm: action.pose?.camera.focalLength ?? 35,
            })
          : cameraParams;
      const nodes = {
        ...project.nodes,
        [keyframeId]: keyframeNode,
        ...(cameraNode
          ? {
              [cameraNodeId]: {
                ...cameraNode,
                parameters: { ...cameraNode.parameters, ...nextCameraParams },
                params: { ...cameraNode.parameters, ...nextCameraParams },
                updatedAt: now(),
              },
            }
          : {}),
      };
      const nextProject = updateProjectMetadata(
        invalidateCachesForNode(
          {
            ...project,
            nodes,
            clipGraphs: {
              ...project.clipGraphs,
              [graph.id]: {
                ...graph,
                nodeIds: [...graph.nodeIds, keyframeId],
                keyframeNodeIds: [...graph.keyframeNodeIds, keyframeId],
                edges: [
                  ...graph.edges,
                  makeEdge(makeId("edge-keyframe"), keyframeId, `node-${clip.id}-render`, "samples"),
                ],
              },
            },
          },
          keyframeId,
        ),
      );
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          { ...state.ui, selectedNodeId: keyframeId },
          `Keyframe captured at ${activeSequence.playhead}f.`,
        ),
      };
    }
    case "update-node-parameter": {
      const node = project.nodes[action.nodeId];
      if (!node) {
        return state;
      }
      const nextState = runDomainCommand(
        state,
        { type: "UPDATE_NODE_PARAMS", nodeId: node.id, patch: { [action.key]: action.value } },
        `${node.name} parameter ${action.key} updated.`,
      );
      const affected = getAffectedClips(nextState.project.clips, nextState.project.dependencyMap, node.id);
      const impact = buildImpactSentence(
        node.name,
        affected.map((clip) => clip.name),
      );
      const needsApproval = node.referenceType === "shared" || node.referenceType === "instance";
      return {
        ...nextState,
        ui: appendWorkflowLog(
          {
            ...nextState.ui,
            pendingRerender: needsApproval
              ? {
                  nodeId: node.id,
                  affectedClipIds: affected.map((clip) => clip.id),
                  impactSentence: impact,
                }
              : nextState.ui.pendingRerender,
          },
          `${impact}${needsApproval ? " 승인 후 부분 재렌더링 큐에 추가됩니다." : ""}`,
        ),
      };
    }
    case "set-performance-plan": {
      const clip = project.clips[action.clipId];
      if (!clip) {
        return { ...state, ui: appendWorkflowLog(state.ui, "Performance plan clip was not found.") };
      }
      const nodeId = clip.performancePlanNodeId ?? performancePlanNodeIdForClip(clip.id);
      const node = project.nodes[nodeId];
      if (!node || node.kind !== "PerformancePlanNode") {
        return {
          ...state,
          ui: appendWorkflowLog(state.ui, "Performance direction node is missing. Reload the project to migrate it."),
        };
      }
      const previousPlan = performancePlanFromNode(node.parameters);
      const directionInvalidations = diffPerformancePlanDirectionInvalidations(
        previousPlan,
        action.plan,
      );
      return runDomainCommand(
        state,
        { type: "UPDATE_NODE_PARAMS", nodeId, patch: { ...action.plan } },
        false,
        directionInvalidations,
      );
    }
    case "set-reference-type": {
      const reference = project.references[action.referenceId];
      const nextProject = updateProjectMetadata({
        ...project,
        references: {
          ...project.references,
          [reference.id]: { ...reference, referenceType: action.referenceType },
        },
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(state.ui, `Reference ${reference.id} changed to ${action.referenceType}.`),
      };
    }
    case "add-library-reference": {
      const clip = project.clips[action.clipId];
      const graph = project.clipGraphs[clip.clipGraphId];
      const libraryNode = project.nodes[action.libraryNodeId];
      const referenceId = makeId("ref");
      const localNode = cloneNode(libraryNode, { appliedToClipId: clip.id });
      localNode.referenceType = action.referenceType;
      localNode.downstreamNodeIds = [`node-${clip.id}-render`];
      const nextProject = updateProjectMetadata(
        invalidateCachesForNode(
          {
            ...project,
            nodes: { ...project.nodes, [localNode.id]: localNode },
            references: {
              ...project.references,
              [referenceId]: {
                id: referenceId,
                sourceNodeId: action.libraryNodeId,
                targetNodeId: localNode.id,
                scope: "project",
                referenceType: action.referenceType,
              },
            },
            clipGraphs: {
              ...project.clipGraphs,
              [graph.id]: {
                ...graph,
                nodeIds: [...graph.nodeIds, localNode.id],
                edges: [
                  ...graph.edges,
                  makeEdge(makeId("edge-library"), localNode.id, `node-${clip.id}-render`, "styles"),
                ],
              },
            },
          },
          localNode.id,
        ),
      );
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          { ...state.ui, selectedNodeId: localNode.id },
          `${libraryNode.name} added to ${clip.name} as ${action.referenceType}.`,
        ),
      };
    }
    case "break-link":
      return runDomainCommand(state, { type: "BREAK_LINK", referenceId: action.referenceId }, `Reference ${action.referenceId} broken into local copy.`);
    case "make-node-local":
      return runDomainCommand(
        state,
        { type: "MAKE_LOCAL", nodeId: action.nodeId },
        `${project.nodes[action.nodeId]?.name ?? action.nodeId} converted to local node.`,
      );
    case "override-reference-value":
      return runDomainCommand(
        state,
        { type: "OVERRIDE_VALUE", referenceId: action.referenceId, patch: action.patch },
        `Override saved on ${project.references[action.referenceId]?.sourceNodeId ?? action.referenceId}.`,
      );
    case "set-node-reference-type": {
      const node = project.nodes[action.nodeId];
      const nextReferences = Object.fromEntries(
        Object.entries(project.references).map(([id, reference]) => {
          if (reference.sourceNodeId !== node.id && reference.targetNodeId !== node.id) {
            return [id, reference];
          }
          return [id, { ...reference, referenceType: action.referenceType }];
        }),
      );
      const nextProject = updateProjectMetadata({
        ...project,
        nodes: {
          ...project.nodes,
          [node.id]: {
            ...node,
            referenceType: action.referenceType,
            updatedAt: now(),
          },
        },
        references: nextReferences,
      });
      const affected = getAffectedClips(nextProject.clips, nextProject.dependencyMap, node.id);
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          state.ui,
          `${node.name} reference set to ${action.referenceType}. ${buildImpactSentence(
            node.name,
            affected.map((clip) => clip.name),
          )}`,
        ),
      };
    }
    case "reveal-references": {
      const relatedNodeIds = collectReferencedNodeIds(
        action.nodeId,
        project.references,
        project.dependencyMap.referencesByNodeId,
      );
      const affected = getAffectedClips(project.clips, project.dependencyMap, action.nodeId);
      const node = project.nodes[action.nodeId];
      return {
        ...state,
        ui: appendWorkflowLog(
          {
            ...state.ui,
            highlightedNodeIds: relatedNodeIds,
            selectedNodeId: action.nodeId,
          },
          `Reveal references for ${node.name}: ${relatedNodeIds.length} node(s), ${affected.length} affected clip(s). ${buildImpactSentence(
            node.name,
            affected.map((clip) => clip.name),
          )}`,
        ),
      };
    }
    case "render-proxy": {
      const activeSequence = project.sequences[project.activeSequenceId];
      const nextProject = applyProxyRender(project, action.clipId, activeSequence.playhead);
      const clip = project.clips[action.clipId];
      return {
        project: nextProject,
        ui: appendWorkflowLog(state.ui, `Proxy render generated for ${clip.name}.`),
      };
    }
    case "render-final": {
      const clip = project.clips[action.clipId];
      const graph = project.clipGraphs[clip.clipGraphId];
      const cacheEntry = createCacheEntry(
        `${clip.name} Final`,
        "final",
        clip.id,
        `Final render package for ${clip.name}`,
      );
      const nextProject = updateProjectMetadata({
        ...project,
        clips: {
          ...project.clips,
          [clip.id]: syncClipCacheFields(
            {
              ...clip,
              finalCacheId: cacheEntry.id,
            },
            { ...project.caches, [cacheEntry.id]: { ...cacheEntry, status: "valid" } },
          ),
        },
        caches: { ...project.caches, [cacheEntry.id]: { ...cacheEntry, status: "valid" } },
        clipGraphs: {
          ...project.clipGraphs,
          [graph.id]: {
            ...graph,
            finalFrames: ["Final frame 001", "Final frame 002"],
            renderedVideoCacheId: cacheEntry.id,
          },
        },
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(state.ui, `Final render generated for ${clip.name}.`),
      };
    }
    case "toggle-playback":
      return {
        ...state,
        ui: appendWorkflowLog(
          { ...state.ui, playback: state.ui.playback === "playing" ? "stopped" : "playing" },
          state.ui.playback === "playing" ? "Playback stopped." : "Playback started.",
        ),
      };
    case "run-connector": {
      const connector = project.connectors[action.connectorId];
      const cacheEntry = createCacheEntry(
        `${connector.name} Output`,
        "node_evaluation",
        action.clipId,
        `${connector.name} generated proxy hand-off`,
      );
      const nextProject = updateProjectMetadata({
        ...project,
        caches: { ...project.caches, [cacheEntry.id]: { ...cacheEntry, connectorId: connector.id } },
        connectors: {
          ...project.connectors,
          [connector.id]: { ...connector, lastRunAt: now() },
        },
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(state.ui, `${connector.name} executed for ${action.clipId}.`),
      };
    }
    case "set-lyra-job":
      return {
        ...state,
        ui: { ...state.ui, lyraJob: action.job },
      };
    case "set-world-gen-draft":
      return {
        ...state,
        ui: {
          ...state.ui,
          worldGenDraft: { ...state.ui.worldGenDraft, ...action.draft },
        },
      };
    case "set-world-gen-job":
      return {
        ...state,
        ui: { ...state.ui, worldGenJob: action.job },
      };
    case "register-source-image": {
      const assets = registerSourceImageAsset(project.assets ?? {}, action.input);
      return {
        project: updateProjectMetadata({ ...project, assets }),
        ui: {
          ...state.ui,
          worldGenDraft: {
            ...state.ui.worldGenDraft,
            imageName: action.input.name,
            imageAssetId: action.input.id,
            imageThumbnailUri: action.input.thumbnailUri ?? action.input.uri,
          },
        },
      };
    }
    case "clear-source-image":
      return {
        ...state,
        ui: {
          ...state.ui,
          worldGenDraft: {
            ...state.ui.worldGenDraft,
            imageName: "",
            imageAssetId: "",
            imageThumbnailUri: "",
          },
        },
      };
    case "preview-world":
      return {
        ...state,
        ui: {
          ...state.ui,
          previewWorldId: action.worldId,
          panelTab: action.worldId ? "viewport" : state.ui.panelTab,
        },
      };
    case "set-viewport-tool":
      return { ...state, ui: { ...state.ui, viewportTool: action.tool } };
    case "set-viewport-workspace":
      return {
        ...state,
        ui: {
          ...state.ui,
          viewportWorkspace: action.workspace,
          viewportTool: action.workspace === "record" ? "camera" : "navigate",
        },
      };
    case "set-output-aspect":
      return { ...state, ui: { ...state.ui, outputAspect: parseOutputAspectPreset(action.aspect) } };
    case "set-viewport-overlays":
      return {
        ...state,
        ui: {
          ...state.ui,
          viewportOverlays: { ...state.ui.viewportOverlays, ...action.overlays },
        },
      };
    case "set-camera-viz":
      return {
        ...state,
        ui: {
          ...state.ui,
          cameraViz: { ...state.ui.cameraViz, ...action.viz },
        },
      };
    case "update-lens": {
      const clip = project.clips[action.clipId];
      if (!clip) {
        return { ...state, ui: appendWorkflowLog(state.ui, "현재 선택된 클립이 없습니다.") };
      }
      const nodeId = lensNodeIdForClip(clip.id);
      const existing = project.nodes[nodeId];
      const nextParams = { ...defaultLensParams(), ...(existing ? lensParamsFromNode(existing.parameters) : {}), ...action.patch };
      if (!existing) {
        const created = createNodeBase({
          id: nodeId,
          name: "Lens",
          kind: "LensNode",
          category: "cinematic",
          parameters: nextParams,
          timestamp: now(),
          downstreamNodeIds: [`node-${clip.id}-render`],
        });
        return runDomainCommand(
          state,
          { type: "CREATE_NODE", node: created, clipGraphId: clip.clipGraphId },
          `LensNode created (${nextParams.focalLengthMm}mm).`,
        );
      }
      return runDomainCommand(
        state,
        { type: "UPDATE_NODE_PARAMS", nodeId, patch: nextParams },
        `LensNode updated (${nextParams.focalLengthMm}mm / f${nextParams.aperture ?? "—"}).`,
      );
    }
    case "set-look-at": {
      const clip = project.clips[action.clipId];
      if (!clip) {
        return { ...state, ui: appendWorkflowLog(state.ui, "현재 선택된 클립이 없습니다.") };
      }
      const world = clip.linkedWorldId ? project.worlds[clip.linkedWorldId] : undefined;
      const checked = validateLookAtElement(action.elementId, world?.elements ?? []);
      if (!checked.ok) {
        return { ...state, ui: appendWorkflowLog(state.ui, checked.reason) };
      }
      const nodeId = cameraPathNodeIdFromClip(clip);
      const node = project.nodes[nodeId];
      if (!node) {
        return state;
      }
      const current = cameraPathParamsFromNode(node.parameters);
      return runDomainCommand(
        state,
        {
          type: "UPDATE_NODE_PARAMS",
          nodeId,
          patch: {
            ...current,
            lookAtTargetElementId: action.elementId || undefined,
            trackingStrength: action.trackingStrength ?? current.trackingStrength ?? current.stabilization,
          },
        },
        action.elementId ? `Look-at target ${action.elementId}.` : "Look-at target cleared.",
      );
    }
    case "commit-object-transform": {
      const clip = project.clips[action.clipId];
      if (!clip) {
        return { ...state, ui: appendWorkflowLog(state.ui, "현재 선택된 클립이 없습니다.") };
      }
      if (action.kind === "camera") {
        if (state.ui.viewportWorkspace !== "build") {
          return state;
        }
        const nodeId = cameraPathNodeIdFromClip(clip);
        const node = project.nodes[nodeId];
        if (!node) {
          return state;
        }
        const sequence = project.sequences[project.activeSequenceId];
        const localFrame = Math.max(0, (sequence?.playhead ?? 0) - clipStartFrame(clip));
        if (!isFrameInsideClip(localFrame, clipDurationFrames(clip))) {
          return { ...state, ui: appendWorkflowLog(state.ui, "Keyframe is outside clip duration.") };
        }
        const lens = lensParamsFromNode(project.nodes[lensNodeIdForClip(clip.id)]?.parameters ?? {});
        const patch = buildCameraKeyframePatch(node.parameters, {
          frame: localFrame,
          position: action.position,
          rotation: eulerToQuaternionApprox(action.rotation),
          focalLengthMm: lens.focalLengthMm,
        });
        return runDomainCommand(
          state,
          { type: "UPDATE_NODE_PARAMS", nodeId, patch: { ...patch } },
          `Camera pose saved at ${localFrame}f.`,
        );
      }
      const nodeId = placementNodeIdForElement(clip.id, action.worldElementId);
      const params = buildPlacementParams({
        worldElementId: action.worldElementId,
        kind: action.kind,
        position: action.position,
        rotation: action.rotation,
        scale: action.scale,
        layer: "clip",
      });
      const existing = project.nodes[nodeId];
      if (!existing) {
        const created = createNodeBase({
          id: nodeId,
          name: `${action.kind} ${action.worldElementId}`,
          kind: nodeKindForObject(action.kind),
          category: "cinematic",
          parameters: params,
          timestamp: now(),
          downstreamNodeIds: [`node-${clip.id}-render`],
        });
        const nextState = runDomainCommand(
          state,
          { type: "CREATE_NODE", node: created, clipGraphId: clip.clipGraphId },
          `Placement for ${action.worldElementId} created.`,
        );
        return {
          ...nextState,
          project: invalidateCachesForNode(nextState.project, nodeId),
        };
      }
      return runDomainCommand(
        state,
        { type: "UPDATE_NODE_PARAMS", nodeId, patch: params },
        `Placement ${action.worldElementId} updated.`,
      );
    }
    case "complete-world-generation": {
      const parsed = parseWorldGenerationArtifacts(action.job.output);
      if (!parsed.ok) {
        return {
          ...state,
          ui: appendWorkflowLog(
            {
              ...state.ui,
              lyraJob: action.job,
              worldGenJob: {
                requestId: action.job.jobId,
                status: "failed",
                progress: 0,
                message: "커넥터 응답을 해석할 수 없습니다.",
                error: parsed.issues[0],
              },
            },
            "커넥터 응답을 해석할 수 없습니다. 프로젝트는 변경되지 않았습니다.",
          ),
        };
      }

      const draft = state.ui.worldGenDraft;
      const imageAssetId = action.imageAssetId || draft.imageAssetId;
      const worldId = makeId("world");
      const worldName = draft.imageName
        ? `${draft.imageName.replace(/\.[^.]+$/, "")} World`
        : `Generated World ${Object.keys(project.worlds).length + 1}`;
      const executionId = `exec-${action.job.jobId}`;
      const packagedProject = persistWorldGeneration(project, {
        worldId,
        name: worldName,
        description: draft.prompt || "Generated world",
        execution: {
          id: executionId,
          connectorId: "lyra-2.0",
          task: "image_to_world",
          modelVersion: "stub",
          seed: draft.seed ? Number(draft.seed) : undefined,
          inputAssetIds: imageAssetId ? [imageAssetId] : [],
          outputAssetIds: [],
          parameters: {
            jobId: action.job.jobId,
            prompt: draft.prompt,
            explorationTrajectory: true,
          },
          startedAt: now(),
          completedAt: now(),
          status: "completed",
        },
        artifacts: parsed.artifacts,
      });

      return {
        project: updateProjectMetadata(packagedProject),
        ui: appendWorkflowLog(
          {
            ...state.ui,
            lyraJob: action.job,
            worldGenJob: {
              requestId: action.job.jobId,
              status: "completed",
              progress: 1,
              message: `World "${worldName}" registered.`,
              worldId,
              executionId,
            },
          },
          `World "${worldName}" registered. Clip graph was not changed.`,
        ),
      };
    }
    case "run-stage-pass": {
      const clip = project.clips[action.clipId];
      const graph = project.clipGraphs[clip.clipGraphId];
      const pass = createStageRenderPassStub(clip.id);
      const refinement = runGenerativeRefinementStub(clip.id);
      const passNodeId = makeId("node-stagepass");
      const refineNodeId = makeId("node-refine");
      const nodes = {
        ...project.nodes,
        [passNodeId]: createNode(passNodeId, "Stage Render Pass", "StageRenderPassNode", "render", {
          passId: pass.passId,
          artifacts: pass.artifacts,
        }),
        [refineNodeId]: createNode(
          refineNodeId,
          "Generative Refinement",
          "GenerativeRefinementNode",
          "render",
          { refinementId: refinement.refinementId, outputPath: refinement.outputPath },
        ),
      };
      const nextProject = updateProjectMetadata({
        ...project,
        nodes,
        clipGraphs: {
          ...project.clipGraphs,
          [graph.id]: {
            ...graph,
            nodeIds: [...graph.nodeIds, passNodeId, refineNodeId],
            edges: [
              ...graph.edges,
              makeEdge(makeId("edge"), passNodeId, refineNodeId, "refine"),
            ],
            previewFrames: [`Stage pass ${pass.passId}`, ...graph.previewFrames],
          },
        },
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          { ...state.ui, selectedNodeId: passNodeId },
          `Stage render pass stub created for ${clip.name}.`,
        ),
      };
    }
    case "set-actor-placement": {
      const nodeId = `node-${action.clipId}-actor`;
      const graph = project.clipGraphs[project.clips[action.clipId].clipGraphId];
      const position = action.position
        ? { x: action.position[0], y: action.position[1], z: action.position[2] }
        : { x: -0.6, y: 0, z: 0.2 };
      const rotation = action.rotation
        ? { x: action.rotation[0], y: action.rotation[1], z: action.rotation[2] }
        : { x: 0, y: 0, z: 0 };
      const existing = project.nodes[nodeId];
      const nodes = {
        ...project.nodes,
        [nodeId]: existing
          ? {
              ...existing,
              parameters: { ...existing.parameters, mark: action.mark, position, rotation },
              updatedAt: now(),
            }
          : {
              ...createNode(nodeId, "Actor Placement", "ActorPlacementNode", "cinematic", {
                mark: action.mark,
                position,
                rotation,
              }),
              downstreamNodeIds: [`node-${action.clipId}-render`],
            },
      };
      const nextProject = updateProjectMetadata(
        invalidateCachesForNode(
          {
            ...project,
            nodes,
            clipGraphs: {
              ...project.clipGraphs,
              [graph.id]: {
                ...graph,
                nodeIds: graph.nodeIds.includes(nodeId) ? graph.nodeIds : [...graph.nodeIds, nodeId],
              },
            },
          },
          nodeId,
        ),
      );
      return {
        project: nextProject,
        ui: appendWorkflowLog({ ...state.ui, selectedNodeId: nodeId }, `Actor placed at ${action.mark}.`),
      };
    }
    case "set-prop-placement": {
      const nodeId = `node-${action.clipId}-prop`;
      const graph = project.clipGraphs[project.clips[action.clipId].clipGraphId];
      const position = action.position
        ? { x: action.position[0], y: action.position[1], z: action.position[2] }
        : { x: 0.4, y: 0, z: -0.3 };
      const rotation = action.rotation
        ? { x: action.rotation[0], y: action.rotation[1], z: action.rotation[2] }
        : { x: 0, y: 0, z: 0 };
      const existing = project.nodes[nodeId];
      const nodes = {
        ...project.nodes,
        [nodeId]: existing
          ? {
              ...existing,
              parameters: { ...existing.parameters, prop: action.prop, position, rotation },
              updatedAt: now(),
            }
          : {
              ...createNode(nodeId, "Prop Placement", "PlacementNode", "cinematic", {
                prop: action.prop,
                position,
                rotation,
              }),
              downstreamNodeIds: [`node-${action.clipId}-render`],
            },
      };
      const nextProject = updateProjectMetadata({
        ...project,
        nodes,
        clipGraphs: {
          ...project.clipGraphs,
          [graph.id]: {
            ...graph,
            nodeIds: graph.nodeIds.includes(nodeId) ? graph.nodeIds : [...graph.nodeIds, nodeId],
          },
        },
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog({ ...state.ui, selectedNodeId: nodeId }, `Prop ${action.prop} placed.`),
      };
    }
    case "set-light-transform": {
      const nodeId = `node-${action.clipId}-light-${action.lightId}`;
      const graph = project.clipGraphs[project.clips[action.clipId].clipGraphId];
      const position = { x: action.position[0], y: action.position[1], z: action.position[2] };
      const rotation = { x: action.rotation[0], y: action.rotation[1], z: action.rotation[2] };
      const nodes = {
        ...project.nodes,
        [nodeId]: createNode(nodeId, `Light ${action.lightId}`, "LightingRigNode", "cinematic", {
          lightId: action.lightId,
          position,
          rotation,
        }),
      };
      nodes[nodeId].downstreamNodeIds = [`node-${action.clipId}-render`];
      const nextProject = updateProjectMetadata({
        ...project,
        nodes,
        clipGraphs: {
          ...project.clipGraphs,
          [graph.id]: {
            ...graph,
            nodeIds: graph.nodeIds.includes(nodeId) ? graph.nodeIds : [...graph.nodeIds, nodeId],
          },
        },
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(state.ui, `Light ${action.lightId} transform updated.`),
      };
    }
    case "set-video-render-job":
      return {
        ...state,
        ui: {
          ...state.ui,
          videoRenderJob: action.job,
        },
      };
    case "complete-video-render": {
      const clip = project.clips[action.clipId];
      const output = action.job.output;
      if (!output) {
        return {
          ...state,
          ui: appendWorkflowLog(
            { ...state.ui, videoRenderJob: action.job },
            action.job.error ?? "Video render failed.",
          ),
        };
      }
      const cacheEntry = createCacheEntry(`${clip.name} Final Video`, "final", clip.id, output.renderedVideoPath);
      cacheEntry.status = "valid";
      cacheEntry.artifactPath = output.renderedVideoPath;
      cacheEntry.dependencyHash = project.dependencyMap.cacheHashesByClipId[clip.id];
      const nextProject = updateProjectMetadata({
        ...project,
        clips: {
          ...project.clips,
          [clip.id]: syncClipCacheFields(
            {
              ...clip,
              finalCacheId: cacheEntry.id,
            },
            { ...project.caches, [cacheEntry.id]: cacheEntry },
          ),
        },
        caches: { ...project.caches, [cacheEntry.id]: cacheEntry },
        clipGraphs: {
          ...project.clipGraphs,
          [clip.clipGraphId]: {
            ...project.clipGraphs[clip.clipGraphId],
            finalFrames: [output.renderedVideoPath, ...project.clipGraphs[clip.clipGraphId].finalFrames],
            renderedVideoCacheId: cacheEntry.id,
          },
        },
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          { ...state.ui, videoRenderJob: action.job },
          `Generative video ready (consistency ${Math.round(output.consistencyScore * 100)}%).`,
        ),
      };
    }
    case "assistant-message": {
      const userMessage: AssistantMessage = {
        id: makeId("user"),
        role: "user",
        text: action.message,
        createdAt: now(),
      };
      return {
        ...state,
        ui: {
          ...state.ui,
          assistantMessages: [userMessage, ...state.ui.assistantMessages].slice(0, 24),
        },
      };
    }
    case "approve-partial-rerender": {
      const pending = state.ui.pendingRerender;
      if (!pending) {
        return state;
      }
      const sequence = project.sequences[project.activeSequenceId];
      let renderQueue = enqueueAffectedClips(
        state.ui.renderQueue,
        pending.affectedClipIds,
        "proxy",
        sequence.playhead,
        sequence.visibleRange,
        project.clips,
        pending.nodeId,
      );
      let nextProject = project;
      pending.affectedClipIds.forEach((clipId) => {
        nextProject = applyProxyRender(nextProject, clipId, sequence.playhead);
        const queuedItem = renderQueue.proxy.find(
          (item) => item.clipId === clipId && item.status === "queued",
        );
        if (queuedItem) {
          renderQueue = markQueueItem(renderQueue, queuedItem.id, "done");
        }
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          { ...state.ui, pendingRerender: undefined, renderQueue },
          `Approved partial rerender for ${pending.affectedClipIds.length} clip(s).`,
        ),
      };
    }
    case "dismiss-partial-rerender":
      return {
        ...state,
        ui: appendWorkflowLog(
          { ...state.ui, pendingRerender: undefined },
          "Partial rerender dismissed. Caches remain invalid until manual render.",
        ),
      };
    case "retry-failed-render": {
      const clip = project.clips[action.clipId];
      const cacheId = action.kind === "proxy" ? clip.proxyCacheId : clip.finalCacheId;
      const cache = cacheId ? project.caches[cacheId] : undefined;
      if (!cache || cache.status !== "failed") {
        return {
          ...state,
          ui: appendWorkflowLog(state.ui, `No failed ${action.kind} cache to retry for ${clip.name}.`),
        };
      }
      const nextCaches = {
        ...project.caches,
        [cacheId!]: { ...cache, status: "invalid" as const, updatedAt: now() },
      };
      const nextProject = updateProjectMetadata({
        ...project,
        caches: nextCaches,
        clips: {
          ...project.clips,
          [clip.id]: syncClipCacheFields(clip, nextCaches),
        },
      });
      if (action.kind === "proxy") {
        const sequence = project.sequences[project.activeSequenceId];
        return {
          project: applyProxyRender(nextProject, clip.id, sequence.playhead),
          ui: appendWorkflowLog(state.ui, `Retried proxy render for ${clip.name}.`),
        };
      }
      return {
        project: nextProject,
        ui: appendWorkflowLog(state.ui, `Retry queued for final render on ${clip.name}.`),
      };
    }
    case "undo": {
      const undone = undoCommand(project, state.ui.commandBus, now());
      if (!undone.result.ok) {
        return { ...state, ui: appendWorkflowLog(state.ui, undone.result.reason ?? "Nothing to undo.") };
      }
      return {
        project: updateProjectMetadata(undone.project),
        ui: appendWorkflowLog({ ...state.ui, commandBus: undone.bus }, "Undo."),
      };
    }
    case "redo": {
      const redone = redoCommand(project, state.ui.commandBus, now());
      if (!redone.result.ok) {
        return { ...state, ui: appendWorkflowLog(state.ui, redone.result.reason ?? "Nothing to redo.") };
      }
      return {
        project: updateProjectMetadata(redone.project),
        ui: appendWorkflowLog({ ...state.ui, commandBus: redone.bus }, "Redo."),
      };
    }
    case "create-variant": {
      const clip = project.clips[action.clipId];
      const variantId = makeId("variant");
      const nextClip = createClipVariant(ensureClipVariants(clip), variantId, action.name ?? `Variant ${variantId.slice(-4)}`);
      return {
        project: updateProjectMetadata({
          ...project,
          clips: { ...project.clips, [clip.id]: nextClip },
        }),
        ui: appendWorkflowLog(state.ui, `Variant ${nextClip.activeVariantId} created for ${clip.name} (graph not cloned).`),
      };
    }
    case "set-active-variant": {
      const clip = project.clips[action.clipId];
      return {
        project: updateProjectMetadata({
          ...project,
          clips: { ...project.clips, [clip.id]: setActiveVariant(clip, action.variantId) },
        }),
        ui: appendWorkflowLog(state.ui, `${clip.name} active variant → ${action.variantId}.`),
      };
    }
    case "toggle-world-overlay":
      return {
        ...state,
        ui: appendWorkflowLog(
          { ...state.ui, showWorldOverlay: !state.ui.showWorldOverlay },
          state.ui.showWorldOverlay ? "World overlay hidden." : "World overlay shown.",
        ),
      };
    case "add-camera-keyframe": {
      const clip = project.clips[action.clipId];
      if (!clip) {
        return { ...state, ui: appendWorkflowLog(state.ui, "현재 선택된 클립이 없습니다.") };
      }
      const nodeId = clip.cameraPathNodeId ?? cameraPathNodeIdForClip(clip.id);
      const node = project.nodes[nodeId];
      if (!node) {
        return state;
      }
      if (!isFrameInsideClip(action.frame, clipDurationFrames(clip))) {
        return { ...state, ui: appendWorkflowLog(state.ui, "Keyframe is outside clip duration.") };
      }
      const current = cameraPathParamsFromNode(node.parameters);
      const colliding = Boolean(keyframeAtExactFrame(current, action.frame));
      const nextParams = upsertCameraKeyframe(current, {
        frame: action.frame,
        position: action.position,
        rotation: action.rotation,
        focalLengthMm: action.focalLengthMm,
        focusDistanceM: action.focusDistanceM,
        aperture: action.aperture,
      });
      return runDomainCommand(
        state,
        { type: "UPDATE_NODE_PARAMS", nodeId, patch: { ...nextParams } },
        colliding
          ? `Camera keyframe at ${action.frame}f replaced (frame collision).`
          : `Camera keyframe at ${action.frame}f saved to CameraPathNode.`,
      );
    }
    case "delete-camera-keyframe": {
      const clip = project.clips[action.clipId];
      if (!clip) {
        return { ...state, ui: appendWorkflowLog(state.ui, "현재 선택된 클립이 없습니다.") };
      }
      const nodeId = clip.cameraPathNodeId ?? cameraPathNodeIdForClip(clip.id);
      const node = project.nodes[nodeId];
      if (!node) {
        return state;
      }
      const current = cameraPathParamsFromNode(node.parameters);
      if (!keyframeAtExactFrame(current, action.frame)) {
        return { ...state, ui: appendWorkflowLog(state.ui, `No keyframe at ${action.frame}f.`) };
      }
      return runDomainCommand(
        state,
        { type: "UPDATE_NODE_PARAMS", nodeId, patch: { ...deleteCameraKeyframe(current, action.frame) } },
        `Camera keyframe at ${action.frame}f deleted.`,
      );
    }
    case "trim-camera-keyframes": {
      const clip = project.clips[action.clipId];
      if (!clip) {
        return { ...state, ui: appendWorkflowLog(state.ui, "현재 선택된 클립이 없습니다.") };
      }
      const nodeId = clip.cameraPathNodeId ?? cameraPathNodeIdForClip(clip.id);
      const node = project.nodes[nodeId];
      if (!node) {
        return state;
      }
      const trimmed = trimKeyframesToDuration(cameraPathParamsFromNode(node.parameters), clipDurationFrames(clip));
      if (trimmed.removed === 0) {
        return { ...state, ui: appendWorkflowLog(state.ui, "No keyframes outside clip duration.") };
      }
      return runDomainCommand(
        state,
        { type: "UPDATE_NODE_PARAMS", nodeId, patch: { ...trimmed.params } },
        `Removed ${trimmed.removed} keyframe(s) outside clip duration.`,
      );
    }
    case "cancel-domain-job": {
      return {
        ...state,
        ui: {
          ...state.ui,
          domainJobQueue: cancelRenderJob(state.ui.domainJobQueue, action.jobId),
        },
      };
    }
    case "trim-clip-frames": {
      const clip = project.clips[action.clipId];
      return runDomainCommand(
        state,
        {
          type: "UPDATE_CLIP_TIMING",
          clipId: clip.id,
          startFrame: clipStartFrame(clip),
          durationFrames: action.durationFrames,
        },
        `${clip.name} duration set to ${action.durationFrames}f.`,
      );
    }
    default:
      return state;
  }
};

const runVideoRenderJob = async (
  state: EditorState,
  clipId: string,
  dispatch: Dispatch<EditorAction>,
) => {
  const clip = state.project.clips[clipId];
  const graph = state.project.clipGraphs[clip.clipGraphId];
  const world = clip.linkedWorldId ? state.project.worlds[clip.linkedWorldId] : undefined;
  const sequence = state.project.sequences[state.project.activeSequenceId];
  const previousFinalCache = clip.finalCacheId
    ? state.project.caches[clip.finalCacheId]
    : undefined;
  const input = buildVideoRenderInput(
    clip,
    graph,
    state.project.nodes,
    world,
    sequence.playhead,
    state.ui.worldGenDraft.prompt,
    { rerenderScope: previousFinalCache?.directionInvalidations },
  );
  const shotWorkflow = evaluateShotWorkflow({
    clip,
    graph,
    nodes: state.project.nodes,
    worlds: state.project.worlds,
    caches: state.project.caches,
  });
  if (!shotWorkflow.readyForRender) {
    dispatch({
      type: "set-video-render-job",
      job: {
        jobId: "shot-setup-incomplete",
        status: "failed",
        progress: 0,
        message: shotWorkflow.blockingIssues[0] ?? "Finish the shot setup.",
        input,
        error: shotWorkflow.blockingIssues.join(" "),
      },
    });
    return;
  }
  const performancePlan = performancePlanFromNode(
    state.project.nodes[clip.performancePlanNodeId ?? performancePlanNodeIdForClip(clip.id)]?.parameters,
  );
  const performanceValidation = validatePerformancePlan(
    performancePlan,
    clipDurationFrames(clip),
  );

  if (!performanceValidation.ok) {
    dispatch({
      type: "set-video-render-job",
      job: {
        jobId: "direction-contract-invalid",
        status: "failed",
        progress: 0,
        message: "Direction contract has invalid performance timing.",
        input,
        error: performanceValidation.errors.join(" "),
      },
    });
    return;
  }

  dispatch({
    type: "set-video-render-job",
    job: {
      jobId: "pending",
      status: "queued",
      progress: 0,
      message: `Submitting render for ${clip.name}…`,
      input,
    },
  });

  try {
    let job = await lyraAdapter.submitVideoRenderJob(input);
    dispatch({ type: "set-video-render-job", job });

    while (job.status === "queued" || job.status === "running") {
      job = await lyraAdapter.pollVideoRenderJob(job.jobId);
      dispatch({ type: "set-video-render-job", job });
    }

    dispatch({ type: "complete-video-render", clipId, job });
  } catch (error) {
    dispatch({
      type: "complete-video-render",
      clipId,
      job: {
        jobId: "failed",
        status: "failed",
        progress: 0,
        message: "Video render failed",
        input,
        error: error instanceof Error ? error.message : "Video render failed",
      },
    });
  }
};

const composePersistedEditor = (state: EditorState): string =>
  JSON.stringify({
    project: serializeProject(migrateLoadedProject(state.project)),
    ui: {
      selectedClipId: state.ui.selectedClipId,
      selectedNodeId: state.ui.selectedNodeId,
      selectedLibraryNodeId: state.ui.selectedLibraryNodeId,
      panelTab: state.ui.panelTab,
      mainPanel: state.ui.mainPanel,
      playback: "stopped",
      workflowLog: state.ui.workflowLog,
      assistantMessages: state.ui.assistantMessages,
      highlightedNodeIds: [],
      worldGenDraft: state.ui.worldGenDraft,
      renderQueue: state.ui.renderQueue,
      commandBus: emptyCommandBusState(),
      showWorldOverlay: state.ui.showWorldOverlay,
      domainJobQueue: createEmptyJobQueue(),
      viewportTool: state.ui.viewportTool,
      viewportWorkspace: state.ui.viewportWorkspace,
      outputAspect: state.ui.outputAspect,
      previewWorldId: state.ui.previewWorldId,
      viewportOverlays: state.ui.viewportOverlays,
      cameraViz: state.ui.cameraViz,
    },
  });

const parsePersistedEditor = (raw: string): EditorState | undefined => {
  try {
    const parsed = JSON.parse(raw) as { project: string | Project; ui: Partial<EditorUiState> };
    const projectRaw =
      typeof parsed.project === "string"
        ? parsed.project
        : JSON.stringify({ version: 2, project: parsed.project });
    return {
      ui: {
        ...createInitialState().ui,
        ...parsed.ui,
        mainPanel: parsed.ui?.mainPanel === "graph" ? "graph" : "playback",
        worldGenDraft: {
          ...createInitialState().ui.worldGenDraft,
          ...parsed.ui?.worldGenDraft,
        },
        renderQueue: parsed.ui?.renderQueue ?? createEmptyRenderQueue(),
        assistantMessages: parsed.ui?.assistantMessages ?? [],
        panelTab: normalizePanelTab(parsed.ui?.panelTab),
        commandBus: emptyCommandBusState(),
        showWorldOverlay: parsed.ui?.showWorldOverlay ?? true,
        domainJobQueue: createEmptyJobQueue(),
        previewWorldId: parsed.ui?.previewWorldId,
        viewportTool: parsed.ui?.viewportTool ?? "navigate",
        viewportWorkspace: parseViewportWorkspace(parsed.ui ?? {}),
        outputAspect: parseOutputAspectPreset(parsed.ui?.outputAspect),
        viewportOverlays: {
          ...defaultViewportOverlays(),
          ...parsed.ui?.viewportOverlays,
        },
        cameraViz: { ...defaultCameraViz(), ...parsed.ui?.cameraViz },
        lyraJob: undefined,
        worldGenJob: undefined,
      },
      project: loadAndMigrateProject(projectRaw),
    };
  } catch {
    return undefined;
  }
};

export const EditorStoreProvider = ({ children }: { children: ReactNode }) => {
  const [state, baseDispatch] = useReducer(reducer, undefined, () => {
    if (typeof window === "undefined") {
      return createInitialState();
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createInitialState();
    }
    return parsePersistedEditor(raw) ?? createInitialState();
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const applyingRemoteRef = useRef(false);
  const syncOriginRef = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `sf-${Date.now()}`,
  );

  const dispatch = useCallback((action: EditorAction) => {
    if (action.type === "submit-video-render") {
      void runVideoRenderJob(stateRef.current, action.clipId, baseDispatch);
      return;
    }
    baseDispatch(action);
  }, []);

  useEffect(() => {
    if (applyingRemoteRef.current) {
      applyingRemoteRef.current = false;
      return;
    }
    const composed = composePersistedEditor(state);
    writeAtomicLocalStorage(STORAGE_KEY, composed);
    const channel = new BroadcastChannel("sceneforge-editor-sync");
    channel.postMessage({ origin: syncOriginRef.current, body: composed });
    channel.close();
  }, [state]);

  useEffect(() => {
    const applyRemote = (raw: string) => {
      const next = parsePersistedEditor(raw);
      if (!next) {
        return;
      }
      applyingRemoteRef.current = true;
      baseDispatch({ type: "load", state: next });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) {
        return;
      }
      applyRemote(event.newValue);
    };
    const channel = new BroadcastChannel("sceneforge-editor-sync");
    const onMessage = (event: MessageEvent<{ origin?: string; body?: string }>) => {
      if (!event.data?.body || event.data.origin === syncOriginRef.current) {
        return;
      }
      applyRemote(event.data.body);
    };
    window.addEventListener("storage", onStorage);
    channel.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("storage", onStorage);
      channel.removeEventListener("message", onMessage);
      channel.close();
    };
  }, []);

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
};

export const useEditorStore = () => {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditorStore must be used within EditorStoreProvider");
  }
  return context;
};
