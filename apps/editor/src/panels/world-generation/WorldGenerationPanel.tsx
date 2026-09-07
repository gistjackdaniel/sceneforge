import { useMemo, useState } from "react";
import { useWorldGeneration } from "./useWorldGeneration";
import { useEditorStore } from "../../state/editorStore";
import { lyraModelConnector } from "../../infrastructure/connectors/lyra/modelConnector";
import { findWorldReferenceNode } from "../../application/services/worldLinking";
import type { WorldAsset } from "../../domain/worlds/types";

const artifactKinds = (world: WorldAsset) =>
  [
    world.generatedSegmentPath ? "generated segment" : undefined,
    world.spatialMemoryPath ? "spatial memory" : undefined,
    world.surfaceMeshPath ? "mesh" : undefined,
    world.visualLayer3dgsPath ? "gaussian splat" : undefined,
  ].filter((item): item is string => Boolean(item));

const WorldResultCard = ({
  world,
  clipId,
  alreadyLinked,
  clipMissing,
  onPreview,
  onUse,
}: {
  world: WorldAsset;
  clipId?: string;
  alreadyLinked: boolean;
  clipMissing: boolean;
  onPreview: () => void;
  onUse: () => void;
}) => {
  const execution = world.generatedBy;
  const coverage =
    world.memoryCoverage !== undefined ? `${Math.round(world.memoryCoverage * 100)}%` : undefined;
  const kinds = artifactKinds(world);

  return (
    <article className="world-result-card">
      <div className="world-result-preview">
        {world.previewUri && /\.(png|jpe?g|webp|gif)$/i.test(world.previewUri) ? (
          <img src={world.previewUri} alt="" />
        ) : (
          <div className="world-result-placeholder">{world.representation}</div>
        )}
      </div>
      <div className="world-result-body">
        <div className="world-result-header">
          <h3>{world.name}</h3>
          <span className={`job-status is-${execution?.status ?? "ready"}`}>
            {execution?.status ?? "ready"}
          </span>
        </div>
        <p className="muted">
          {world.representation}
          {coverage ? ` · coverage ${coverage}` : ""}
          {kinds.length > 0 ? ` · ${kinds.join(", ")}` : ""}
        </p>
        <p className="muted">{new Date(world.createdAt).toLocaleString()}</p>
        <div className="button-row wrap">
          <button type="button" onClick={onPreview}>
            Preview in Viewport
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={clipMissing}
            title={
              clipMissing
                ? "타임라인에서 클립을 먼저 선택하세요. 클립을 자동으로 만들지 않습니다."
                : alreadyLinked
                  ? "이미 현재 클립에 연결되어 있습니다."
                  : "현재 클립에 WorldReferenceNode로 연결합니다."
            }
            onClick={onUse}
          >
            {alreadyLinked ? "Already in Current Clip" : "Use in Current Clip"}
          </button>
        </div>
        {clipMissing && <p className="muted">현재 선택된 클립이 없어 연결할 수 없습니다.</p>}
        <details className="technical-details">
          <summary>Technical Details</summary>
          <ul className="artifact-list">
            <li>World ID: {world.id}</li>
            {clipId ? <li>Clip: {clipId}</li> : null}
            <li>Root: {world.rootUri || "—"}</li>
            <li>Mesh: {world.surfaceMeshPath || "—"}</li>
            <li>3DGS: {world.visualLayer3dgsPath || "—"}</li>
            <li>Segment: {world.generatedSegmentPath || "—"}</li>
            <li>Memory: {world.spatialMemoryPath || "—"}</li>
            {execution ? (
              <li>
                Execution {execution.id} · {execution.connectorId} · {execution.modelVersion ?? "unknown"}
              </li>
            ) : null}
          </ul>
        </details>
      </div>
    </article>
  );
};

export const WorldGenerationPanel = () => {
  const {
    state: { project, ui },
  } = useEditorStore();
  const {
    draft,
    job,
    isRunning,
    connectorTasks,
    setDraft,
    registerImageFile,
    clearImage,
    runGeneration,
    cancelGeneration,
    previewWorld,
    useInCurrentClip,
  } = useWorldGeneration();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const clip = ui.selectedClipId ? project.clips[ui.selectedClipId] : undefined;
  const worlds = useMemo(
    () => Object.values(project.worlds).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [project.worlds],
  );

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      void registerImageFile(file);
    }
  };

  return (
    <section className="world-generation-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">World Generation</p>
          <h2>Image to World</h2>
        </div>
      </div>

      <div className="stack">
        <div className="status-grid world-gen-meta">
          <div>
            <span className="label">Connector</span>
            <strong>{lyraModelConnector.id}</strong>
            <span className="muted">{connectorTasks.join(", ")}</span>
          </div>
          <div>
            <span className="label">Selected Clip</span>
            <strong>{clip?.name ?? "없음"}</strong>
          </div>
          <div>
            <span className="label">Capabilities</span>
            <strong>1 image · optional prompt</strong>
          </div>
        </div>

        <div
          className={`image-dropzone ${dragOver ? "is-over" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            onFiles(event.dataTransfer.files);
          }}
        >
          {draft.imageThumbnailUri ? (
            <div className="image-dropzone-preview">
              <img src={draft.imageThumbnailUri} alt={draft.imageName} />
              <div className="button-row wrap">
                <label className="file-button">
                  Replace
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      onFiles(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button type="button" onClick={clearImage}>
                  Remove
                </button>
              </div>
              <span className="muted">{draft.imageName}</span>
            </div>
          ) : (
            <label className="image-dropzone-empty">
              <strong>Reference Image</strong>
              <span className="muted">한 장의 이미지를 선택하거나 여기로 드래그하세요.</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  onFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          )}
        </div>

        <label className="stack compact">
          <span>Optional Prompt</span>
          <input
            type="text"
            value={draft.prompt}
            placeholder="카페 내부, 따뜻한 조명…"
            onChange={(event) => setDraft({ prompt: event.target.value })}
          />
        </label>

        <button type="button" className="ghost-toggle" onClick={() => setAdvancedOpen((value) => !value)}>
          {advancedOpen ? "Hide Advanced" : "Advanced"}
        </button>
        {advancedOpen && (
          <div className="stack compact advanced-box">
            <label className="stack compact">
              <span>Seed</span>
              <input
                type="number"
                min={0}
                value={draft.seed}
                placeholder="optional"
                onChange={(event) => setDraft({ seed: event.target.value })}
              />
            </label>
            <label className="stack compact">
              <span>Generation trajectory</span>
              <input
                type="text"
                value={draft.trajectoryLabel}
                onChange={(event) => setDraft({ trajectoryLabel: event.target.value })}
              />
              <span className="muted">
                생성용 탐색 경로입니다. 현재 클립의 Camera Path로 저장되지 않습니다.
              </span>
            </label>
          </div>
        )}

        <div className="button-row wrap">
          <button
            type="button"
            className="btn-primary"
            disabled={isRunning || !draft.imageAssetId}
            onClick={() => void runGeneration()}
          >
            {isRunning ? "Generating…" : "Generate"}
          </button>
          {isRunning && (
            <button type="button" onClick={cancelGeneration}>
              Cancel
            </button>
          )}
          {job?.status === "failed" && (
            <button type="button" onClick={() => void runGeneration()}>
              Retry
            </button>
          )}
        </div>

        <div className="stack compact">
          <h3>Job Status</h3>
          {job ? (
            <>
              <p>
                <span className={`job-status is-${job.status}`}>{job.status}</span> — {job.message}
              </p>
              {(job.status === "queued" || job.status === "running") && (
                <progress max={1} value={job.progress} style={{ width: "100%" }} />
              )}
              {job.error && <p className="muted">{job.error}</p>}
            </>
          ) : (
            <p className="muted">idle</p>
          )}
        </div>

        <div className="stack compact">
          <h3>Worlds</h3>
          {worlds.length === 0 ? (
            <p className="muted">생성된 월드가 없습니다.</p>
          ) : (
            worlds.map((world) => {
              const alreadyLinked = Boolean(
                clip && (clip.linkedWorldId === world.id || findWorldReferenceNode(project, clip.id, world.id)),
              );
              return (
                <WorldResultCard
                  key={world.id}
                  world={world}
                  clipId={clip?.id}
                  alreadyLinked={alreadyLinked}
                  clipMissing={!clip}
                  onPreview={() => previewWorld(world.id)}
                  onUse={() => useInCurrentClip(world.id)}
                />
              );
            })
          )}
        </div>
      </div>
    </section>
  );
};
