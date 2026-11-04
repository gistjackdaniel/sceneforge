import { useMemo } from "react";
import type { PosePresetId, HandPresetId } from "../../domain/performance";
import { POSE_PRESETS } from "../../domain/performance";

export interface PoseGizmoOverlayProps {
  selectedActorId?: string;
  frame: number;
  canEdit: boolean;
  onApplyPreset: (preset: PosePresetId, hand?: { side: "left" | "right"; preset: HandPresetId }) => void;
  onAddKeyframe: () => void;
  onRemoveKeyframe: () => void;
}

/**
 * Minimal UI overlay to apply pose presets and manage keyframes.
 * Mount this inside the Stage panel when an actor is selected.
 *
 * Note: Joint picking and rotation gizmo live in the viewport runtime.
 * This overlay focuses on preset application and keyframe list actions
 * to keep Stage code changes minimal for the MVP.
 */
export const PoseGizmoOverlay = ({
  selectedActorId,
  frame,
  canEdit,
  onApplyPreset,
  onAddKeyframe,
  onRemoveKeyframe,
}: PoseGizmoOverlayProps) => {
  const presets = useMemo(() => POSE_PRESETS, []);
  if (!selectedActorId) return null;
  return (
    <div className="pose-gizmo-overlay" style={{ position: "absolute", right: 12, top: 12, display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 600 }}>Pose · {selectedActorId} · {frame}f</div>
      <div style={{ display: "grid", gap: 6 }}>
        <label>
          Preset
          <select disabled={!canEdit} onChange={(e) => { const id = e.target.value as PosePresetId; if (id) onApplyPreset(id); }}>
            <option value="">Choose…</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <button disabled={!canEdit} onClick={() => onApplyPreset("t_pose")}>T-pose</button>
          <button disabled={!canEdit} onClick={() => onApplyPreset("idle")}>Idle</button>
          <button disabled={!canEdit} onClick={() => onApplyPreset("point", { side: "right", preset: "point" })}>Point</button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button disabled={!canEdit} onClick={onAddKeyframe}>Add key</button>
          <button disabled={!canEdit} onClick={onRemoveKeyframe}>Delete key</button>
        </div>
        <small>Hand presets are coarse: Open, Fist, Point, Relaxed.</small>
      </div>
    </div>
  );
};

