export {
  CURRENT_ENVELOPE_VERSION,
  deserializeProject,
  ProjectPersistenceError,
  serializeProject,
  type ProjectEnvelopeV2,
} from "../../infrastructure/persistence/serializeProject";

/** @deprecated Use ProjectEnvelopeV2 */
export type ProjectEnvelope = {
  version: 1 | 2;
  project: import("../../domain/project/types").Project;
};
