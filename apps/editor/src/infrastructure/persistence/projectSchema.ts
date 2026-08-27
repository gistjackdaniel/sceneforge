import { z } from "zod";

const cacheStatusSchema = z.enum(["valid", "invalid", "rendering", "failed"]);
const referenceTypeSchema = z.enum(["shared", "instance", "local"]);
const nodeScopeSchema = z.enum(["clip", "sequence", "project"]);
const edgeKindSchema = z.enum(["data", "reference", "dependency", "control", "temporal"]);
const nodeStatusSchema = z.enum(["clean", "dirty", "running", "failed", "disabled"]);

const portSchema = z.object({
  id: z.string(),
  name: z.string(),
  dataType: z.string(),
  required: z.boolean(),
  multiple: z.boolean(),
});

const graphEdgeSchema = z
  .object({
    id: z.string(),
    sourceNodeId: z.string().optional(),
    sourcePort: z.string().optional(),
    targetNodeId: z.string().optional(),
    targetPort: z.string().optional(),
    kind: edgeKindSchema.optional(),
    label: z.string().optional(),
    source: z.string().optional(),
    target: z.string().optional(),
  })
  .passthrough();

const nodeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    type: z.string().optional(),
    category: z.string(),
    scope: nodeScopeSchema,
    enabled: z.boolean(),
    tags: z.array(z.string()),
    version: z.number(),
    referenceType: z.string(),
    parameters: z.record(z.string(), z.unknown()),
    params: z.record(z.string(), z.unknown()).optional(),
    downstreamNodeIds: z.array(z.string()),
    status: nodeStatusSchema.optional(),
    contentHash: z.string().optional(),
    inputPorts: z.array(portSchema).optional(),
    outputPorts: z.array(portSchema).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const assetSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    uri: z.string(),
    thumbnailUri: z.string().optional(),
    contentHash: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    semanticTags: z.array(z.string()),
    version: z.number(),
    parentVersionId: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const worldSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .passthrough();

const clipSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    start: z.number(),
    end: z.number(),
    duration: z.number(),
    sourceType: z.enum(["empty", "video", "generated"]),
    clipGraphId: z.string(),
    cacheStatus: cacheStatusSchema,
  })
  .passthrough();

const projectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    metrics: z.object({
      editLatencyMs: z.number(),
      regenerationCount: z.number(),
      nodeReuseRate: z.number(),
      cacheHitRate: z.number(),
    }),
    activeSequenceId: z.string(),
    sequences: z.record(z.string(), z.unknown()),
    clips: z.record(z.string(), clipSchema),
    clipGraphs: z.record(z.string(), z.unknown()),
    nodes: z.record(z.string(), nodeSchema),
    references: z.record(z.string(), z.unknown()),
    dependencyMap: z.unknown(),
    worlds: z.record(z.string(), worldSchema),
    assets: z.record(z.string(), assetSchema).optional().default({}),
    caches: z.record(z.string(), z.unknown()),
    connectors: z.record(z.string(), z.unknown()),
    libraryNodeIds: z.array(z.string()),
  })
  .passthrough();

export const projectEnvelopeSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  project: projectSchema,
});

export type ProjectEnvelopeParsed = z.infer<typeof projectEnvelopeSchema>;

export { referenceTypeSchema, nodeScopeSchema, edgeKindSchema, nodeStatusSchema, graphEdgeSchema };
