import { AR } from "js-aruco2";
import { POS } from "js-aruco2/src/posit1.js";
import { Matrix4 } from "three";
import { TRACKING_MARKER } from "../domain/shot/mobileMarker";
import type { MobileCameraSession } from "../domain/shot/mobileSession";

export function createMarkerTracker(edgeMeters: number, width: number, height: number) {
  const focal = Math.max(width, height) / (2 * Math.tan(35 * Math.PI / 180));
  const cx = width / 2;
  const cy = height / 2;
  const intrinsics: NonNullable<MobileCameraSession["intrinsics"]> = { imageSize: [width, height], fx: focal, fy: focal, cx, cy };
  const detector = new AR.Detector({ dictionaryName: TRACKING_MARKER.dictionary, maxHammingDistance: 1 });
  const solver = new POS.Posit(edgeMeters, focal);
  const cameraToWorld = new Matrix4();

  return {
    intrinsics,
    pose(image: ImageData): MobileCameraSession["frames"][number]["pose"] | undefined {
      const marker = detector.detect(image).find(({ id }) => id === TRACKING_MARKER.id);
      if (!marker || marker.corners.length !== 4 || marker.corners.some((corner, index, corners) => {
        const next = corners[(index + 1) % corners.length];
        return Math.hypot(next.x - corner.x, next.y - corner.y) < 24;
      })) return undefined;
      const result = solver.pose(marker.corners.map(({ x, y }) => ({ x: x - cx, y: cy - y })));
      const [r0, r1, r2] = result.bestRotation;
      const [x, y, z] = result.bestTranslation;
      if (!Number.isFinite(result.bestError) || result.bestError < 0 || result.bestError > 4 || !r0 || !r1 || !r2 || !(z > 0)) return undefined;

      // POSIT projects with +Z forward and +Y up. Reflect both Z axes before inverting to a GL camera pose.
      cameraToWorld.set(
        r0[0], r0[1], -r0[2], x,
        r1[0], r1[1], -r1[2], y,
        -r2[0], -r2[1], r2[2], -z,
        0, 0, 0, 1,
      ).invert();
      const transform = cameraToWorld.toArray();
      if (!transform.every(Number.isFinite) || !(transform[14] > 0)) return undefined;
      return { kind: "matrix", transform };
    },
  };
}
