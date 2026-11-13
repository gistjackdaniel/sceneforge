import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SceneTimeline } from "./SceneTimeline";

const noop = () => undefined;

describe("tracking loss on the shot timeline", () => {
  it("marks limited and lost spans on the camera lane", () => {
    const html = renderToStaticMarkup(createElement(SceneTimeline, {
      tracks: [{ id: "camera", name: "Camera", frames: [0, 64] }],
      activeId: "camera",
      frame: 0,
      duration: 128,
      fps: 16,
      playing: false,
      takeRecording: false,
      takes: [],
      selectedFrames: [],
      lossIntervals: [
        { state: "limited", startFrame: 30, endFrame: 40 },
        { state: "not_available", startFrame: 40, endFrame: 56 },
      ],
      onSelect: noop,
      onScrub: noop,
      onPlay: noop,
      onRecord: noop,
      onSelectTake: noop,
      onDeleteTake: noop,
      onKey: noop,
      onDelete: noop,
      onSelectedFramesChange: noop,
      disabled: false,
    }));
    expect(html).toContain("scene-loss-span is-limited");
    expect(html).toContain("scene-loss-span is-not_available");
    expect(html).toContain("Tracking loss");
    expect(html).toContain("Tracking lost");
  });
});
