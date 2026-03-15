import { useEditorStore } from "../../state/editorStore";

const WORLD_MODES = ["referenced", "image_based", "structured_3d", "3dgs", "4dgs"] as const;

export const StagePanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const clip = project.clips[ui.selectedClipId];
  const world = clip.linkedWorldId ? project.worlds[clip.linkedWorldId] : undefined;
  const graph = project.clipGraphs[clip.clipGraphId];
  const proxyCache = clip.proxyCacheId ? project.caches[clip.proxyCacheId] : undefined;

  return (
    <section className="panel stage-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">World Module / Stage Viewer</p>
          <h2>Stage</h2>
        </div>
        <div className="button-row">
          <button onClick={() => dispatch({ type: "capture-keyframe", clipId: clip.id })}>
            Capture Keyframe
          </button>
          <button onClick={() => dispatch({ type: "render-proxy", clipId: clip.id })}>
            Refresh Preview
          </button>
        </div>
      </div>

      <div className="stage-layout">
        <div className="stage-canvas">
          <div className="viewport-overlay">
            <span>{world?.name ?? "No world linked"}</span>
            <span>mode: {clip.worldMode ?? "unassigned"}</span>
            <span>playhead: {project.sequences[project.activeSequenceId].playhead}f</span>
          </div>
          <div className="viewport-body">
            <h3>{world?.name ?? "World Pending"}</h3>
            <p>{world?.description ?? "Generate World 또는 Reference World를 선택하세요."}</p>
            <ul>
              {(world?.elements ?? []).map((element) => (
                <li key={element.id}>
                  <strong>{element.name}</strong> <span>{element.kind}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="stage-controls">
          <div className="control-group">
            <h3>World Mode</h3>
            {Object.values(project.worlds).map((candidateWorld) => (
              <div key={candidateWorld.id} className="stack compact">
                <strong>{candidateWorld.name}</strong>
                <div className="button-row wrap">
                  {WORLD_MODES.map((mode) => (
                    <button
                      key={mode}
                      onClick={() =>
                        dispatch({
                          type: "set-world",
                          clipId: clip.id,
                          worldId: candidateWorld.id,
                          worldMode: mode,
                        })
                      }
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="control-group">
            <h3>CraftableCinematic</h3>
            <div className="button-row wrap">
              <button onClick={() => dispatch({ type: "set-camera-rig", clipId: clip.id, rig: "dolly" })}>
                Dolly
              </button>
              <button onClick={() => dispatch({ type: "set-camera-rig", clipId: clip.id, rig: "handheld" })}>
                Handheld
              </button>
              <button onClick={() => dispatch({ type: "set-camera-rig", clipId: clip.id, rig: "crane" })}>
                Crane
              </button>
              <button onClick={() => dispatch({ type: "set-lighting-rig", clipId: clip.id, rig: "3-point" })}>
                3-Point Light
              </button>
              <button onClick={() => dispatch({ type: "set-lighting-rig", clipId: clip.id, rig: "sunset" })}>
                Sunset Light
              </button>
              <button onClick={() => dispatch({ type: "set-lighting-rig", clipId: clip.id, rig: "neon" })}>
                Neon Light
              </button>
            </div>
            <div className="button-row wrap">
              <button onClick={() => dispatch({ type: "apply-shot-preset", clipId: clip.id, preset: "WS" })}>
                WS
              </button>
              <button onClick={() => dispatch({ type: "apply-shot-preset", clipId: clip.id, preset: "MS" })}>
                MS
              </button>
              <button onClick={() => dispatch({ type: "apply-shot-preset", clipId: clip.id, preset: "CU" })}>
                CU
              </button>
              <button onClick={() => dispatch({ type: "apply-shot-preset", clipId: clip.id, preset: "OTS" })}>
                OTS
              </button>
            </div>
          </div>

          <div className="control-group">
            <h3>Preview / Cache</h3>
            <p>{proxyCache?.previewText ?? "proxy preview not generated yet"}</p>
            <div className="preview-stack">
              {graph.previewFrames.map((frame) => (
                <div key={frame} className="preview-frame">
                  {frame}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
