import type { Shot, ShotCommand } from "../shot";
import { selectedTake } from "../shot";
import type { ResolveContext, TargetResolver } from "../worlds/query";
import { ActionGraphValidator, type ActionGraphIssue, type Event } from "./actionGraph";
import { ContactSolver } from "./contactSolver";
import { StubMotionModel, type MotionEventInput, type MotionModelAdapter } from "./motionModel";
import type { Speech2MotionScene } from "./preserveVerifier";
import { ShotPoseAdapter } from "./shotPoseAdapter";

export interface Speech2MotionRequest {
  graph: unknown;
  shot: Shot;
  targetResolver: TargetResolver;
  model?: MotionModelAdapter;
}

export type Speech2MotionResult =
  | { ok: false; errors: ActionGraphIssue[] }
  | { ok: true; scene: Speech2MotionScene; commands: readonly ShotCommand[] };

/**
 * parseReady → motion adapter → contact IK → shot-record pose keys.
 * The returned `ShotCommand`s are the scene patch. Callers send them through the
 * existing command bus (`{ type: "SHOT" }` inside `APPLY_COMMANDS`). This class does not apply them.
 */
export class Speech2MotionPipeline {
  static run(request: Speech2MotionRequest): Speech2MotionResult {
    const parsed = ActionGraphValidator.parseReady(request.graph);
    if (!parsed.ok) return parsed;
    const graph = parsed.graph;
    if (graph.shot_id !== request.shot.id) {
      return {
        ok: false,
        errors: [{ path: ["shot_id"], message: "Action Graph의 shot_id가 샷 기록과 다릅니다.", code: "shot_mismatch" }],
      };
    }
    const shotFps = request.shot.time.fps;
    if (graph.fps !== shotFps) {
      return {
        ok: false,
        errors: [{
          path: ["fps"],
          message: "Action Graph의 fps는 Shot.time.fps와 같아야 합니다.",
          code: "fps_mismatch",
        }],
      };
    }
    const frameCount = request.shot.time.durationFrames;
    const model = request.model ?? new StubMotionModel();
    const inferred = model.infer({
      shotFps,
      frameCount,
      actors: graph.actors.map((actor) => ({ actorId: actor.actor_id })),
      events: graph.events.map((event) => Speech2MotionPipeline.eventInput(event)),
    });
    const solved = ContactSolver.solve({
      sequences: inferred,
      contacts: graph.contact_graph,
      frameCount,
      locateObject: (objectId) => Speech2MotionPipeline.locate(request.shot, request.targetResolver, objectId),
      locateSurface: (query) => Speech2MotionPipeline.locate(request.shot, request.targetResolver, query),
    });
    const scene: Speech2MotionScene = {
      shotId: request.shot.id,
      fps: shotFps,
      frameCount,
      camera: Speech2MotionPipeline.cameraSlice(request.shot),
      background: Speech2MotionPipeline.backgroundSlice(request.shot),
      setLayout: Speech2MotionPipeline.layoutSlice(request.shot),
      renderPasses: { ids: [] as string[] },
      actors: solved.sequences,
      objects: solved.objects,
      attachments: solved.attachments,
      contacts: solved.contacts,
    };
    return { ok: true, scene, commands: Speech2MotionPipeline.commands(request.shot, scene) };
  }

  /**
   * Object placement is read from the shot only after TargetResolver accepts the reference.
   * An empty resolve does not fall through to a shot-name scan.
   */
  static locate(shot: Shot, resolver: TargetResolver, ref: string): { position: readonly [number, number, number]; subjectId?: string } | undefined {
    const context: ResolveContext = {
      selectionIds: shot.environment ? [shot.environment.worldId] : [],
      locale: "en",
    };
    const matches = resolver.resolve(ref, context);
    if (matches.length === 0) return undefined;
    const match = matches.find((item) => item.kind === "prop") ?? matches[0]!;
    const subject = shot.subjects.find((item) => {
      if (item.kind === "light") return false;
      if (match.instanceId && item.id === match.instanceId) return true;
      if (match.elementId && item.id === match.elementId) return true;
      return item.name === match.displayName;
    });
    if (!subject || subject.kind === "light") return undefined;
    return {
      position: [subject.placement.position[0], subject.placement.position[1], subject.placement.position[2]],
      subjectId: subject.id,
    };
  }

  private static eventInput(event: Event): MotionEventInput {
    return {
      actorId: event.actor_id,
      startFrame: event.start_frame,
      endFrame: event.end_frame,
      text: event.text_condition,
      trajectory: event.trajectory_condition?.points.map((point) => ({
        frame: point.frame,
        position: point.position,
        heading: point.heading,
      })),
    };
  }

  /** Preserve reads `CameraTake.id` from the selected take. The id is not rewritten. */
  private static cameraSlice(shot: Shot): unknown {
    if (shot.camera.status === "empty") {
      return { status: "empty", lens: shot.camera.lens, interpolation: shot.camera.interpolation, cameraTrackId: null };
    }
    const take = selectedTake(shot);
    return {
      status: "ready",
      lens: shot.camera.lens,
      interpolation: shot.camera.interpolation,
      cameraTrackId: take?.id ?? shot.camera.selectedTakeId,
      keys: take?.keys ?? [],
    };
  }

  private static backgroundSlice(shot: Shot): unknown {
    return {
      environment: shot.environment ?? null,
      lights: shot.subjects.flatMap((subject) =>
        subject.kind === "light"
          ? [{ id: subject.id, placement: subject.placement, intensity: subject.intensity, color: subject.color }]
          : [],
      ),
    };
  }

  private static layoutSlice(shot: Shot): unknown {
    return {
      environment: shot.environment?.worldId ?? null,
      objects: shot.subjects.flatMap((subject) =>
        subject.kind === "object" ? [{ id: subject.id, placement: subject.placement }] : [],
      ),
    };
  }

  private static commands(shot: Shot, scene: Speech2MotionScene): ShotCommand[] {
    const commands: ShotCommand[] = [];
    for (const sequence of scene.actors) {
      const subject = ShotPoseAdapter.subjectForActor(shot, sequence.actorId);
      const keys = ShotPoseAdapter.rootKeys(sequence).filter((key) => key.frame >= 0 && key.frame < shot.time.durationFrames);
      const next = subject ? ShotPoseAdapter.withKeys(subject, keys) : undefined;
      if (subject && next && JSON.stringify(subject) !== JSON.stringify(next)) {
        commands.push({ type: "REPLACE_SUBJECT", shotId: shot.id, subject: next });
      }
    }
    return commands;
  }
}
