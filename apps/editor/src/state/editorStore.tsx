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
import {
  registerWorldAssetPair,
  registerWorldFromLyraOutput,
} from "../core/world/artifactRegistry";
import type { WorldAsset, WorldMode } from "../core/world/types";
import { assetFromWorld } from "../domain/assets";
import { normalizeWorldAsset } from "../domain/worlds";
import { applyDirtyEventToNodes } from "../domain/graph/dependencyService";
import { collectAllEdges, markDirty } from "../domain/graph/dirty";
import { computeNodeContentHash } from "../domain/graph/cacheKey";
import {
  cameraPathParamsFromNode,
  upsertCameraKeyframe,
} from "../domain/graph/cameraPath";
import { clipStartFrame, withClipTiming } from "../domain/timeline/timing";
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
  applyTrajectoryToCameraPath,
  persistWorldGeneration,
  registerSourceImageAsset,
} from "../application/services/worldGeneration";
import {
  cancelRenderJob,
  createEmptyJobQueue,
  type RenderJobQueue,
} from "../domain/rendering/jobQueue";

const STORAGE_KEY = "sceneforge-editor-state-v3";

/** User-facing left panel tabs. Graph/Library/Inspector are backend-only structures. */
export type PanelTab = "viewport" | "world-generation";

const normalizePanelTab = (value: unknown): PanelTab =>
  value === "world-generation" ? "world-generation" : "viewport";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
}

interface EditorUiState {
  selectedClipId: string;
  selectedNodeId: string;
  selectedLibraryNodeId?: string;
  panelTab: PanelTab;
  playback: "stopped" | "playing";
  workflowLog: string[];
  assistantMessages: AssistantMessage[];
  highlightedNodeIds: string[];
  lyraJob?: LyraJobState;
  videoRenderJob?: LyraVideoRenderJobState;
  worldGenDraft: {
    imageName: string;
    prompt: string;
    trajectoryLabel: string;
  };
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
  | { type: "scrub-playhead"; playhead: number }
  | { type: "trim-clip"; clipId: string; duration: number }
  | { type: "set-world"; clipId: string; worldId: string; worldMode: WorldMode }
  | { type: "apply-shot-preset"; clipId: string; preset: "WS" | "MS" | "CU" | "OTS" }
  | { type: "set-camera-rig"; clipId: string; rig: "dolly" | "handheld" | "crane" | "orbit" | "shoulder" }
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
  | { type: "complete-world-generation"; clipId: string; job: LyraJobState }
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
  | { type: "add-camera-keyframe"; clipId: string; frame: number; position: [number, number, number]; rotation: [number, number, number, number]; focalLengthMm: number }
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

const createExampleWorld = (): WorldAsset =>
  normalizeWorldAsset({
    id: "world-apartment-livingroom",
    name: "Apartment Livingroom",
    description: "예제 로케이션. single-location previs용 거실 월드.",
    usdPath: "worlds/apartment_livingroom/world.usda",
    semanticsPath: "worlds/apartment_livingroom/semantics.json",
    navmeshPath: "worlds/apartment_livingroom/navmesh.bin",
    previewPath: "worlds/apartment_livingroom/preview.glb",
    proxyKind: "usd",
    representation: "usd_stage",
    rootUri: "worlds/apartment_livingroom",
    previewUri: "worlds/apartment_livingroom/preview.glb",
    semanticTags: ["interior", "apartment", "livingroom"],
    props: ["sofa", "coffee table", "lamp", "window", "doorway"],
    elements: [
      {
        id: "elem-room-living",
        name: "Living Room Zone",
        kind: "room",
        description: "메인 대화 장면 구역",
      },
      {
        id: "elem-actor-mark-a",
        name: "Actor Mark A",
        kind: "actor_mark",
        description: "주연 배우 기본 스탠딩 위치",
      },
      {
        id: "elem-camera-anchor-wide",
        name: "Camera Anchor Wide",
        kind: "camera_anchor",
        description: "와이드 샷 기본 카메라 앵커",
      },
      {
        id: "elem-light-socket-window",
        name: "Window Light Socket",
        kind: "light_socket",
        description: "창문 역광 라이트 소켓",
      },
      {
        id: "elem-material-window",
        name: "Window Glass Material",
        kind: "material_slot",
        description: "유리 색상 오버라이드 슬롯",
      },
    ],
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
  const world = createExampleWorld();
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

  const worldAsset = assetFromWorld(world);
  const seededWorld = {
    ...world,
    sourceAssetIds: world.sourceAssetIds.includes(worldAsset.id)
      ? world.sourceAssetIds
      : [...world.sourceAssetIds, worldAsset.id],
  };

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
    worlds: { [seededWorld.id]: seededWorld },
    assets: { [worldAsset.id]: worldAsset },
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
      panelTab: "viewport",
      playback: "stopped",
      workflowLog: [
        "Timeline-first editor shell initialized.",
        "Apartment Livingroom world loaded as reference.",
      ],
      assistantMessages: [],
      highlightedNodeIds: [],
      worldGenDraft: {
        imageName: "",
        prompt: "",
        trajectoryLabel: "default orbit",
      },
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

const invalidateCachesForNode = (project: Project, nodeId: string): Project => {
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

const runDomainCommand = (state: EditorState, command: DomainCommand, logMessage?: string): EditorState => {
  const executed = executeCommand(state.project, state.ui.commandBus, command, now());
  if (!executed.result.ok) {
    return {
      ...state,
      ui: appendWorkflowLog(state.ui, executed.result.reason ?? "Command failed."),
    };
  }
  let project = updateProjectMetadata(executed.project);
  const sourceNodeId =
    "nodeId" in command && typeof command.nodeId === "string"
      ? command.nodeId
      : command.type === "OVERRIDE_VALUE"
        ? project.references[command.referenceId]?.sourceNodeId
        : undefined;
  if (sourceNodeId && executed.result.events.some((item) => item.type === "NodeMarkedDirty")) {
    project = invalidateCachesForNode(project, sourceNodeId);
  }
  return {
    project,
    ui: appendWorkflowLog(
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
      const clipNodes = createClipNodes(clipId);
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
        clipGraphId: graphId,
        cameraPathNodeId: cameraPathNodeIdForClip(clipId),
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
      const nextProject = updateProjectMetadata({
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
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          { ...state.ui, selectedClipId: clipId, selectedNodeId: `node-${clipId}-clip` },
          `${clip.name} created with local ClipGraph stub.`,
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
      const cameraNodeId = clip.cameraPathNodeId ?? `node-${clip.id}-trajectory`;
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedClipId: action.clipId,
          selectedNodeId: `node-${clip.id}-clip`,
          highlightedNodeIds: [cameraNodeId, `node-${clip.id}-clip`].filter((id) => project.nodes[id]),
        },
      };
    }
    case "select-node":
      return { ...state, ui: { ...state.ui, selectedNodeId: action.nodeId } };
    case "set-panel-tab":
      return { ...state, ui: { ...state.ui, panelTab: action.tab } };
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
      const clipRootNodeId = `node-${clip.id}-clip`;
      const clipRootNode = project.nodes[clipRootNodeId];
      const worldRefNodeId = `node-${clip.id}-worldref`;
      const world = project.worlds[action.worldId];
      const nodes = {
        ...project.nodes,
        [clipRootNodeId]: {
          ...clipRootNode,
          parameters: {
            ...clipRootNode.parameters,
            linkedWorldId: world.id,
            worldMode: action.worldMode,
          },
          updatedAt: now(),
        },
        [worldRefNodeId]: project.nodes[worldRefNodeId]
          ? {
              ...project.nodes[worldRefNodeId],
              parameters: {
                ...project.nodes[worldRefNodeId].parameters,
                worldId: world.id,
                worldMode: action.worldMode,
                proxyKind: world.proxyKind,
              },
              updatedAt: now(),
            }
          : {
              ...createNode(worldRefNodeId, "World Reference", "WorldReferenceNode", "scene", {
                worldId: world.id,
                worldMode: action.worldMode,
                proxyKind: world.proxyKind,
              }),
              downstreamNodeIds: [`node-${clip.id}-render`],
            },
      };
      const graph = project.clipGraphs[clip.clipGraphId];
      const nextNodeIds = graph.nodeIds.includes(worldRefNodeId)
        ? graph.nodeIds
        : [...graph.nodeIds, worldRefNodeId];
      const nextEdges = graph.edges.some((edge) => edgeSourceId(edge) === worldRefNodeId)
        ? graph.edges
        : [
            ...graph.edges,
            makeEdge(makeId("edge-world"), worldRefNodeId, `node-${clip.id}-render`, "references"),
          ];
      const nextProject = updateProjectMetadata(
        invalidateCachesForNode(
          {
            ...project,
            clips: {
              ...project.clips,
              [clip.id]: {
                ...clip,
                linkedWorldId: world.id,
                worldMode: action.worldMode,
              },
            },
            nodes,
            clipGraphs: {
              ...project.clipGraphs,
              [graph.id]: {
                ...graph,
                nodeIds: nextNodeIds,
                edges: nextEdges,
                previewFrames: [`${world.name} attached`, ...graph.previewFrames],
              },
            },
          },
          worldRefNodeId,
        ),
      );
      return {
        project: nextProject,
        ui: appendWorkflowLog(
          { ...state.ui, selectedNodeId: worldRefNodeId },
          `${clip.name} linked to ${world.name} (${action.worldMode}).`,
        ),
      };
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
      const nodeId = `node-${action.clipId}-camera`;
      const graph = project.clipGraphs[project.clips[action.clipId].clipGraphId];
      const nodes = {
        ...project.nodes,
        [nodeId]: {
          ...createNode(nodeId, "Camera Rig", "CameraRigNode", "cinematic", {
            rig: action.rig,
            speed: action.rig === "handheld" ? 1.2 : 0.8,
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
                      makeEdge(makeId("edge-camera"), nodeId, `node-${action.clipId}-render`, "captures"),
                    ],
              },
            },
          },
          nodeId,
        ),
      );
      return {
        project: nextProject,
        ui: appendWorkflowLog({ ...state.ui, selectedNodeId: nodeId }, `Camera rig ${action.rig} set.`),
      };
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
      const cameraNodeId = clip.cameraPathNodeId ?? cameraPathNodeIdForClip(clip.id);
      const cameraNode = project.nodes[cameraNodeId];
      const cameraParams = cameraPathParamsFromNode(cameraNode?.parameters ?? {});
      const rotation = action.pose?.camera.rotation ?? [0, 0, 0];
      const nextCameraParams = upsertCameraKeyframe(cameraParams, {
        frame: activeSequence.playhead,
        position: action.pose?.camera.position ?? [2.5, 1.8, 3.2],
        rotation: [rotation[0], rotation[1], rotation[2], 1],
        focalLengthMm: action.pose?.camera.focalLength ?? 35,
      });
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
    case "complete-world-generation": {
      const clip = project.clips[action.clipId];
      const graph = project.clipGraphs[clip.clipGraphId];
      const output = action.job.output;
      if (!output) {
        return {
          ...state,
          ui: appendWorkflowLog(state.ui, "World generation failed: no output artifacts."),
        };
      }

      const worldId = makeId("world");
      const imageNodeId = makeId("node-image");
      const promptNodeId = makeId("node-prompt");
      const trajectoryNodeId =
        clip.cameraPathNodeId ?? clip.cameraTrajectoryNodeId ?? cameraPathNodeIdForClip(clip.id);
      const worldGenerateNodeId = makeId("node-worldgen");
      const segmentNodeId = makeId("node-segment");
      const memoryNodeId = makeId("node-memory");
      const worldRefNodeId = makeId("node-worldref");

      const draft = state.ui.worldGenDraft;
      const nodes: Record<string, NodeBase> = {
        ...project.nodes,
        [imageNodeId]: createNode(imageNodeId, "Image Source", "ImageSourceNode", "source", {
          path: `uploads/${draft.imageName || "source.png"}`,
          name: draft.imageName || "source.png",
          assetId: `asset-image-${action.job.jobId}`,
        }),
        [promptNodeId]: createNode(promptNodeId, "Prompt", "TextSourceNode", "source", {
          text: draft.prompt,
        }),
        [worldGenerateNodeId]: createNode(
          worldGenerateNodeId,
          "Image To World",
          "ImageToWorldNode",
          "scene",
          { connectorId: "lyra-2.0", jobId: action.job.jobId, status: action.job.status },
        ),
        [segmentNodeId]: createNode(
          segmentNodeId,
          "Generated Segment",
          "GeneratedSegmentNode",
          "scene",
          { path: output.generatedSegmentPath },
        ),
        [memoryNodeId]: createNode(
          memoryNodeId,
          "Spatial Memory",
          "SpatialMemoryNode",
          "scene",
          { path: output.spatialMemoryPath, coverage: output.memoryCoverage },
        ),
        [worldRefNodeId]: createNode(
          worldRefNodeId,
          "World Reference",
          "WorldReferenceNode",
          "scene",
          { worldId, path3dgs: output.visualLayer3dgsPath },
          "shared",
        ),
      };

      if (project.nodes[trajectoryNodeId]) {
        const trajectory = applyTrajectoryToCameraPath(
          project.nodes[trajectoryNodeId].parameters,
          draft.trajectoryLabel,
          clip.durationFrames ?? clip.duration,
        );
        nodes[trajectoryNodeId] = {
          ...project.nodes[trajectoryNodeId],
          kind: "CameraPathNode",
          type: "CameraPathNode",
          name: "Camera Path",
          parameters: { ...project.nodes[trajectoryNodeId].parameters, ...trajectory },
          params: { ...project.nodes[trajectoryNodeId].parameters, ...trajectory },
          updatedAt: now(),
        };
      }

      const worldName = draft.imageName
        ? `${draft.imageName.replace(/\.[^.]+$/, "")} World`
        : `Generated World ${Object.keys(project.worlds).length + 1}`;

      const registeredWorld = registerWorldFromLyraOutput(
        {
          worldId,
          name: worldName,
          description: draft.prompt || "Lyra 2.0 generated world",
          jobId: action.job.jobId,
          nodeIds: {
            sourceImageNodeId: imageNodeId,
            worldGenerateNodeId,
            generatedSegmentNodeId: segmentNodeId,
            spatialMemoryNodeId: memoryNodeId,
          },
        },
        output,
      );
      const { world, assets: nextAssets } = registerWorldAssetPair(
        registeredWorld,
        project.assets ?? {},
      );
      const imageAssetId = `asset-image-${action.job.jobId}`;
      const withImageAssets = registerSourceImageAsset(nextAssets, {
        id: imageAssetId,
        name: draft.imageName || "source.png",
        uri: `uploads/${draft.imageName || "source.png"}`,
      });
      const executionId = `exec-${action.job.jobId}`;
      const packagedProject = persistWorldGeneration(
        {
          ...project,
          nodes,
          assets: withImageAssets,
          worlds: { ...project.worlds, [worldId]: world },
        },
        {
          worldId,
          name: worldName,
          description: draft.prompt || "Lyra 2.0 generated world",
          execution: {
            id: executionId,
            connectorId: "lyra-2.0",
            task: "image_to_world",
            modelVersion: "stub",
            inputAssetIds: [imageAssetId],
            outputAssetIds: [],
            parameters: { jobId: action.job.jobId, prompt: draft.prompt },
            startedAt: now(),
            completedAt: now(),
            status: "completed",
          },
          artifacts: output,
        },
      );

      const newNodeIds = [
        imageNodeId,
        promptNodeId,
        trajectoryNodeId,
        worldGenerateNodeId,
        segmentNodeId,
        memoryNodeId,
        worldRefNodeId,
      ].filter((id) => !graph.nodeIds.includes(id));

      const newEdges = [
        makeEdge(makeId("edge"), imageNodeId, trajectoryNodeId, "input"),
        makeEdge(makeId("edge"), trajectoryNodeId, worldGenerateNodeId, "path"),
        makeEdge(makeId("edge"), promptNodeId, worldGenerateNodeId, "prompt"),
        makeEdge(makeId("edge"), worldGenerateNodeId, segmentNodeId, "output"),
        makeEdge(makeId("edge"), worldGenerateNodeId, memoryNodeId, "update"),
        makeEdge(makeId("edge"), worldGenerateNodeId, worldRefNodeId, "reconstruct"),
      ];

      const nextProject = updateProjectMetadata({
        ...packagedProject,
        nodes,
        clips: {
          ...packagedProject.clips,
          [clip.id]: {
            ...clip,
            linkedWorldId: worldId,
            sourceType: "generated",
            worldMode: "3dgs",
            cameraPathNodeId: trajectoryNodeId,
            cameraTrajectoryNodeId: trajectoryNodeId,
            graphSnapshotId: graph.id,
          },
        },
        clipGraphs: {
          ...project.clipGraphs,
          [graph.id]: {
            ...graph,
            nodeIds: [...graph.nodeIds, ...newNodeIds],
            edges: [...graph.edges, ...newEdges],
            previewFrames: [
              `World: ${worldName}`,
              `Coverage: ${Math.round((output.memoryCoverage ?? 0) * 100)}%`,
              ...graph.previewFrames,
            ],
          },
        },
      });

      return {
        project: nextProject,
        ui: appendWorkflowLog(
          {
            ...state.ui,
            selectedNodeId: worldRefNodeId,
            lyraJob: action.job,
          },
          `World "${worldName}" registered from Lyra job ${action.job.jobId}.`,
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
      const nodeId = clip.cameraPathNodeId ?? cameraPathNodeIdForClip(clip.id);
      const node = project.nodes[nodeId];
      if (!node) {
        return state;
      }
      const nextParams = upsertCameraKeyframe(cameraPathParamsFromNode(node.parameters), {
        frame: action.frame,
        position: action.position,
        rotation: action.rotation,
        focalLengthMm: action.focalLengthMm,
      });
      return runDomainCommand(
        state,
        { type: "UPDATE_NODE_PARAMS", nodeId, patch: { ...nextParams } },
        `Camera keyframe at ${action.frame}f saved to CameraPathNode.`,
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
  const input = buildVideoRenderInput(
    clip,
    graph,
    state.project.nodes,
    world,
    sequence.playhead,
    state.ui.worldGenDraft.prompt,
  );

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

export const EditorStoreProvider = ({ children }: { children: ReactNode }) => {
  const [state, baseDispatch] = useReducer(reducer, undefined, () => {
    if (typeof window === "undefined") {
      return createInitialState();
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createInitialState();
    }
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
        },
        project: loadAndMigrateProject(projectRaw),
      };
    } catch {
      return createInitialState();
    }
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = useCallback((action: EditorAction) => {
    if (action.type === "submit-video-render") {
      void runVideoRenderJob(stateRef.current, action.clipId, baseDispatch);
      return;
    }
    baseDispatch(action);
  }, []);

  useEffect(() => {
    const composed = JSON.stringify({
      project: serializeProject(migrateLoadedProject(state.project)),
      ui: {
        ...state.ui,
        commandBus: emptyCommandBusState(),
        domainJobQueue: createEmptyJobQueue(),
      },
    });
    writeAtomicLocalStorage(STORAGE_KEY, composed);
  }, [state]);

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
