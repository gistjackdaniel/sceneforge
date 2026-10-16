import { describe, it, expect } from "vitest";
import { shouldPrioritizeJointPick } from "./pickPriority";

describe("pick priority logic", () => {
  it("prioritizes joint when picked and not navigating in build", () => {
    expect(shouldPrioritizeJointPick({ jointPicked: true, workspace: "build", tool: "rotate" })).toBe(true);
  });
  it("does not prioritize when navigating", () => {
    expect(shouldPrioritizeJointPick({ jointPicked: true, workspace: "build", tool: "navigate" })).toBe(false);
  });
  it("does not prioritize in record workspace by default", () => {
    expect(shouldPrioritizeJointPick({ jointPicked: true, workspace: "record", tool: "rotate" })).toBe(false);
  });
});

