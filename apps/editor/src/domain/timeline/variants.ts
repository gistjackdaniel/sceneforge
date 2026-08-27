import type { TimelineClip, ClipVariant } from "./types";

const MAIN_VARIANT_ID = "main";

export const ensureClipVariants = (clip: TimelineClip): TimelineClip => {
  if (clip.variants && clip.variants.length > 0) {
    return {
      ...clip,
      activeVariantId: clip.activeVariantId ?? clip.variants[0].id,
    };
  }
  const main: ClipVariant = {
    id: MAIN_VARIANT_ID,
    name: clip.variant ?? "Main",
    overridePatch: {},
  };
  return {
    ...clip,
    variants: [main],
    activeVariantId: clip.activeVariantId ?? MAIN_VARIANT_ID,
  };
};

/**
 * Clip Variant is an override layer — never clone the clip graph (PRD §10.3).
 */
export const createClipVariant = (
  clip: TimelineClip,
  variantId: string,
  name: string,
  overridePatch: Record<string, unknown> = {},
): TimelineClip => {
  const withVariants = ensureClipVariants(clip);
  if (withVariants.variants!.some((variant) => variant.id === variantId)) {
    return setActiveVariant(withVariants, variantId);
  }
  return {
    ...withVariants,
    variants: [...withVariants.variants!, { id: variantId, name, overridePatch }],
    activeVariantId: variantId,
  };
};

export const setActiveVariant = (clip: TimelineClip, variantId: string): TimelineClip => {
  const withVariants = ensureClipVariants(clip);
  const exists = withVariants.variants!.some((variant) => variant.id === variantId);
  return {
    ...withVariants,
    activeVariantId: exists ? variantId : withVariants.activeVariantId,
  };
};

export const activeVariantPatch = (clip: TimelineClip): Record<string, unknown> => {
  const withVariants = ensureClipVariants(clip);
  const active = withVariants.variants!.find((variant) => variant.id === withVariants.activeVariantId);
  return active?.overridePatch ?? {};
};
