import { parseShot } from "../../domain/shot";
import { createShotPassArchive } from "./shotPassArchive";

self.onmessage = (event: MessageEvent<{ shot: unknown; aspect: number }>) => {
  try {
    self.postMessage({ kind: "archive", blob: createShotPassArchive(parseShot(event.data.shot), event.data.aspect) });
  } catch (error) {
    self.postMessage({ kind: "error", message: error instanceof Error ? error.message : "Couldn't export render passes." });
  }
};
