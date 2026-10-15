/* @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

// No need to mock Lyra adapter for this test since we assert bridge-side effects

import { EditorStoreProvider, useEditorStore } from "./editorStore";

const flush = () => new Promise((r) => setTimeout(r, 0));
const waitFor = async (check: () => boolean, tries = 10) => {
  for (let i = 0; i < tries; i++) {
    await flush();
    if (check()) return;
  }
};

const RequestAndOptionallyUndo = ({ undo }: { undo?: boolean }) => {
  const { state, dispatch } = useEditorStore();
  useEffect(() => {
    const clipId = state.ui.selectedClipId;
    // Ensure shot is render-ready: add one camera keyframe at frame 0
    dispatch({
      type: "add-camera-keyframe",
      clipId,
      frame: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      focalLengthMm: 35,
    });
    dispatch({
      type: "agent-execute-commands",
      commands: [{ type: "REQUEST_RENDER", clipId, quality: "final" }],
      logMessage: "test",
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};

const UndoAfterQueued = () => {
  const { state, dispatch } = useEditorStore();
  useEffect(() => {
    if (state.ui.domainJobQueue.jobs.some((j) => j.status === "queued")) {
      dispatch({ type: "undo" });
    }
  }, [state.ui.domainJobQueue.jobs]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};

describe("EditorStore render bridge", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    try {
      root?.unmount();
    } catch {}
    root = null;
    document.body.removeChild(container);
  });

  it("enqueues and starts exactly one render for REQUEST_RENDER", async () => {
    let jobsLen = -1;
    let queuedEvents = 0;
    const Reader = () => {
      const { state } = useEditorStore();
      jobsLen = state.ui.domainJobQueue.jobs.length;
      queuedEvents = state.ui.commandBus.events.filter((e) => e.type === "RenderQueued").length;
      return null;
    };
    (root as Root).render(
      <EditorStoreProvider>
        <RequestAndOptionallyUndo />
        <Reader />
      </EditorStoreProvider>,
    );
    await flush();
    await flush();
    await flush();
    expect(jobsLen).toBe(1);
    expect(queuedEvents).toBe(1);
  });

  it("undo cancels the queued render job", async () => {
    const ReaderAfter = ({ done }: { done: (status: string | undefined) => void }) => {
      const { state } = useEditorStore();
      useEffect(() => {
        const job = state.ui.domainJobQueue.jobs[0];
        done(job?.status);
      }, [state.ui.domainJobQueue.jobs]); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    };
    let finalStatus: string | undefined;
    const done = (status?: string) => {
      finalStatus = status;
    };
    (root as Root).render(
      <EditorStoreProvider>
        <RequestAndOptionallyUndo />
        <UndoAfterQueued />
        <ReaderAfter done={done} />
      </EditorStoreProvider>,
    );
    await flush();
    await flush();
    await flush();
    // After undo, queue status should be 'cancelled'
    await waitFor(() => finalStatus === "cancelled", 20);
    expect(finalStatus).toBe("cancelled");
  });
});

