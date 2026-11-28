# Shot record

## Usage

Stage reads `project.shots[selectedClipId]`. Every edit is a `SHOT` command. `prepareModelInput` derives the only model payload. A render finishes by appending a receipt; it does not replace subjects or the camera.

## Public surface

`domain/shot` exports the shot schema, `applyShotCommand`, pose and camera queries, `generateHash`, and `prepareModelInput`. Callers do not import the command switch or the payload assembler internals.

## Synthesis decision

The stored document is the shot list (candidate B). The model payload is derived, so a connector change does not change shot fields. Commands stay on the existing command bus. The domain module does not save files or call the network.

Taken from the other sketch: user-facing failure copy, a hash that ignores display names, deleting the last explicit key returns to unset, and migration is a named function. A selected take turns Generate on. Missing geometry is reported by `prepareModelInput`, not by disabling the button.

Rejected: a domain session that owns save and the connector, using the recipe JSON as the wire body, committing pose text only on blur, making the subject id the asset id, dropping explicit keys when a text prompt also exists, rejecting multi-clip files, storing object rotation as quaternions, and a connector id of `none` that does not accept the payload.

The cross-family design review did not run. The other model families were blocked by weekly usage limits.

## Deviations

`Project.shots` is optional so existing graph fixtures still typecheck. Load and the live editor always fill it. Stage stops writing placement, trajectory, and camera nodes. Those nodes are a one-way migration source.

Envelope version 3 is not introduced. Worlds, assets, and the clip shell stay because the viewport and current serialization tests use them.

Mounted Stage also edits visibility, lock, light color, camera interpolation, and trim, so those writes are shot commands too. Camera presets are expanded by the existing rig helper before the shot command stores the keys.

`marker` is a representation. Shared primitive asset ids are `primitive:box`, `primitive:sphere`, `primitive:light`, and `primitive:marker`.

Object rotation stays `rotationEuler`. `SHOT_EULER_ORDER` is `XYZ` (Scene 레인 확정, `StageViewport.tsx`). The coordinate-contract boundary converts that euler to a quaternion. The shot document does not store object rotation as a quaternion.

A posed subject also carries a persistent `instanceId` and an `{ assetId, revisionId }` pin. Integer `assetVersion` N maps to revision id `rev_legacy_<asset>__vN`. Older `subject-*`, `primitive:*`, and `file:*` ids stay in `legacyRefs`. Take ids stay opaque strings.

Camera export stays Backbone `convention: "opencv_c2w"` (`frames[].c2w`). This module does not rebuild that matrix.

`REPLACE_SUBJECT`, `REPLACE_CAMERA`, `REPLACE_SHOT`, and `DROP_RENDER` exist so undo can restore a previous subject, camera, or receipt. The panels do not dispatch them except as inverses produced by the command applier.

Playhead and output aspect stay outside the shot. The stub connector id is `stub`, its model version is `none`, and its status is `stubbed`.
