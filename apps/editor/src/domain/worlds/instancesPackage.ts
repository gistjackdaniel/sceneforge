import { z } from "zod";
import { persistentIdSchema } from "./ids";
import { sceneStateSchema } from "./sceneState";

/**
 * Sidecar for instance state. `elements.json` stays version 1.
 * Keeping instances in their own file means regenerating a world package does not delete them.
 */
export const worldInstancesPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    worldId: persistentIdSchema,
    scene: sceneStateSchema,
  })
  .superRefine((pkg, ctx) => {
    if (pkg.worldId !== pkg.scene.worldId) {
      ctx.addIssue({
        code: "custom",
        message: "instances package worldId must match the scene",
        path: ["worldId"],
      });
    }
  });

export type WorldInstancesPackage = z.infer<typeof worldInstancesPackageSchema>;
