import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePly } from "./parsePly";

const asciiRgb = `ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
0 0 0 255 0 0
1 2 3 0 128 255
`;

const asciiGaussian = `ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
end_header
0.5 0.25 -0.1 1.77 0 0 1.5 -2.3 -2.3 -2.3
`;

describe("parsePly", () => {
  it("reads colored point vertices", () => {
    const parsed = parsePly(asciiRgb);
    expect(parsed.vertices).toHaveLength(2);
    expect(parsed.vertices[0].r).toBe(1);
    expect(parsed.vertices[1].z).toBe(3);
    expect(parsed.vertices[1].b).toBeCloseTo(1, 2);
    expect(parsed.vertices[0].hasGaussian).toBe(false);
  });

  it("decodes gaussian DC color, opacity, and scale", () => {
    const parsed = parsePly(asciiGaussian);
    const vertex = parsed.vertices[0];
    expect(vertex.hasGaussian).toBe(true);
    expect(vertex.x).toBeCloseTo(0.5);
    expect(vertex.r).toBeGreaterThan(0.9);
    expect(vertex.opacity).toBeGreaterThan(0.8);
    expect(vertex.scale[0]).toBeGreaterThan(0);
    expect(vertex.scale[0]).toBeLessThan(0.2);
  });

  it("parses the color-block splat and point fixtures", () => {
    const splats = parsePly(readFileSync("public/worlds/color_block_room/splats.ply", "utf8"));
    const points = parsePly(readFileSync("public/worlds/color_block_room/points.ply", "utf8"));
    expect(splats.vertices.length).toBeGreaterThan(80);
    expect(splats.vertices.every((vertex) => vertex.hasGaussian)).toBe(true);
    expect(points.vertices.length).toBeGreaterThan(1000);
    expect(points.vertices[0].hasGaussian).toBe(false);
  });
});
