import type { CameraPathParams, CameraKeyframe } from "../graph/cameraPath";

/** Heuristics to suggest a natural-language camera movement from a camera path. */
export class CameraMovementDescriber {
  /**
   * Suggest a brief camera movement description.
   * - static: no or tiny motion
   * - dolly in/out: dominant Z motion along view direction
   * - pan left/right: dominant yaw change without large translation
   * - crane up/down: dominant Y translation
   * - orbit: position roughly constant radius, large yaw around a target
   */
  static describe(params: CameraPathParams): string {
    const keys = params.keyframes ?? [];
    if (keys.length < 2) return "static camera";
    const deltas = CameraMovementDescriber.computeDeltas(keys);
    const dist = deltas.totalDistance;
    const yaw = deltas.totalYawDeg;
    const pitch = deltas.totalPitchDeg;
    const radiusVar = deltas.radiusVariance;

    if (dist < 0.05 && Math.abs(yaw) < 5) return "static camera";
    // Crane: vertical displacement dominates
    if (deltas.totalUpDown > dist * 0.6) return deltas.netUpDown > 0 ? "crane up" : "crane down";
    // Pan: angular change dominates with little translation
    if (Math.abs(yaw) > 20 && dist < 0.5) return yaw > 0 ? "pan left" : "pan right";
    // Orbit: radius roughly constant but yaw large
    if (radiusVar < 0.1 && Math.abs(yaw) > 45) return yaw > 0 ? "orbit left" : "orbit right";
    // Dolly: forward/backward translation dominates
    if (deltas.netForwardBack > Math.abs(deltas.netLeftRight) && Math.abs(deltas.netForwardBack) > 0.3) {
      return deltas.netForwardBack < 0 ? "dolly in" : "dolly out";
    }
    // Fallback: move with pan
    if (Math.abs(yaw) > 15 && dist > 0.5) return yaw > 0 ? "move with pan left" : "move with pan right";
    if (dist > 0.5) return "moving camera";
    return "subtle camera move";
  }

  private static computeDeltas(keys: CameraKeyframe[]): {
    totalDistance: number;
    netForwardBack: number;
    netLeftRight: number;
    totalUpDown: number;
    netUpDown: number;
    totalYawDeg: number;
    totalPitchDeg: number;
    radiusVariance: number;
  } {
    let totalDistance = 0;
    let netFB = 0;
    let netLR = 0;
    let totalUD = 0;
    let netUD = 0;
    let totalYaw = 0;
    let totalPitch = 0;
    const radii: number[] = [];

    const yawFromQuat = (q: [number, number, number, number]): number => {
      const [x, y, z, w] = q;
      const siny_cosp = 2 * (w * y + z * x);
      const cosy_cosp = 1 - 2 * (y * y + x * x);
      return (Math.atan2(siny_cosp, cosy_cosp) * 180) / Math.PI;
    };
    const pitchFromQuat = (q: [number, number, number, number]): number => {
      const [x, y, z, w] = q;
      const sinp = 2 * (w * x - z * y);
      const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
      return (pitch * 180) / Math.PI;
    };

    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1];
      const b = keys[i];
      const dx = b.position[0] - a.position[0];
      const dy = b.position[1] - a.position[1];
      const dz = b.position[2] - a.position[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      totalDistance += d;
      netLR += dx;
      netUD += dy;
      netFB += dz;
      totalUD += Math.abs(dy);
      const yawA = yawFromQuat(a.rotation);
      const yawB = yawFromQuat(b.rotation);
      const pitchA = pitchFromQuat(a.rotation);
      const pitchB = pitchFromQuat(b.rotation);
      totalYaw += yawB - yawA;
      totalPitch += pitchB - pitchA;
      const r = Math.sqrt(a.position[0] * a.position[0] + a.position[2] * a.position[2]);
      radii.push(r);
    }
    const meanR = radii.length > 0 ? radii.reduce((s, v) => s + v, 0) / radii.length : 0;
    const radiusVariance =
      radii.length > 0 ? radii.reduce((s, v) => s + Math.abs(v - meanR), 0, ) / radii.length / (meanR === 0 ? 1 : meanR) : 1;

    return {
      totalDistance,
      netForwardBack: netFB,
      netLeftRight: netLR,
      totalUpDown: totalUD,
      netUpDown: netUD,
      totalYawDeg: totalYaw,
      totalPitchDeg: totalPitch,
      radiusVariance,
    };
  }
}

