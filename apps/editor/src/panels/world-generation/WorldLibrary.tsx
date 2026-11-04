import { useMemo, useState } from "react";
import { useEditorStore } from "../../state/editorStore";
import type { WorldRepresentation } from "../../domain/worlds/types";
import { filterWorldLibrary, listWorldLibrary } from "../../domain/worlds/library";
import { findWorldReferenceNode } from "../../application/services/worldLinking";

const isImageUri = (uri?: string) => Boolean(uri && /\.(png|jpe?g|webp|gif)$/i.test(uri));

const representations: Array<WorldRepresentation | "all"> = [
  "all",
  "mesh",
  "gaussian_splat",
  "point_cloud",
  "usd_stage",
  "image_based_proxy",
  "video_based_proxy",
  "hybrid",
];

export const WorldLibrary = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();
  const [query, setQuery] = useState("");
  const [rep, setRep] = useState<WorldRepresentation | "all">("all");
  const [tags, setTags] = useState<string>("");

  const items = useMemo(() => listWorldLibrary(project.worlds), [project.worlds]);
  const filtered = useMemo(
    () =>
      filterWorldLibrary(items, {
        query,
        representation: rep,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    [items, query, rep, tags],
  );

  const clip = ui.selectedClipId ? project.clips[ui.selectedClipId] : undefined;

  return (
    <section className="world-library">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Library</p>
          <h2>3D Worlds</h2>
        </div>
      </div>

      <div className="stack compact">
        <div className="filter-row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="search"
            placeholder="Search by name, id, or tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: "1 1 240px" }}
          />
          <select value={rep} onChange={(e) => setRep(e.target.value as any)}>
            {representations.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Tags (comma-separated)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            style={{ flex: "0 1 200px" }}
          />
        </div>
        <p className="muted">
          {filtered.length} result{filtered.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="stack">
        {filtered.length === 0 ? (
          <p className="muted">No worlds found.</p>
        ) : (
          filtered.map(({ world }) => {
            const alreadyLinked = Boolean(
              clip && (clip.linkedWorldId === world.id || findWorldReferenceNode(project, clip.id, world.id)),
            );
            return (
              <article key={world.id} className="world-result-card">
                <div className="world-result-preview">
                  {isImageUri(world.previewUri) ? (
                    <img src={world.previewUri} alt="" />
                  ) : (
                    <div className="world-result-placeholder">{world.representation}</div>
                  )}
                </div>
                <div className="world-result-body">
                  <div className="world-result-header">
                    <h3>{world.name}</h3>
                    <span className="muted" title={world.id}>
                      {world.id}
                    </span>
                  </div>
                  <p className="muted">
                    {world.representation}
                    {world.semanticTags?.length ? ` · ${world.semanticTags.join(", ")}` : ""}
                  </p>
                  <div className="button-row wrap">
                    <button type="button" onClick={() => dispatch({ type: "preview-world", worldId: world.id })}>
                      Preview in Viewport
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!clip}
                      title={
                        !clip
                          ? "타임라인에서 클립을 먼저 선택하세요."
                          : alreadyLinked
                            ? "이미 현재 클립에 연결되어 있습니다."
                            : "현재 클립에 WorldReferenceNode로 연결합니다."
                      }
                      onClick={() =>
                        clip &&
                        dispatch({ type: "set-world", clipId: clip.id, worldId: world.id, worldMode: "referenced" })
                      }
                    >
                      {alreadyLinked ? "Already in Current Clip" : "Use in Current Clip"}
                    </button>
                  </div>
                  {!clip && <p className="muted">현재 선택된 클립이 없어 연결할 수 없습니다.</p>}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
};

