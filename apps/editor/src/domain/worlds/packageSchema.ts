import { z } from "zod";

/** `WorldElement` checked at the package boundary. Replaces an unchecked cast in storage. */
export const worldElementSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  localizedNames: z.record(z.string(), z.string()).optional(),
  kind: z.enum([
    "room",
    "zone",
    "socket",
    "actor_mark",
    "camera_anchor",
    "light_socket",
    "material_slot",
  ]),
  description: z.string(),
});

export const worldElementsPackageSchema = z.object({
  version: z.number().int().positive().default(1),
  worldId: z.string().min(1),
  elements: z.array(worldElementSchema),
});

export const worldProxyKindSchema = z.enum(["usd", "3dgs", "image", "4dgs"]);

export const worldRepresentationSchema = z.enum([
  "usd_stage",
  "mesh",
  "point_cloud",
  "gaussian_splat",
  "image_based_proxy",
  "video_based_proxy",
  "hybrid",
]);

export const worldDirectoryManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  proxyKind: worldProxyKindSchema,
  representation: worldRepresentationSchema,
  files: z.array(z.string()),
  rootUri: z.string().min(1),
});
