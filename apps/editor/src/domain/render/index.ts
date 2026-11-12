export {
  ALBEDO,
  LIGHT_VECTOR,
  lightDirection,
  shadeByte,
} from "./shading";
export { CameraTakeSource, type CameraFrame, type CameraIntrinsics, type CameraTrajectory } from "./cameraTakeSource";
export { deriveInstanceTable, instanceMembership, instanceTableError, type InstanceMembership } from "./instanceTable";
export {
  instanceMapHash,
  instanceMapRecord,
  renderPassHash,
  renderPassHashInput,
  renderPassHashes,
  upstreamPassHash,
  upstreamPassRecord,
  type AssetRevisionKey,
  type FrameRange,
  type HashContext,
  type RenderPassHashInput,
} from "./passHash";
export { RenderPassRenderer, type RenderPassOutput, type RenderRequest, type RenderResult } from "./RenderPassRenderer";
export {
  PHASE0_ACTOR_A,
  PHASE0_ACTOR_B,
  PHASE0_ASSET_REVISION,
  PHASE0_IDS,
  PHASE0_SEED,
  PHASE0_TABLE,
  phase0Shot,
} from "./phase0Shot";
export {
  defaultRenderPassSpec,
  RENDER_PASS_FORMAT,
  RENDER_PASS_KINDS,
  RENDERER_VERSION,
  renderPassSpecSchema,
  type DepthPass,
  type FramePasses,
  type InstanceIdEntry,
  type InstanceIdPass,
  type NormalPass,
  type RenderPassBuffer,
  type RenderPassFormat,
  type RenderPassKind,
  type RenderPassSpec,
  type RgbPass,
  type WorldPositionPass,
} from "./types";
