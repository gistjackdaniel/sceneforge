import { z } from "zod";
import { hashNormalized } from "./hash";
import { persistentInstanceIdSchema, productionSelectorSchema } from "./selector";

/**
 * Asset revision contract shared with the World lane.
 * `assetId` is `WorldAsset.id`. `instanceId` is the optional invalidation unit.
 */
export const assetRevisionSchema = z.object({
  assetId: z.string().min(1),
  revisionId: z.string().min(1),
  instanceId: persistentInstanceIdSchema.optional(),
});

export type AssetRevision = z.infer<typeof assetRevisionSchema>;

/** Four dependency keys recorded on every node output (architecture §4.1). */
export const dependencyFingerprintSchema = z.object({
  assetRevision: assetRevisionSchema,
  modelVersion: z.string().min(1),
  seed: z.number().int(),
  passHash: z.string().min(1),
});

export type DependencyFingerprint = z.infer<typeof dependencyFingerprintSchema>;

export const fingerprintKeySchema = z.enum(["assetRevision", "modelVersion", "seed", "passHash"]);
export type FingerprintKey = z.infer<typeof fingerprintKeySchema>;

export const outputConstraintSchema = z.enum(["hard_locked", "geometry_locked", "generative"]);
export type OutputConstraint = z.infer<typeof outputConstraintSchema>;

/** Provenance stored with a node output after it is computed. */
export const productionOutputSchema = z.object({
  outputId: z.string().min(1),
  nodeId: z.string().min(1),
  cacheId: z.string().min(1),
  selector: productionSelectorSchema,
  fingerprint: dependencyFingerprintSchema,
  constraint: outputConstraintSchema.default("generative"),
  computedAt: z.string().min(1),
});

export type ProductionOutput = z.infer<typeof productionOutputSchema>;

export type OutputProvenanceStore = Record<string, ProductionOutput>;

export interface InputIssue {
  path: string;
  message: string;
}

export const issuesFromZod = (error: z.ZodError): InputIssue[] =>
  error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

/** Hash a render-pass payload with the shared key-sorted serialization. */
export const computePassHash = (pass: unknown): string => hashNormalized(pass);

export const buildDependencyFingerprint = (input: {
  assetId: string;
  revisionId: string;
  instanceId?: string;
  modelVersion: string;
  seed: number;
  pass: unknown;
}): DependencyFingerprint =>
  dependencyFingerprintSchema.parse({
    assetRevision: {
      assetId: input.assetId,
      revisionId: input.revisionId,
      ...(input.instanceId ? { instanceId: input.instanceId } : {}),
    },
    modelVersion: input.modelVersion,
    seed: input.seed,
    passHash: computePassHash(input.pass),
  });

const revisionLabel = (revision: AssetRevision): string => `${revision.assetId}@${revision.revisionId}`;

const assetRevisionsEqual = (left: AssetRevision, right: AssetRevision): boolean =>
  left.assetId === right.assetId &&
  left.revisionId === right.revisionId &&
  (left.instanceId ?? undefined) === (right.instanceId ?? undefined);

export interface FingerprintChange {
  key: FingerprintKey;
  previous: DependencyFingerprint[FingerprintKey];
  current: DependencyFingerprint[FingerprintKey];
  reason: string;
}

const describeAssetRevisionChange = (previous: AssetRevision, current: AssetRevision): string => {
  const parts: string[] = [];
  if (previous.assetId !== current.assetId || previous.revisionId !== current.revisionId) {
    parts.push(`${revisionLabel(previous)}에서 ${revisionLabel(current)}로`);
  }
  if ((previous.instanceId ?? undefined) !== (current.instanceId ?? undefined)) {
    parts.push(
      `instance ${previous.instanceId ?? "없음"}에서 ${current.instanceId ?? "없음"}로`,
    );
  }
  return `asset revision이 바뀌었습니다: ${parts.join(", ")}.`;
};

/**
 * Diff the four dependency keys. Equal fingerprints return an empty list.
 * No cache is touched.
 */
export const diffFingerprint = (
  previous: DependencyFingerprint,
  current: DependencyFingerprint,
): FingerprintChange[] => {
  const changes: FingerprintChange[] = [];
  if (!assetRevisionsEqual(previous.assetRevision, current.assetRevision)) {
    changes.push({
      key: "assetRevision",
      previous: previous.assetRevision,
      current: current.assetRevision,
      reason: describeAssetRevisionChange(previous.assetRevision, current.assetRevision),
    });
  }
  if (previous.modelVersion !== current.modelVersion) {
    changes.push({
      key: "modelVersion",
      previous: previous.modelVersion,
      current: current.modelVersion,
      reason: `model version이 ${previous.modelVersion}에서 ${current.modelVersion}로 바뀌었습니다.`,
    });
  }
  if (previous.seed !== current.seed) {
    changes.push({
      key: "seed",
      previous: previous.seed,
      current: current.seed,
      reason: `seed가 ${previous.seed}에서 ${current.seed}로 바뀌었습니다.`,
    });
  }
  if (previous.passHash !== current.passHash) {
    changes.push({
      key: "passHash",
      previous: previous.passHash,
      current: current.passHash,
      reason: `pass hash가 ${previous.passHash}에서 ${current.passHash}로 바뀌었습니다.`,
    });
  }
  return changes;
};

export interface OutdatedOutput {
  outputId: string;
  nodeId: string;
  outdated: true;
  changes: FingerprintChange[];
}

export type OutdatedDetection =
  | { ok: true; outdated: OutdatedOutput[]; freshOutputIds: string[] }
  | { ok: false; error: "invalid_input"; issues: InputIssue[] };

/**
 * Compare each recorded output fingerprint with the keys that would be used now.
 * A node is outdated when any of the four keys differ. The result names the key
 * and the previous and current values. Does not mutate caches.
 */
export const detectOutdatedOutputs = (
  recorded: OutputProvenanceStore,
  currentByOutputId: Record<string, unknown>,
): OutdatedDetection => {
  const issues: InputIssue[] = [];
  const parsedCurrent = new Map<string, DependencyFingerprint>();

  Object.entries(recorded).forEach(([outputId]) => {
    if (!(outputId in currentByOutputId)) {
      issues.push({ path: outputId, message: "현재 의존성 키가 없습니다." });
      return;
    }
    const parsed = dependencyFingerprintSchema.safeParse(currentByOutputId[outputId]);
    if (!parsed.success) {
      issues.push(
        ...issuesFromZod(parsed.error).map((issue) => ({
          path: issue.path ? `${outputId}.${issue.path}` : outputId,
          message: issue.message,
        })),
      );
      return;
    }
    parsedCurrent.set(outputId, parsed.data);
  });

  if (issues.length > 0) {
    return { ok: false, error: "invalid_input", issues };
  }

  const outdated: OutdatedOutput[] = [];
  const freshOutputIds: string[] = [];
  Object.values(recorded).forEach((output) => {
    const current = parsedCurrent.get(output.outputId);
    if (!current) {
      return;
    }
    const changes = diffFingerprint(output.fingerprint, current);
    if (changes.length === 0) {
      freshOutputIds.push(output.outputId);
      return;
    }
    outdated.push({
      outputId: output.outputId,
      nodeId: output.nodeId,
      outdated: true,
      changes,
    });
  });

  return { ok: true, outdated, freshOutputIds };
};

/**
 * Record the fingerprint used the last time this output was computed.
 * Invalid payloads are returned as issues and the store is left unchanged.
 */
export const recordComputedOutput = (
  store: OutputProvenanceStore,
  input: unknown,
): { ok: true; store: OutputProvenanceStore; output: ProductionOutput } | { ok: false; issues: InputIssue[] } => {
  const parsed = productionOutputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: issuesFromZod(parsed.error) };
  }
  return {
    ok: true,
    output: parsed.data,
    store: { ...store, [parsed.data.outputId]: parsed.data },
  };
};
