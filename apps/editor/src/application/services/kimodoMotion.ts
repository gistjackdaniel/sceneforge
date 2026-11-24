import { somaMotionSchema, type SomaMotion } from "../../domain/sceneAuthoring/somaMotion";
import { motionSourceSchema, type MotionSource } from "../../domain/shot/motionConditions";

/** Resolve immutable media and verify that its bytes match the saved shot manifest. */
export const loadKimodoMotion = async (source: MotionSource, signal?: AbortSignal): Promise<SomaMotion> => {
  const response = await fetch(source.uri, { signal });
  if (!response.ok) throw new Error("Kimodo 모션 파일을 불러오지 못했습니다.");
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  if (Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") !== source.sha256) {
    throw new Error("Kimodo 모션 파일이 저장된 버전과 다릅니다.");
  }
  const motion = somaMotionSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (motion.model !== source.model || motion.fps !== source.fps || motion.frames.length !== source.frameCount || motion.seed !== source.seed || motion.prompt !== source.prompt) {
    throw new Error("Kimodo 모션 파일의 정보가 저장된 버전과 다릅니다.");
  }
  return motion;
};

/** Ask the local runtime to generate a clip. The shot is edited only after media validation. */
export const generateKimodoMotion = async (prompt: string, seconds: number, signal: AbortSignal): Promise<MotionSource> => {
  const response = await fetch("/api/kimodo/generate", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt.trim(), seconds, seed: 0 }),
  });
  if (!response.ok) {
    throw new Error(response.status === 503 ? "로컬 Kimodo 런타임을 먼저 연결하세요." : "Kimodo 모션을 생성하지 못했습니다.");
  }
  const source = motionSourceSchema.parse(await response.json());
  await loadKimodoMotion(source, signal);
  return source;
};
