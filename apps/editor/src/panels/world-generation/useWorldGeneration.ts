import { useCallback } from "react";
import { lyraModelConnector } from "../../infrastructure/connectors/lyra/modelConnector";
import { useEditorStore } from "../../state/editorStore";
import {
  buildImageToWorldRequest,
  isSupportedImageFile,
  toUserFacingGenerationError,
  validateWorldGenerationInput,
} from "../../application/services/worldGenerationRequest";
import { findReusableWorldExecution } from "../../application/services/worldGeneration";
import type { LyraJobState } from "../../core/lyra/types";

const makeAssetId = () => `asset-image-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

let generationAbort: AbortController | null = null;
let generationToken = 0;

const readImageAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });

export const useWorldGeneration = () => {
  const { state, dispatch } = useEditorStore();

  const setDraft = (draft: Partial<typeof state.ui.worldGenDraft>) =>
    dispatch({ type: "set-world-gen-draft", draft });

  const registerImageFile = async (file: File) => {
    const validation = isSupportedImageFile(file);
    if (!validation.ok) {
      dispatch({
        type: "set-world-gen-job",
        job: {
          requestId: "validate-image",
          status: "failed",
          progress: 0,
          message: validation.issues[0],
          error: validation.issues[0],
        },
      });
      return;
    }
    const uri = await readImageAsDataUrl(file);
    dispatch({
      type: "register-source-image",
      input: { id: makeAssetId(), name: file.name, uri, thumbnailUri: uri },
    });
  };

  const cancelGeneration = useCallback(() => {
    generationToken += 1;
    generationAbort?.abort();
    generationAbort = null;
    dispatch({
      type: "set-world-gen-job",
      job: {
        requestId: state.ui.worldGenJob?.requestId ?? "cancelled",
        status: "cancelled",
        progress: 0,
        message: "월드 생성이 취소되었습니다.",
      },
    });
  }, [dispatch, state.ui.worldGenJob?.requestId]);

  const runGeneration = useCallback(async () => {
    const draft = state.ui.worldGenDraft;
    const input = {
      referenceAssetIds: draft.imageAssetId ? [draft.imageAssetId] : [],
      sourceImageUri: draft.imageThumbnailUri,
      sourceImageName: draft.imageName,
      prompt: draft.prompt || undefined,
      seed: draft.seed ? Number(draft.seed) : undefined,
      explorationTrajectory: draft.trajectoryLabel
        ? { label: draft.trajectoryLabel, frameCount: 24 }
        : undefined,
    };
    const token = generationToken + 1;
    generationToken = token;

    dispatch({
      type: "set-world-gen-job",
      job: {
        requestId: `validate-${token}`,
        status: "validating",
        progress: 0,
        message: "요청을 확인하는 중…",
      },
    });

    const validation = validateWorldGenerationInput(input);
    if (!validation.ok) {
      dispatch({
        type: "set-world-gen-job",
        job: {
          requestId: `validate-${token}`,
          status: "failed",
          progress: 0,
          message: validation.issues[0],
          error: validation.issues[0],
        },
      });
      return;
    }

    const reused = findReusableWorldExecution(state.project, {
      inputAssetIds: input.referenceAssetIds,
      connectorId: "lyra-2.0",
      task: "image_to_world",
      prompt: input.prompt,
      seed: input.seed,
    });
    if (reused) {
      dispatch({
        type: "set-world-gen-job",
        job: {
          requestId: reused.execution.id,
          status: "completed",
          progress: 1,
          message: "이미 생성된 월드를 재사용했습니다. 커넥터를 다시 호출하지 않았습니다.",
          worldId: reused.world.id,
          executionId: reused.execution.id,
        },
      });
      return;
    }

    const request = buildImageToWorldRequest(input);
    generationAbort?.abort();
    const controller = new AbortController();
    generationAbort = controller;

    dispatch({
      type: "set-world-gen-job",
      job: {
        requestId: request.requestId,
        status: "queued",
        progress: 0.05,
        message: "생성 대기 중…",
      },
    });

    try {
      dispatch({
        type: "set-world-gen-job",
        job: {
          requestId: request.requestId,
          status: "running",
          progress: 0.35,
          message: "월드를 생성하는 중…",
        },
      });
      const result = await lyraModelConnector.execute(request, controller.signal);
      if (token !== generationToken) {
        return;
      }
      const stubJob: LyraJobState = {
        jobId: request.requestId,
        status: "completed",
        progress: 1,
        message: result.logs[0] ?? "World generation complete",
        input: {
          sourceImagePath: input.sourceImageUri,
          sourceImageName: input.sourceImageName,
          cameraTrajectory: { label: "generation-explore", frameCount: 24 },
          prompt: input.prompt,
        },
        output: {
          jobId: request.requestId,
          generatedSegmentPath: String(result.artifacts.generatedSegmentPath ?? ""),
          spatialMemoryPath: String(result.artifacts.spatialMemoryPath ?? ""),
          visualLayer3dgsPath: String(result.artifacts.visualLayer3dgsPath ?? ""),
          surfaceMeshPath: String(result.artifacts.surfaceMeshPath ?? ""),
          navmeshPath: typeof result.artifacts.navmeshPath === "string" ? result.artifacts.navmeshPath : undefined,
          memoryCoverage: Number(result.artifacts.memoryCoverage ?? 0),
          generatedAreaRatio: Number(result.artifacts.generatedAreaRatio ?? 0),
        },
      };
      dispatch({
        type: "complete-world-generation",
        job: stubJob,
        imageAssetId: draft.imageAssetId,
      });
    } catch (error) {
      if (token !== generationToken) {
        return;
      }
      const cancelled = controller.signal.aborted || (error instanceof Error && /cancel/i.test(error.message));
      dispatch({
        type: "set-world-gen-job",
        job: {
          requestId: request.requestId,
          status: cancelled ? "cancelled" : "failed",
          progress: 0,
          message: toUserFacingGenerationError(error),
          error: toUserFacingGenerationError(error),
        },
      });
    } finally {
      if (generationAbort === controller) {
        generationAbort = null;
      }
    }
  }, [dispatch, state.project, state.ui.worldGenDraft]);

  const previewWorld = (worldId: string) => {
    dispatch({ type: "preview-world", worldId });
  };

  const useInCurrentClip = (worldId: string) => {
    const clipId = state.ui.selectedClipId;
    if (!clipId || !state.project.clips[clipId]) {
      return;
    }
    dispatch({ type: "set-world", clipId, worldId, worldMode: "referenced" });
  };

  const isRunning =
    state.ui.worldGenJob?.status === "validating" ||
    state.ui.worldGenJob?.status === "queued" ||
    state.ui.worldGenJob?.status === "running";

  return {
    draft: state.ui.worldGenDraft,
    job: state.ui.worldGenJob,
    isRunning,
    connectorTasks: lyraModelConnector.supportedTasks(),
    setDraft,
    registerImageFile,
    clearImage: () => dispatch({ type: "clear-source-image" }),
    runGeneration,
    cancelGeneration,
    previewWorld,
    useInCurrentClip,
  };
};
