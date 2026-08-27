import { useWorldGeneration } from "./useWorldGeneration";
import { useEditorStore } from "../../state/editorStore";

export const WorldGenerationPanel = () => {
  const {
    state: { project, ui },
  } = useEditorStore();
  const { draft, job, isRunning, setDraft, runGeneration } = useWorldGeneration();

  const clip = project.clips[ui.selectedClipId];
  const linkedWorld = clip.linkedWorldId ? project.worlds[clip.linkedWorldId] : undefined;

  return (
    <section className="world-generation-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">World Generation</p>
          <h2>Lyra 2.0 World</h2>
        </div>
      </div>

      <div className="stack">
        <div className="status-grid">
          <div>
            <span className="label">Selected Clip</span>
            <strong>{clip.name}</strong>
          </div>
          <div>
            <span className="label">Linked World</span>
            <strong>{linkedWorld?.name ?? "없음"}</strong>
          </div>
          <div>
            <span className="label">Camera Trajectory</span>
            <strong>{clip.cameraPathNodeId ?? clip.cameraTrajectoryNodeId ?? "—"}</strong>
          </div>
        </div>

        <label className="stack compact">
          <span>Source Image</span>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                setDraft({ imageName: file.name });
              }
            }}
          />
          {draft.imageName && <span className="muted">{draft.imageName}</span>}
        </label>

        <label className="stack compact">
          <span>Optional Prompt</span>
          <input
            type="text"
            value={draft.prompt}
            placeholder="카페 내부, 따뜻한 조명…"
            onChange={(event) => setDraft({ prompt: event.target.value })}
          />
        </label>

        <label className="stack compact">
          <span>Camera Trajectory Label</span>
          <input
            type="text"
            value={draft.trajectoryLabel}
            onChange={(event) => setDraft({ trajectoryLabel: event.target.value })}
          />
        </label>

        <div className="button-row">
          <button type="button" disabled={isRunning} onClick={() => void runGeneration()}>
            {isRunning ? "Generating…" : "Run WorldGenerateNode"}
          </button>
        </div>

        <div className="stack compact">
          <h3>Job Status</h3>
          {job ? (
            <>
              <p>
                <strong>{job.status}</strong> — {job.message}
              </p>
              {job.status === "running" && (
                <progress max={1} value={job.progress} style={{ width: "100%" }} />
              )}
              {job.error && <p className="muted">{job.error}</p>}
            </>
          ) : (
            <p className="muted">
              {linkedWorld?.generatedBy
                ? `Restored execution ${linkedWorld.generatedBy.id} (${linkedWorld.generatedBy.status}) — model not re-called.`
                : "idle"}
            </p>
          )}
        </div>

        <div className="stack compact">
          <h3>Artifacts</h3>
          <ul className="artifact-list">
            <li>
              GeneratedSegment: {job?.output?.generatedSegmentPath ?? linkedWorld?.generatedSegmentPath ?? "—"}
            </li>
            <li>
              SpatialMemory: {job?.output?.spatialMemoryPath ?? linkedWorld?.spatialMemoryPath ?? "—"}
            </li>
            <li>
              3DGS: {job?.output?.visualLayer3dgsPath ?? linkedWorld?.visualLayer3dgsPath ?? "—"}
            </li>
            <li>
              Mesh: {job?.output?.surfaceMeshPath ?? linkedWorld?.surfaceMeshPath ?? "—"}
            </li>
            <li>
              Memory coverage:{" "}
              {job?.output?.memoryCoverage !== undefined
                ? `${Math.round(job.output.memoryCoverage * 100)}%`
                : linkedWorld?.memoryCoverage !== undefined
                  ? `${Math.round(linkedWorld.memoryCoverage * 100)}%`
                  : "—"}
            </li>
            <li>
              New generated area:{" "}
              {job?.output?.generatedAreaRatio !== undefined
                ? `${Math.round(job.output.generatedAreaRatio * 100)}%`
                : linkedWorld?.generatedAreaRatio !== undefined
                  ? `${Math.round(linkedWorld.generatedAreaRatio * 100)}%`
                  : "—"}
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
};
