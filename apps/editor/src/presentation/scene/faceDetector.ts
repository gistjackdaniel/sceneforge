import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url";
import wasmBinaryPath from "../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url";
import fallbackLoaderPath from "../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js?url";
import fallbackBinaryPath from "../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm?url";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export const createFaceDetector = async (signal: AbortSignal): Promise<FaceLandmarker> => {
  const [model, simd] = await Promise.all([
    fetch(import.meta.env.VITE_FACE_MODEL_URL || MODEL_URL, { signal }),
    FilesetResolver.isSimdSupported(),
  ]);
  if (!model.ok) throw new Error("Face Landmarker model could not be downloaded");
  const modelAssetBuffer = new Uint8Array(await model.arrayBuffer());
  signal.throwIfAborted();
  return FaceLandmarker.createFromOptions(
    simd
      ? { wasmLoaderPath, wasmBinaryPath }
      : { wasmLoaderPath: fallbackLoaderPath, wasmBinaryPath: fallbackBinaryPath },
    { baseOptions: { modelAssetBuffer }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true },
  );
};
