import {
  DEFAULT_HANDEDNESS,
  SCENE_COORDINATE_CONTRACT,
  applyImportTransform,
  buildImportTransform,
  defaultFrontAxis,
  type Mat4,
} from "../worlds/coordinates";
import { eulerToQuaternion } from "./eulerAdapter";
import { generateHash, hasSelectedTake, selectedTake } from "./queries";
import type { CanonicalPlacement, EnvironmentView, GenerateBlocker, Shot, ShotModelInput, Transform } from "./types";

export type PreparedInput =
  | { ok: true; input: ShotModelInput }
  | { ok: false; blocker: GenerateBlocker };

const proxy = (representation: string) =>
  representation === "image_based_proxy" || representation === "video_based_proxy";

const canonicalPlacement = (placement: Transform): CanonicalPlacement => ({
  translation: placement.position,
  rotation: eulerToQuaternion(placement.rotationEuler),
  scale: placement.scale,
});

/**
 * Map a world source file into the canonical scene.
 * A Y-up, meter, right-handed, +Z source is already canonical and returns undefined.
 * `frontAxis` and `handedness` on the source are used when present.
 * Missing axes fall back to right-handed and `defaultFrontAxis` (`+Z`, or `-Y` when Z-up).
 * The stored shot is not rewritten.
 */
export const environmentImportTransform = (
  environment: Pick<EnvironmentView, "coordinateSystem" | "unitScaleMeters" | "handedness" | "frontAxis">,
): Mat4 | undefined => {
  const upAxis = environment.coordinateSystem === "Z_UP" ? "Z" : "Y";
  const meters = environment.unitScaleMeters > 0 ? environment.unitScaleMeters : 1;
  const handedness = environment.handedness ?? DEFAULT_HANDEDNESS;
  const frontAxis = environment.frontAxis ?? defaultFrontAxis(environment.coordinateSystem);
  if (upAxis === "Y" && meters === 1 && handedness === "right" && frontAxis === "+Z") return undefined;
  return buildImportTransform({ upAxis, handedness, frontAxis, metersPerUnit: meters });
};

export { applyImportTransform };

/** Assembles the one model payload. Geometry failures stay here so the button can follow the selected take. */
export const prepareModelInput = (shot: Shot, environment: EnvironmentView | undefined, outputAspect: string): PreparedInput => {
  if (!hasSelectedTake(shot)) {
    return { ok: false, blocker: { code: "no_selected_take", message: "카메라 테이크를 먼저 선택하세요." } };
  }
  if (environment && proxy(environment.representation)) {
    return { ok: false, blocker: { code: "proxy_world", message: "이미지·비디오 프록시 월드는 생성에 쓸 수 없습니다." } };
  }
  const posed = shot.subjects.filter((subject) => subject.kind !== "light" && subject.motion.channel !== "unset");
  const markerOnly = posed.length > 0 && posed.every((subject) => subject.kind !== "light" && subject.representation === "marker");
  if (markerOnly && !environment?.geometryUri) {
    return { ok: false, blocker: { code: "marker_only", message: "마커만 있고 월드 지오메트리가 없어 생성할 수 없습니다." } };
  }
  const take = selectedTake(shot);
  if (!take) return { ok: false, blocker: { code: "no_selected_take", message: "카메라 테이크를 먼저 선택하세요." } };
  const importTransform = environment ? environmentImportTransform(environment) : undefined;
  return {
    ok: true,
    input: {
      schemaVersion: 2,
      source: "editable_scene",
      rasterKeyframes: "forbidden",
      shotId: shot.id,
      time: shot.time,
      coordinateContract: shot.coordinateContract ?? SCENE_COORDINATE_CONTRACT,
      outputAspect,
      subjects: shot.subjects.map((subject) => subject.kind === "light"
        ? { id: subject.id, assetId: subject.assetId, kind: "light" as const, uri: subject.uri, placement: subject.placement, canonicalPlacement: canonicalPlacement(subject.placement), intensity: subject.intensity, color: subject.color }
        : { id: subject.id, assetId: subject.assetId, kind: subject.kind, uri: subject.uri, placement: subject.placement, canonicalPlacement: canonicalPlacement(subject.placement), motion: subject.motion }),
      camera: { takeId: take.id, interpolation: shot.camera.interpolation, keys: take.keys, lens: shot.camera.lens },
      environment: environment?.geometryUri
        ? {
            worldId: environment.worldId,
            geometryUri: environment.geometryUri,
            coordinateSystem: environment.coordinateSystem,
            unitScaleMeters: environment.unitScaleMeters,
            ...(importTransform ? { importTransform } : {}),
          }
        : undefined,
      recipe: { generateHash: generateHash(shot) },
    },
  };
};
