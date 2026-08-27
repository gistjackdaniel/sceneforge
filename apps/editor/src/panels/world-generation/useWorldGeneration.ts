import { useCallback, useState } from "react";
import { lyraAdapter } from "../../core/lyra";
import type { LyraWorldGenerateInput } from "../../core/lyra/types";
import { useEditorStore } from "../../state/editorStore";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useWorldGeneration = () => {
  const { state, dispatch } = useEditorStore();
  const [isRunning, setIsRunning] = useState(false);

  const runGeneration = useCallback(async () => {
    const clipId = state.ui.selectedClipId;
    const draft = state.ui.worldGenDraft;
    const input: LyraWorldGenerateInput = {
      sourceImagePath: draft.imageName ? `uploads/${draft.imageName}` : "uploads/source.png",
      sourceImageName: draft.imageName || "source.png",
      cameraTrajectory: {
        label: draft.trajectoryLabel || "default orbit",
        frameCount: state.project.clips[clipId]?.duration ?? 120,
      },
      prompt: draft.prompt || undefined,
    };

    setIsRunning(true);
    try {
      let job = await lyraAdapter.submitJob(input);
      dispatch({ type: "set-lyra-job", job });

      while (job.status === "queued" || job.status === "running") {
        await sleep(450);
        job = await lyraAdapter.pollJob(job.jobId);
        dispatch({ type: "set-lyra-job", job });
      }

      if (job.status === "completed") {
        dispatch({ type: "complete-world-generation", clipId, job });
      }
    } catch (error) {
      dispatch({
        type: "set-lyra-job",
        job: {
          jobId: "failed-local",
          status: "failed",
          progress: 0,
          message: "World generation failed",
          input,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    } finally {
      setIsRunning(false);
    }
  }, [dispatch, state.project.clips, state.ui.selectedClipId, state.ui.worldGenDraft]);

  return {
    draft: state.ui.worldGenDraft,
    job: state.ui.lyraJob,
    isRunning,
    setDraft: (draft: Partial<typeof state.ui.worldGenDraft>) =>
      dispatch({ type: "set-world-gen-draft", draft }),
    runGeneration,
  };
};
