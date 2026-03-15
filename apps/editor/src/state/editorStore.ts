import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { RenderCacheEntry } from "../core/cache/types";
import type { DependencyMap } from "../core/clipgraph/types";
import type { NodeBase, NodeCategory, NodeEdge, NodeKind } from "../core/nodes/types";
import { deserializeProject, serializeProject } from "../core/project/serialization";
import type {
  ExternalConnector,
  PerformanceMetrics,
  Project,
  Sequence,
  TimelineClip,
} from "../core/project/types";
import type { NodeReference, ReferenceType } from "../core/references/types";
import type { WorldAsset, WorldMode } from "../core/world/types";

const STORAGE_KEY = "sceneforge-editor-state";

type PanelTab = "inspector" | "library" | "chat";

interface EditorUiState {
  selectedClipId: string;
  selectedNodeId: string;
  selectedLibraryNodeId?: string;
  panelTab: PanelTab;
  playback: "stopped" | "playing";
  workflowLog: string[];
  highlightedNodeIds: string[];
}

export interface EditorState {
  project: Project;
  ui: EditorUiState;
}

type EditorAction =
  | { type: "add-empty-clip" }
  | { type: "select-clip"; clipId: string }
  | { type: "select-node"; nodeId: string }
  | { type: "set-panel-tab"; tab: PanelTab }
  | { type: "scrub-playhead"; playhead: number }
  | { type: "trim-clip"; clipId: string; duration: number }
  | { type: "set-world"; clipId: string; worldId: string; worldMode: WorldMode }
  | { type: "apply-shot-preset"; clipId: string; preset: "WS" | "MS" | "CU" | "OTS" }
  | { type: "set-camera-rig"; clipId: string; rig: "dolly" | "handheld" | "crane" | "orbit" | "shoulder" }
  | { type: "set-lighting-rig"; clipId: string; rig: "3-point" | "sunset" | "neon" | "interior practical" }
  | { type: "capture-keyframe"; clipId: string }
  | { type: "update-node-parameter"; nodeId: string; key: string; value: unknown }
  | { type: "set-reference-type"; referenceId: string; referenceType: ReferenceType }
  | { type: "add-library-reference"; clipId: string; libraryNodeId: string; referenceType: ReferenceType }
  | { type: "break-link"; referenceId: string }
  | { type: "reveal-references"; nodeId: string }
  | { type: "render-proxy"; clipId: string }
  | { type: "render-final"; clipId: string }
  | { type: "toggle-playback" }
  | { type: "run-connector"; connectorId: string; clipId: string }
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

const createExampleWorld = (): WorldAsset => ({
  id: "world-apartment-livingroom",
  name: "Apartment Livingroom",
  description: "예제 로케이션. single-location previs용 거실 월드.",
  usdPath: "worlds/apartment_livingroom/world.usda",
  semanticsPath: "worlds/apartment_livingroom/semantics.json",
  navmeshPath: "worlds/apartment_livingroom/navmesh.bin",
  previewPath: "worlds/apartment_livingroom/preview.glb",
  proxyKind: "usd",
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

const createLibraryNodes = (): NodeBase[] => {
  const baseTime = now();
  return [
    {
      id: "lib-lens-50mm",
      name: "Standard 50mm Lens",
      kind: "LensNode",
      category: "library",
      scope: "project",
      enabled: true,
      tags: ["lens", "standard"],
      version: 1,
      referenceType: "copy",
      parameters: { focalLength: 50, sensorPreset: "full-frame", dof: "medium" },
      downstreamNodeIds: [],
      createdAt: baseTime,
      updatedAt: baseTime,
    },
    {
      id: "lib-light-sunset",
      name: "Sunset Lighting Rig",
      kind: "LightingRigNode",
      category: "library",
      scope: "project",
      enabled: true,
      tags: ["light", "sunset"],
      version: 1,
      referenceType: "copy",
      parameters: { preset: "sunset", intensity: 0.76, direction: "window" },
      downstreamNodeIds: [],
      createdAt: baseTime,
      updatedAt: baseTime,
    },
    {
      id: "lib-look-cool",
      name: "Cool Interior Look",
      kind: "ColorGradeNode",
      category: "library",
      scope: "project",
      enabled: true,
      tags: ["look", "grade"],
      version: 1,
      referenceType: "copy",
      parameters: { temperature: -8, contrast: 0.16, saturation: 0.9 },
      downstreamNodeIds: [],
      createdAt: baseTime,
      updatedAt: baseTime,
    },
  ];
};

const createNode = (
  id: string,
  name: string,
  kind: NodeKind,
  category: NodeCategory,
  parameters: Record<string, unknown>,
  referenceType: ReferenceType = "copy",
): NodeBase => ({
  id,
  name,
  kind,
  category,
  scope: "clip",
  enabled: true,
  tags: [],
  version: 1,
  referenceType,
  parameters,
  downstreamNodeIds: [],
  createdAt: now(),
  updatedAt: now(),
});

const createClipNodes = (clipId: string, worldId?: string): NodeBase[] => [
  createNode(
    `node-${clipId}-clip`,
    "Timeline Clip Root",
    "TimelineClipNode",
    "capture",
    { clipId, linkedWorldId: worldId, worldMode: worldId ? "referenced" : undefined },
  ),
  createNode(`node-${clipId}-source`, "Source Stub", "ImageSourceNode", "source", {
    sourceType: "empty",
    label: "Empty clip stub",
  }),
  createNode(`node-${clipId}-render`, "Render Stub", "RenderSettingsNode", "render", {
    quality: "proxy",
    renderer: "SceneForge Preview",
  }),
];

const createClipEdges = (clipId: string): NodeEdge[] => [
  {
    id: `edge-${clipId}-source-to-render`,
    source: `node-${clipId}-source`,
    target: `node-${clipId}-render`,
    label: "feeds",
  },
  {
    id: `edge-${clipId}-clip-to-render`,
    source: `node-${clipId}-clip`,
    target: `node-${clipId}-render`,
    label: "contains",
  },
];

const buildDependencyMap = (
  nodes: Record<string, NodeBase>,
  clips: Record<string, TimelineClip>,
  references: Record<string, NodeReference>,
  clipGraphs: Project["clipGraphs"],
): DependencyMap => {
  const downstreamByNodeId: Record<string, string[]> = {};
  const clipsByNodeId: Record<string, string[]> = {};
  const referencesByNodeId: Record<string, string[]> = {};

  Object.values(nodes).forEach((node) => {
    downstreamByNodeId[node.id] = [...node.downstreamNodeIds];
  });

  Object.values(clipGraphs).forEach((graph) => {
    graph.nodeIds.forEach((nodeId) => {
      if (!clipsByNodeId[nodeId]) {
        clipsByNodeId[nodeId] = [];
      }
      clipsByNodeId[nodeId].push(graph.clipId);
    });
  });

  Object.values(references).forEach((reference) => {
    if (!referencesByNodeId[reference.sourceNodeId]) {
      referencesByNodeId[reference.sourceNodeId] = [];
    }
    if (!referencesByNodeId[reference.targetNodeId]) {
      referencesByNodeId[reference.targetNodeId] = [];
    }
    referencesByNodeId[reference.sourceNodeId].push(reference.id);
    referencesByNodeId[reference.targetNodeId].push(reference.id);
  });

  return { downstreamByNodeId, clipsByNodeId, referencesByNodeId };
};

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
  status: "ready",
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
    start: 0,
    end: 120,
    duration: 120,
    sourceType: "empty",
    linkedWorldId: world.id,
    clipGraphId: graphId,
    worldMode: "referenced",
    variant: "main",
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
      overrides: { clipId },
    },
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
    dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {} },
    worlds: { [world.id]: world },
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
      panelTab: "inspector",
      playback: "stopped",
      workflowLog: [
        "Timeline-first editor shell initialized.",
        "Apartment Livingroom world loaded as reference.",
      ],
      highlightedNodeIds: [],
    },
  };
};

const cloneNode = (node: NodeBase, overrides?: Record<string, unknown>): NodeBase => ({
  ...node,
  id: makeId("node-clone"),
  scope: "clip",
  referenceType: "copy",
  version: 1,
  createdAt: now(),
  updatedAt: now(),
  parameters: { ...node.parameters, ...overrides },
  downstreamNodeIds: [...node.downstreamNodeIds],
});

const invalidateCachesForNode = (project: Project, nodeId: string): Project => {
  const affectedClips = new Set(project.dependencyMap.clipsByNodeId[nodeId] ?? []);
  const downstream = project.dependencyMap.downstreamByNodeId[nodeId] ?? [];
  downstream.forEach((downstreamNodeId) => {
    (project.dependencyMap.clipsByNodeId[downstreamNodeId] ?? []).forEach((clipId) => {
      affectedClips.add(clipId);
    });
  });

  const caches = { ...project.caches };
  Object.values(caches).forEach((cache) => {
    if (!cache.clipId || !affectedClips.has(cache.clipId)) {
      return;
    }
    caches[cache.id] = {
      ...cache,
      status: "stale",
      updatedAt: now(),
      invalidatedByNodeIds: Array.from(new Set([...cache.invalidatedByNodeIds, nodeId])),
    };
  });

  return {
    ...project,
    caches,
    metrics: {
      ...project.metrics,
      regenerationCount: project.metrics.regenerationCount + 1,
    },
  };
};

const updateProjectMetadata = (project: Project): Project => ({
  ...project,
  updatedAt: now(),
  dependencyMap: buildDependencyMap(project.nodes, project.clips, project.references, project.clipGraphs),
});

const appendWorkflowLog = (ui: EditorUiState, message: string): EditorUiState => ({
  ...ui,
  workflowLog: [message, ...ui.workflowLog].slice(0, 12),
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
        start: activeSequence.visibleRange[1] + 12,
        end: activeSequence.visibleRange[1] + 132,
        duration: 120,
        sourceType: "empty",
        clipGraphId: graphId,
        variant: "main",
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
    case "select-clip": {
      const clip = project.clips[action.clipId];
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedClipId: action.clipId,
          selectedNodeId: `node-${clip.id}-clip`,
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
      const nextProject = updateProjectMetadata({
        ...project,
        clips: {
          ...project.clips,
          [clip.id]: { ...clip, duration: action.duration, end: clip.start + action.duration },
        },
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(state.ui, `${clip.name} trimmed to ${action.duration}f.`),
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
              ...createNode(worldRefNodeId, "World Reference", "WorldRefNode", "scene", {
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
      const nextEdges = graph.edges.some((edge) => edge.source === worldRefNodeId)
        ? graph.edges
        : [
            ...graph.edges,
            {
              id: makeId("edge-world"),
              source: worldRefNodeId,
              target: `node-${clip.id}-render`,
              label: "references",
            },
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
        edges: graph.edges.some((edge) => edge.source === nodeId)
          ? graph.edges
          : [
              ...graph.edges,
              {
                id: makeId("edge-shot"),
                source: nodeId,
                target: `node-${action.clipId}-render`,
                label: "frames",
              },
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
                edges: graph.edges.some((edge) => edge.source === nodeId)
                  ? graph.edges
                  : [
                      ...graph.edges,
                      {
                        id: makeId("edge-camera"),
                        source: nodeId,
                        target: `node-${action.clipId}-render`,
                        label: "captures",
                      },
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
                edges: graph.edges.some((edge) => edge.source === nodeId)
                  ? graph.edges
                  : [
                      ...graph.edges,
                      {
                        id: makeId("edge-light"),
                        source: nodeId,
                        target: `node-${action.clipId}-render`,
                        label: "lights",
                      },
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
      });
      keyframeNode.downstreamNodeIds = [`node-${clip.id}-render`];
      const nextProject = updateProjectMetadata(
        invalidateCachesForNode(
          {
            ...project,
            nodes: { ...project.nodes, [keyframeId]: keyframeNode },
            clipGraphs: {
              ...project.clipGraphs,
              [graph.id]: {
                ...graph,
                nodeIds: [...graph.nodeIds, keyframeId],
                keyframeNodeIds: [...graph.keyframeNodeIds, keyframeId],
                edges: [
                  ...graph.edges,
                  {
                    id: makeId("edge-keyframe"),
                    source: keyframeId,
                    target: `node-${clip.id}-render`,
                    label: "samples",
                  },
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
      const nextProject = updateProjectMetadata(
        invalidateCachesForNode(
          {
            ...project,
            nodes: {
              ...project.nodes,
              [node.id]: {
                ...node,
                parameters: { ...node.parameters, [action.key]: action.value },
                updatedAt: now(),
              },
            },
          },
          node.id,
        ),
      );
      return {
        project: nextProject,
        ui: appendWorkflowLog(state.ui, `${node.name} parameter ${action.key} updated.`),
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
                  {
                    id: makeId("edge-library"),
                    source: localNode.id,
                    target: `node-${clip.id}-render`,
                    label: "styles",
                  },
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
    case "break-link": {
      const reference = project.references[action.referenceId];
      const targetNode = project.nodes[reference.targetNodeId];
      const nextProject = updateProjectMetadata({
        ...project,
        nodes: {
          ...project.nodes,
          [targetNode.id]: {
            ...targetNode,
            referenceType: "copy",
            updatedAt: now(),
          },
        },
        references: Object.fromEntries(
          Object.entries(project.references).filter(([id]) => id !== action.referenceId),
        ),
      });
      return {
        project: nextProject,
        ui: appendWorkflowLog(state.ui, `Reference ${action.referenceId} broken into local copy.`),
      };
    }
    case "reveal-references": {
      const related = project.dependencyMap.referencesByNodeId[action.nodeId] ?? [];
      return {
        ...state,
        ui: appendWorkflowLog(
          { ...state.ui, highlightedNodeIds: [action.nodeId] },
          `Reveal references for ${action.nodeId}: ${related.length} link(s).`,
        ),
      };
    }
    case "render-proxy": {
      const clip = project.clips[action.clipId];
      const graph = project.clipGraphs[clip.clipGraphId];
      const previewText = graph.nodeIds
        .map((nodeId) => project.nodes[nodeId]?.name)
        .filter(Boolean)
        .join(" -> ");
      const cacheEntry = createCacheEntry(`${clip.name} Proxy`, "proxy", clip.id, previewText);
      const nextProject = updateProjectMetadata({
        ...project,
        clips: {
          ...project.clips,
          [clip.id]: { ...clip, proxyCacheId: cacheEntry.id },
        },
        caches: { ...project.caches, [cacheEntry.id]: cacheEntry },
        clipGraphs: {
          ...project.clipGraphs,
          [graph.id]: {
            ...graph,
            previewFrames: [
              `Proxy: ${previewText}`,
              `Playhead ${activeSequence.playhead}f synced`,
            ],
            proxyCacheId: cacheEntry.id,
          },
        },
      });
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
          [clip.id]: { ...clip, finalCacheId: cacheEntry.id },
        },
        caches: { ...project.caches, [cacheEntry.id]: cacheEntry },
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
    default:
      return state;
  }
};

export const EditorStoreProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    if (typeof window === "undefined") {
      return createInitialState();
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createInitialState();
    }
    try {
      const parsed = JSON.parse(raw) as { project: string | Project; ui: EditorUiState };
      return {
        ui: parsed.ui,
        project:
          typeof parsed.project === "string" ? deserializeProject(parsed.project) : parsed.project,
      };
    } catch {
      return createInitialState();
    }
  });

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        project: serializeProject(state.project),
        ui: state.ui,
      }),
    );
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
};

export const useEditorStore = () => {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditorStore must be used within EditorStoreProvider");
  }
  return context;
};
