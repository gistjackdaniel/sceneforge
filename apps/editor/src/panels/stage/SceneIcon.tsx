const paths = {
  layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  light: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  camera: "M3 6h12v12H3V6Zm12 4 6-3v10l-6-3",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  move: "M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3",
  rotate: "M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 14-2M19 16A8 8 0 0 1 5 18",
  scale: "M14 3h7v7M21 3l-8 8M10 21H3v-7M3 21l8-8",
  orbit: "M12 3a9 9 0 1 0 9 9M12 3c-7 5-7 13 0 18M12 3c7 5 7 13 0 18M3 12h18",
  key: "m12 4 8 8-8 8-8-8 8-8Z",
  play: "m8 4 12 8-12 8V4Z",
  pause: "M8 4v16M16 4v16",
  lock: "M5 10h14v11H5V10Zm3 0V6a4 4 0 0 1 8 0v4",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  help: "M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  export: "M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5",
};
export type SceneIconName = keyof typeof paths;
export const SceneIcon = ({ name }: { name: SceneIconName }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
);
