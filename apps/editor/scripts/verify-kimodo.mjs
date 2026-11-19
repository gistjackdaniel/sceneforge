import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const origin = process.argv[2] ?? "http://localhost:4173";
const prompt = "A person takes two small steps to the left and reaches forward with the right hand.";
const response = await fetch(new URL("/api/kimodo/generate", origin), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt, seconds: 2, seed: 81 }),
  signal: AbortSignal.timeout(610_000),
});
const manifest = await response.json();
assert.equal(response.status, 200, manifest.error);
assert.equal(manifest.model, "Kimodo-SOMA-RP-ArdyRep-v1.2");
assert.equal(manifest.prompt, prompt);
assert.equal(manifest.seed, 81);
assert.equal(manifest.fps, 30);
assert.equal(manifest.frameCount, 60);

const asset = await fetch(new URL(manifest.uri, origin));
assert.equal(asset.status, 200);
const bytes = Buffer.from(await asset.arrayBuffer());
assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256);
const clip = JSON.parse(bytes);
assert.equal(clip.joints.length, 77);
assert.equal(clip.frames.length, 60);
assert.notDeepEqual(clip.frames[0].localRotations, clip.frames[59].localRotations);
assert.notDeepEqual(clip.frames[0].rootPosition, clip.frames[59].rootPosition);
console.log(JSON.stringify({ ...manifest, joints: clip.joints.length }, null, 2));
