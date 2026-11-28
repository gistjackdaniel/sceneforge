import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Two prompts back to back, with the root held on a waypoint in the clip's frame (metres, facing +Z at frame 0).
const origin = process.argv[2] ?? "http://localhost:4173";
const segments = [
  { prompt: "A person walks forward.", frames: 60 },
  { prompt: "A person stops and waves with the right hand.", frames: 30 },
];
const waypoint = { frame: 55, x: 0.6, z: 1.4 };
const response = await fetch(new URL("/api/kimodo/generate", origin), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ segments, waypoints: [waypoint], seed: 81 }),
  signal: AbortSignal.timeout(610_000),
});
const manifest = await response.json();
assert.equal(response.status, 200, manifest.error);
assert.equal(manifest.model, "Kimodo-SOMA-RP-ArdyRep-v1.2");
assert.equal(manifest.prompt, segments.map((segment) => segment.prompt).join(" · "));
assert.deepEqual(manifest.segments, segments);
assert.deepEqual(manifest.waypoints, [waypoint]);
assert.equal(manifest.seed, 81);
assert.equal(manifest.fps, 30);
assert.equal(manifest.frameCount, 90);

const asset = await fetch(new URL(manifest.uri, origin));
assert.equal(asset.status, 200);
const bytes = Buffer.from(await asset.arrayBuffer());
assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256);
const clip = JSON.parse(bytes);
assert.equal(clip.joints.length, 77);
assert.equal(clip.frames.length, 90);
assert.notDeepEqual(clip.frames[0].localRotations, clip.frames[89].localRotations);
const [x0, , z0] = clip.frames[0].rootPosition;
const [x, , z] = clip.frames[waypoint.frame].rootPosition;
const waypointError = Math.hypot(x - x0 - waypoint.x, z - z0 - waypoint.z);
assert.ok(waypointError < 0.15, `The root missed the waypoint by ${waypointError.toFixed(3)} m.`);
assert.ok(Math.abs(clip.frames[0].rootHeading) < 0.1, "The clip must start facing +Z.");

const rejected = await fetch(new URL("/api/kimodo/generate", origin), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ segments: [{ prompt: "A person walks.", frames: 30 }], waypoints: [{ frame: 40, x: 0, z: 1 }], seed: 0 }),
});
assert.equal(rejected.status, 400, "A waypoint after the clip's end must be rejected.");
console.log(JSON.stringify({ ...manifest, joints: clip.joints.length, waypointErrorM: Number(waypointError.toFixed(3)) }, null, 2));
