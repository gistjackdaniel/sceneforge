import { describe, expect, it } from "vitest";
import { nextSteering, type SteerKey, type Steering } from "./useArdyLive";

const press = (keys: SteerKey[], from: Steering = { speed: 0, angle: 0 }) => keys.reduce(nextSteering, from);

describe("ARDY arrow-key steering", () => {
  it("starts walking on ↑ and speeds up in steps to a cap", () => {
    expect(press(["faster"]).speed).toBeCloseTo(0.6);
    expect(press(["faster", "faster"]).speed).toBeCloseTo(0.8);
    expect(press(Array<SteerKey>(20).fill("faster")).speed).toBeCloseTo(2.4);
  });

  it("slows to a full stop on ↓ and never walks backwards", () => {
    expect(press(["faster", "slower", "slower", "slower"]).speed).toBe(0);
    expect(press(["slower"]).speed).toBe(0);
  });

  it("turns 30° per press, left positive, without changing speed", () => {
    const turned = press(["faster", "left", "left", "left"]);
    expect((turned.angle * 180) / Math.PI).toBeCloseTo(90);
    expect(turned.speed).toBeCloseTo(0.6);
    expect(press(["right"]).angle).toBeCloseTo(-Math.PI / 6);
  });
});
