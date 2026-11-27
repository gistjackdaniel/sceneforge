import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url";
import wasmBinaryPath from "../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url";
import fallbackLoaderPath from "../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js?url";
import fallbackBinaryPath from "../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm?url";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export const createPoseDetector = async (signal: AbortSignal): Promise<PoseLandmarker> => {
  const [model, simd] = await Promise.all([
    fetch(import.meta.env.VITE_POSE_MODEL_URL || MODEL_URL, { signal }),
    FilesetResolver.isSimdSupported(),
  ]);
  if (!model.ok) throw new Error("Pose Landmarker model could not be downloaded");
  const modelAssetBuffer = new Uint8Array(await model.arrayBuffer());
  signal.throwIfAborted();
  return PoseLandmarker.createFromOptions(
    simd
      ? { wasmLoaderPath, wasmBinaryPath }
      : { wasmLoaderPath: fallbackLoaderPath, wasmBinaryPath: fallbackBinaryPath },
    { baseOptions: { modelAssetBuffer }, runningMode: "VIDEO", numPoses: 1 },
  );
};
