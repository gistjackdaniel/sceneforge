import { describe, it, expect } from "vitest";
import { JointPickPriority, shouldPrioritizeJointPick } from "./pickPriority";

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
  it("lets the camera gizmo win when it overlaps a joint", () => {
    expect(shouldPrioritizeJointPick({
      jointPicked: true,
      cameraGizmoPicked: true,
      workspace: "build",
      tool: "rotate",
    })).toBe(false);
    expect(JointPickPriority.winner({
      cameraGizmoDistance: 0.4,
      jointDistance: 0.4,
      objectDistance: 1.2,
      workspace: "build",
      tool: "rotate",
    })).toBe("camera-gizmo");
  });
  it("picks a joint that is strictly in front of the camera gizmo", () => {
    expect(JointPickPriority.winner({
      cameraGizmoDistance: 1.5,
      jointDistance: 0.3,
      workspace: "build",
      tool: "rotate",
    })).toBe("joint");
  });
  it("ignores joints while the camera tool is active", () => {
    expect(JointPickPriority.winner({
      jointDistance: 0.2,
      objectDistance: 0.8,
      workspace: "build",
      tool: "camera",
    })).toBe("object");
  });
});
