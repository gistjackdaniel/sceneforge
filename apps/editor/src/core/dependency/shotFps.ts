/**
 * Frame rate for integer-frame dependency passes.
 *
 * Timeline owns `Shot.fps`. That field is not on this branch, so graph code
 * reads the rate only through this port. The shot record stores it at
 * `time.fps`. Sequence fps is not a source.
 */
export interface ShotFpsSource {
  fps(shot: { time: { fps: number } }): number;
}

/** Shot-record clock. Does not accept a caller-supplied number. */
export const shotRecordFps: ShotFpsSource = {
  fps(shot) {
    return shot.time.fps;
  },
};
