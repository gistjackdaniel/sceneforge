import {
  directionControlsAsList,
  type DirectionChannel,
  type DirectionChannelControl,
  type DirectionChannelControls,
} from "../direction";
import type { PerformanceSourceType } from "../performance";
import type { RenderTask } from "./request";

export type DirectionSupportMode = "unsupported" | "prompt" | "reference" | "exact";

export interface DirectionChannelCapability {
  mode: DirectionSupportMode;
  supportsLock: boolean;
  supportsStrength: boolean;
  supportsMask: boolean;
}

export interface ModelDirectionCapabilities {
  connectorId: string;
  label: string;
  tasks: RenderTask[];
  channels: Record<DirectionChannel, DirectionChannelCapability>;
  performanceSourceTypes: PerformanceSourceType[];
  supportsFrameAccurateCues: boolean;
  supportsEditedAudio: boolean;
}

export interface NegotiatedDirectionChannel {
  channel: DirectionChannel;
  mode: DirectionSupportMode;
  status: "accepted" | "degraded" | "unsupported";
  requested: DirectionChannelControl;
  applied: DirectionChannelControl;
  issues: string[];
}

export interface DirectionCapabilityNegotiation {
  connectorId: string;
  connectorLabel: string;
  channels: NegotiatedDirectionChannel[];
  acceptedPerformanceSourceTypes: PerformanceSourceType[];
  rejectedPerformanceSourceTypes: PerformanceSourceType[];
  frameAccurateCues: "accepted" | "degraded" | "unused";
  editedAudio: "accepted" | "degraded" | "unused";
  warnings: string[];
}

export interface DirectionNegotiationContext {
  performanceSourceTypes: PerformanceSourceType[];
  hasFrameAccurateCues: boolean;
  hasEditedAudio: boolean;
}

/**
 * Negotiate authored intent against a model connector without mutating the authored plan.
 * The applied controls are safe to send to the backend; every downgrade remains explicit.
 */
export const negotiateDirectionCapabilities = (
  controls: DirectionChannelControls,
  capabilities: ModelDirectionCapabilities,
  context: DirectionNegotiationContext,
): DirectionCapabilityNegotiation => {
  const warnings: string[] = [];
  const channels = directionControlsAsList(controls).map((requested): NegotiatedDirectionChannel => {
    const support = capabilities.channels[requested.channel];
    const issues: string[] = [];
    if (support.mode === "unsupported") {
      issues.push(`${requested.channel} is not supported by ${capabilities.label}.`);
      warnings.push(...issues);
      return {
        channel: requested.channel,
        mode: support.mode,
        status: "unsupported",
        requested,
        applied: { channel: requested.channel, locked: false, strength: 0 },
        issues,
      };
    }

    let applied: DirectionChannelControl = { ...requested };
    if (requested.locked && !support.supportsLock) {
      applied = { ...applied, locked: false };
      issues.push(`${requested.channel} lock will be approximated.`);
    }
    if (!support.supportsStrength && requested.strength !== 1) {
      applied = { ...applied, strength: 1 };
      issues.push(`${requested.channel} strength is not adjustable.`);
    }
    if (requested.mask && !support.supportsMask) {
      applied = { ...applied, mask: undefined };
      issues.push(`${requested.channel} mask is not supported.`);
    }
    warnings.push(...issues);
    return {
      channel: requested.channel,
      mode: support.mode,
      status: issues.length > 0 ? "degraded" : "accepted",
      requested,
      applied,
      issues,
    };
  });

  const requestedTypes = Array.from(new Set(context.performanceSourceTypes));
  const acceptedPerformanceSourceTypes = requestedTypes.filter((type) =>
    capabilities.performanceSourceTypes.includes(type),
  );
  const rejectedPerformanceSourceTypes = requestedTypes.filter(
    (type) => !capabilities.performanceSourceTypes.includes(type),
  );
  rejectedPerformanceSourceTypes.forEach((type) => {
    warnings.push(`${capabilities.label} does not accept ${type} performance sources.`);
  });

  const frameAccurateCues = context.hasFrameAccurateCues
    ? capabilities.supportsFrameAccurateCues
      ? "accepted"
      : "degraded"
    : "unused";
  if (frameAccurateCues === "degraded") {
    warnings.push(`${capabilities.label} will approximate frame-accurate performance cues.`);
  }
  const editedAudio = context.hasEditedAudio
    ? capabilities.supportsEditedAudio
      ? "accepted"
      : "degraded"
    : "unused";
  if (editedAudio === "degraded") {
    warnings.push(`${capabilities.label} cannot consume the edited audio guide directly.`);
  }

  return {
    connectorId: capabilities.connectorId,
    connectorLabel: capabilities.label,
    channels,
    acceptedPerformanceSourceTypes,
    rejectedPerformanceSourceTypes,
    frameAccurateCues,
    editedAudio,
    warnings,
  };
};

