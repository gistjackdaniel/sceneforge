export type WorldMode =
  | "referenced"
  | "image_based"
  | "structured_3d"
  | "3dgs"
  | "4dgs";

export interface WorldElement {
  id: string;
  name: string;
  kind:
    | "room"
    | "zone"
    | "socket"
    | "actor_mark"
    | "camera_anchor"
    | "light_socket"
    | "material_slot";
  description: string;
}

export interface WorldAsset {
  id: string;
  name: string;
  description: string;
  usdPath: string;
  semanticsPath: string;
  navmeshPath: string;
  previewPath: string;
  proxyKind: "usd" | "3dgs" | "image" | "4dgs";
  elements: WorldElement[];
  props: string[];
}
