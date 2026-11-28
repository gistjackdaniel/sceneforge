import { Group, Matrix4, Quaternion, Vector3, type Object3D } from "three";
import type { sampleTimelineMotion } from "../../domain/sceneAuthoring/sampleTimelineMotion";
import { applyLiveFace, bindFaceRig, type LiveFaceFrame } from "../scene/faceRig";
import { applySomaFrame, bindSomaRig } from "../scene/somaRetarget";
import { aimUpperBody } from "../scene/upperBody";

export type ViewportActorMotion = ReturnType<typeof sampleTimelineMotion>;

export const bindViewportActorMotion = (placement: Object3D, model: Object3D) => {
  const root = new Group();
  root.matrixAutoUpdate = false;
  root.add(model);
  const body = bindSomaRig(root);
  const face = bindFaceRig(root);
  const rest = body.joints.map(({ bone }) => ({ bone, position: bone.position.clone(), rotation: bone.quaternion.clone() }));
  placement.add(root);

  let previousMotion: ViewportActorMotion | undefined;
  let previousFace: LiveFaceFrame | null = null;
  let aimed = false;
  const previousPlacement = new Matrix4();
  const target = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  return {
    support: { body: body.joints.length > 3 && body.joints.some((joint) => joint.sourceName === "Hips"), face: face.length > 0 },
    update(subjectId: string, pose: ViewportActorMotion | undefined, expression: LiveFaceFrame | null) {
      // The webcam aims the upper body from the pose underneath it, so that pose is laid down again while it aims.
      const aims = expression?.subjectId === subjectId ? expression.body : undefined;
      const reposing = Boolean(aims) || aimed;
      if (pose?.source) {
        placement.updateWorldMatrix(true, false);
        if (reposing || pose !== previousMotion || !previousPlacement.equals(placement.matrixWorld)) {
          target.compose(position.fromArray(pose.position), rotation.fromArray(pose.rotation), scale.fromArray(pose.scale));
          root.matrix.copy(placement.matrixWorld).invert().multiply(target);
          root.matrixWorldNeedsUpdate = true;
          root.updateWorldMatrix(false, false);
          applySomaFrame(body, pose.source.motion, pose.source.sample);
          previousPlacement.copy(placement.matrixWorld);
        }
      } else if (previousMotion?.source || reposing) {
        root.matrix.identity();
        root.matrixWorldNeedsUpdate = true;
        for (const entry of rest) {
          entry.bone.position.copy(entry.position);
          entry.bone.quaternion.copy(entry.rotation);
        }
        root.updateWorldMatrix(false, true);
      }
      if (aims) aimUpperBody(body, aims);
      aimed = Boolean(aims);
      previousMotion = pose;
      if (expression !== previousFace) {
        applyLiveFace(face, subjectId, expression);
        previousFace = expression;
      }
    },
  };
};
