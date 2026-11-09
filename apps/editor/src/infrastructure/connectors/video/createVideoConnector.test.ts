import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareModelInput } from "../../../domain/shot";
import { applyShotCommand } from "../../../domain/shot";
import { parseShot, shotId } from "../../../domain/shot";
import { createVideoConnectorFromEnv } from "./createVideoConnector";

const shot = () => {
  const parsed = parseShot({
    schemaVersion: 1,
    id: "clip-001",
    name: "Shot",
    time: { fps: 24, durationFrames: 12, origin: "clip_local" },
    subjects: [],
    camera: { status: "empty", lens: { focalLengthMm: 35 }, interpolation: "linear" },
    renders: [],
  });
  const added = applyShotCommand(parsed, { type: "ADD_SUBJECT", shotId: shotId("clip-001"), draft: { kind: "object", id: "box-1", name: "Crate", primitive: "box" } });
  if (!added.ok) throw new Error(added.reason);
  const keyed = applyShotCommand(added.shot, {
    type: "KEY_CAMERA",
    shotId: added.shot.id,
    key: { frame: 0, position: [0, 1, 4], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
  });
  if (!keyed.ok) throw new Error(keyed.reason);
  const prepared = prepareModelInput(keyed.shot, undefined, "16:9");
  if (!prepared.ok) throw new Error(prepared.blocker.message);
  return prepared.input;
};

describe("video connector", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses the stub only when no cloud URL is configured", async () => {
    const stub = createVideoConnectorFromEnv({ lyraCloudUrl: "  " });
    expect(stub.id).toBe("stub");
    const job = await stub.submit(shot(), new AbortController().signal);
    expect(job.status).toBe("stubbed");
    expect(job.artifactUri).toBeUndefined();
    expect(job.message).toContain("연결된 영상 모델이 없어");

    const lyra = createVideoConnectorFromEnv({ lyraCloudUrl: "http://127.0.0.1:9" });
    expect(lyra.id).toBe("lyra");
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(lyra.submit(shot(), new AbortController().signal)).rejects.toThrow("영상 생성에 실패했습니다.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
