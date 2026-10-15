/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";

// Mock Lyra adapter before importing the store
let submitCount = 0;
let pollCount = 0;
let lastInput: any = null;
vi.mock("../core/lyra/cloudAdapter", () => {
  const fakeAdapter = {
    // World gen (unused)
    async submitJob(input: any) {
      return { jobId: "wg-stub", status: "queued", progress: 0, message: "q", input };
    },
    async pollJob(jobId: string) {
      return { jobId, status: "completed", progress: 1, message: "done" };
    },
    // Video render (used by bridge)
    submitVideoRenderJob: vi.fn(async (input: any) => {
      submitCount += 1;
      lastInput = input;
      return { jobId: "video-stub-1", status: "queued", progress: 0, message: "queued", input } as any;
    }),
    pollVideoRenderJob: vi.fn(async (jobId: string) => {
      pollCount += 1;
      // First poll -> running, second -> completed
      if (pollCount === 1) {
        return { jobId, status: "running", progress: 0.5, message: "running", input: lastInput } as any;
      }
      return {
        jobId,
        status: "completed",
        progress: 1,
        message: "done",
        input: lastInput,
        output: { jobId, renderedVideoPath: "/tmp/out.mp4", consistencyScore: 0.9, usedMemoryCoverage: 0.7 },
      } as any;
    }),
  };
  return {
    lyraAdapter: fakeAdapter,
    cloudLyraAdapter: fakeAdapter,
    createCloudLyraAdapter: () => fakeAdapter,
  };
});

import { EditorStoreProvider, useEditorStore } from "./editorStore";

const flush = () => new Promise((r) => setTimeout(r, 0));

const RequestAndOptionallyUndo = ({ undo }: { undo?: boolean }) => {
  const { state, dispatch } = useEditorStore();
  useEffect(() => {
    const clipId = state.ui.selectedClipId;
    dispatch({
      type: "agent-execute-commands",
      commands: [{ type: "REQUEST_RENDER", clipId, quality: "final" }],
      logMessage: "test",
    });
    if (undo) {
      // schedule undo right after request
      setTimeout(() => {
        dispatch({ type: "undo" });
      }, 0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};

describe("EditorStore render bridge", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    submitCount = 0;
    pollCount = 0;
    lastInput = null;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    if (container) {
      createRoot(container).unmount();
      document.body.removeChild(container);
    }
  });

  it("enqueues and starts exactly one render for REQUEST_RENDER", async () => {
    const root = createRoot(container);
    root.render(
      <EditorStoreProvider>
        <RequestAndOptionallyUndo />
      </EditorStoreProvider>,
    );
    await flush();
    // Allow effect to kick and polling to complete once
    await flush();
    expect(submitCount).toBe(1);
    // Domain job queue should have exactly one job
    // We observe the state via a temporary reader component
    let jobsLen = -1;
    const Reader = () => {
      const { state } = useEditorStore();
      jobsLen = state.ui.domainJobQueue.jobs.length;
      return null;
    };
    root.render(
      <EditorStoreProvider>
        <Reader />
      </EditorStoreProvider>,
    );
    await flush();
    expect(jobsLen).toBe(1);
  });

  it("undo cancels the queued render job", async () => {
    const root = createRoot(container);
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
    root.render(
      <EditorStoreProvider>
        <RequestAndOptionallyUndo undo />
        <ReaderAfter done={done} />
      </EditorStoreProvider>,
    );
    await flush();
    await flush();
    // After undo, queue status should be 'cancelled'
    expect(finalStatus).toBe("cancelled");
  });
});

