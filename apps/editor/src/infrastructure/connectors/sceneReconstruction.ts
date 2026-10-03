import { z } from "zod";

export const reconstructionRequestSchema = z.object({
  version: z.literal(1), sourceAssetId: z.string().min(1), sourceImageUri: z.string().min(1),
  objectId: z.string().min(1), label: z.string().min(1),
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), foreground: z.boolean() })).min(1),
  tasks: z.tuple([z.literal("segment_object"), z.literal("reconstruct_object")]),
});
export const reconstructionResultSchema = z.object({
  objectId: z.string(), sourceAssetId: z.string(), maskUri: z.string().min(1),
  meshUri: z.string().regex(/^(https?:\/\/|\/)[^?#]+\.glb(?:[?#].*)?$/i),
  executionId: z.string().min(1), modelId: z.string().min(1), modelVersion: z.string().min(1),
  coordinateSystem: z.literal("Y_UP"), unitScaleMeters: z.literal(1),
});
export const reconstructSceneObject = async (endpoint: string, input: z.infer<typeof reconstructionRequestSchema>, signal: AbortSignal) => {
  const request = reconstructionRequestSchema.parse(input);
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/objects/reconstruct`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal,
  });
  if (!response.ok) throw new Error("3D 복원에 실패했습니다. 연결 상태를 확인하고 다시 시도하세요.");
  const result = reconstructionResultSchema.parse(await response.json());
  if (result.objectId !== request.objectId || result.sourceAssetId !== request.sourceAssetId) throw new Error("복원 결과가 선택한 객체와 일치하지 않습니다.");
  return result;
};
