export const shouldPrioritizeJointPick = (input: {
  jointPicked: boolean;
  workspace: "build" | "record";
  tool: "navigate" | "translate" | "rotate" | "scale" | "select";
}): boolean => {
  // Joint picks always take precedence in build workspace when transform tools are active.
  if (input.workspace === "build" && input.jointPicked && input.tool !== "navigate") return true;
  return false;
};

