import { describe, expect, it } from "vitest";
import { ActionGraphSchema, ActionGraphValidator, type ActionGraphIssue } from "./index";

interface SelectorDraft {
  kind: string;
  actor_id?: string;
  contact_id?: string;
}

interface HandshakeDraft {
  schema_version: "0.1";
  graph_version: string;
  shot_id: string;
  fps: number;
  frame_range: { start_frame: number; end_frame: number };
  status: "ready" | "needs_clarification";
  clarifications: Array<{ clarification_id: string; question: string; entity_ref?: string }>;
  actors: Array<{ actor_id: string; rig: "smplx"; speaker_id?: string; style_ref?: string }>;
  utterances: Array<{
    utterance_id: string;
    actor_id: string;
    audio_ref: string;
    start_frame: number;
    end_frame: number;
    transcript: string;
  }>;
  events: Array<{
    event_id: string;
    actor_id: string;
    action_type: string;
    utterance_id?: string;
    start_frame: number;
    end_frame: number;
    relation?: { type: "before" | "after" | "while"; ref_event_id: string; offset_frames: number };
    text_condition?: string;
    trajectory_condition?: {
      space: "world";
      points: Array<{ frame: number; position: [number, number, number]; heading?: number }>;
    };
    contact_ids?: string[];
  }>;
  contact_graph: Array<{
    contact_id: string;
    a: { actor_id: string; part: string };
    b: { actor_id?: string; object_id?: string; part?: string };
    start_frame: number;
    end_frame: number;
    type: "grasp" | "strike" | "support" | "place";
    impulse_N_s?: number | null;
  }>;
  edit: {
    edit_id: string;
    base_graph_version: string;
    operation: string;
    source: { type: "voice" | "text" | "manual"; transcript?: string };
    recompute: SelectorDraft[];
    preserve: SelectorDraft[];
  };
}

/**
 * 합의 문서의 "B를 오른손 악수로 바꾸기" 예시.
 * operation은 change_contact_effector이고, preserve/recompute 셀렉터는 문서와 같다.
 */
function handshakeFixture(): HandshakeDraft {
  return {
    schema_version: "0.1",
    graph_version: "7",
    shot_id: "shot_handshake",
    fps: 24,
    frame_range: { start_frame: 0, end_frame: 72 },
    status: "ready",
    clarifications: [],
    actors: [
      { actor_id: "actor_A", rig: "smplx", style_ref: "style_neutral" },
      { actor_id: "actor_B", rig: "smplx", speaker_id: "spk_b" },
    ],
    utterances: [
      {
        utterance_id: "utt_b_handshake",
        actor_id: "actor_B",
        audio_ref: "audio/b-handshake.wav",
        start_frame: 12,
        end_frame: 48,
        transcript: "악수하자",
      },
    ],
    events: [
      {
        event_id: "evt_handshake",
        actor_id: "actor_B",
        action_type: "handshake",
        utterance_id: "utt_b_handshake",
        start_frame: 24,
        end_frame: 60,
        relation: { type: "after", ref_event_id: "evt_approach", offset_frames: 6 },
        text_condition: "오른손으로 악수",
        trajectory_condition: {
          space: "world",
          points: [
            { frame: 24, position: [0.2, 1.1, 0.4], heading: 0.3 },
            { frame: 60, position: [0.35, 1.05, 0.55] },
          ],
        },
        contact_ids: ["handshake_01"],
      },
      {
        event_id: "evt_approach",
        actor_id: "actor_A",
        action_type: "approach",
        start_frame: 0,
        end_frame: 24,
      },
    ],
    contact_graph: [
      {
        contact_id: "handshake_01",
        a: { actor_id: "actor_A", part: "right_hand" },
        b: { actor_id: "actor_B", part: "right_hand" },
        start_frame: 36,
        end_frame: 60,
        type: "grasp",
        impulse_N_s: null,
      },
    ],
    edit: {
      edit_id: "edit_handshake",
      base_graph_version: "6",
      operation: "change_contact_effector",
      source: { type: "voice", transcript: "B를 오른손 악수로 바꾸기" },
      recompute: [
        { kind: "motion", actor_id: "actor_B" },
        { kind: "contact", contact_id: "handshake_01" },
        { kind: "render_passes" },
      ],
      preserve: [
        { kind: "camera_track" },
        { kind: "root_motion", actor_id: "actor_A" },
        { kind: "set_layout" },
        { kind: "background" },
      ],
    },
  };
}

function errorsOf(input: unknown): ActionGraphIssue[] {
  const result = ActionGraphValidator.parseReady(input);
  return result.ok ? [] : result.errors;
}

function expectCode(input: unknown, code: string, path: Array<string | number>): void {
  expect(errorsOf(input)).toEqual(expect.arrayContaining([expect.objectContaining({ code, path })]));
}

describe("ActionGraph handshake fixture", () => {
  it("B를 오른손 악수로 바꾸는 ready 그래프를 받는다", () => {
    const fixture = handshakeFixture();
    const result = ActionGraphValidator.parseReady(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.graph.edit?.operation).toBe("change_contact_effector");
    expect(result.graph.edit?.recompute).toEqual([
      { kind: "motion", actor_id: "actor_B" },
      { kind: "contact", contact_id: "handshake_01" },
      { kind: "render_passes" },
    ]);
    expect(result.graph.edit?.preserve).toEqual([
      { kind: "camera_track" },
      { kind: "root_motion", actor_id: "actor_A" },
      { kind: "set_layout" },
      { kind: "background" },
    ]);
    expect(result.graph.contact_graph[0]?.b).toEqual({ actor_id: "actor_B", part: "right_hand" });
    expect(result.graph.fps).toBe(24);
    expect(ActionGraphSchema.parse(fixture)).toEqual(result.graph);
  });

  it("시작 프레임과 끝 프레임이 같으면 통과한다", () => {
    const graph = handshakeFixture();
    graph.frame_range = { start_frame: 12, end_frame: 12 };
    graph.contact_graph[0].start_frame = 40;
    graph.contact_graph[0].end_frame = 40;
    expect(ActionGraphValidator.parseReady(graph).ok).toBe(true);
  });

  it("음수 offset_frames는 정수이면 통과한다", () => {
    const graph = handshakeFixture();
    graph.events[0].relation = { type: "before", ref_event_id: "evt_approach", offset_frames: -3 };
    expect(ActionGraphValidator.parseReady(graph).ok).toBe(true);
  });

  it("같은 kind라도 actor_id가 다르면 preserve와 recompute에 함께 둘 수 있다", () => {
    const graph = handshakeFixture();
    graph.edit.recompute.push({ kind: "root_motion", actor_id: "actor_B" });
    expect(ActionGraphValidator.parseReady(graph).ok).toBe(true);
  });

  it("object_id만 있는 contact는 part 없이도 통과한다", () => {
    const graph = handshakeFixture();
    graph.contact_graph.push({
      contact_id: "cup_place",
      a: { actor_id: "actor_A", part: "left_hand" },
      b: { object_id: "cup_01" },
      start_frame: 10,
      end_frame: 10,
      type: "place",
      impulse_N_s: 1.5,
    });
    expect(ActionGraphValidator.parseReady(graph).ok).toBe(true);
  });

  it("rig part enum은 World 레인과 같은 여섯 값만 받는다", () => {
    for (const part of ["left_hand", "right_hand", "left_foot", "right_foot", "head", "pelvis"]) {
      const graph = handshakeFixture();
      graph.contact_graph[0].a.part = part;
      expect(ActionGraphValidator.parseReady(graph).ok).toBe(true);
    }
    const invalid = handshakeFixture();
    invalid.contact_graph[0].a.part = "left_elbow";
    expect(ActionGraphValidator.parseReady(invalid).ok).toBe(false);
  });
});

describe("ActionGraph frame rules", () => {
  it.each([
    ["frame_range.start_frame", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.frame_range.start_frame = 0.5;
    }, ["frame_range", "start_frame"]],
    ["utterances.end_frame", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.utterances[0].end_frame = 48.2;
    }, ["utterances", 0, "end_frame"]],
    ["events.start_frame", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.events[0].start_frame = 24.1;
    }, ["events", 0, "start_frame"]],
    ["relation.offset_frames", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.events[0].relation = { type: "after", ref_event_id: "evt_approach", offset_frames: 1.5 };
    }, ["events", 0, "relation", "offset_frames"]],
    ["trajectory point frame", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.events[0].trajectory_condition?.points[0] && (graph.events[0].trajectory_condition.points[0].frame = 24.9);
    }, ["events", 0, "trajectory_condition", "points", 0, "frame"]],
    ["contact_graph.end_frame", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.contact_graph[0].end_frame = 60.4;
    }, ["contact_graph", 0, "end_frame"]],
  ])("%s 가 정수가 아니면 integer_frame이다", (_label, mutate, path) => {
    const graph = handshakeFixture();
    mutate(graph);
    expectCode(graph, "integer_frame", path);
  });

  it.each([
    ["frame_range", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.frame_range.end_frame = -1;
    }, ["frame_range", "end_frame"]],
    ["utterance", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.utterances[0].start_frame = 40;
      graph.utterances[0].end_frame = 12;
    }, ["utterances", 0, "end_frame"]],
    ["event", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.events[1].start_frame = 30;
      graph.events[1].end_frame = 10;
    }, ["events", 1, "end_frame"]],
    ["contact", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.contact_graph[0].start_frame = 70;
      graph.contact_graph[0].end_frame = 36;
    }, ["contact_graph", 0, "end_frame"]],
  ])("%s 의 시작 프레임이 끝 프레임보다 크면 frame_order이다", (_label, mutate, path) => {
    const graph = handshakeFixture();
    mutate(graph);
    expectCode(graph, "frame_order", path);
  });

  it("정수가 아니면서 순서가 뒤집히면 두 규칙을 함께 보고한다", () => {
    const graph = handshakeFixture();
    graph.events[0].start_frame = 10.5;
    graph.events[0].end_frame = 4;
    const codes = errorsOf(graph).map((error) => `${error.code}:${error.path.join(".")}`);
    expect(codes).toEqual(expect.arrayContaining(["integer_frame:events.0.start_frame", "frame_order:events.0.end_frame"]));
  });
});

describe("ActionGraph edit selectors", () => {
  it.each([
    ["recompute motion", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.edit.recompute[0] = { kind: "motion" };
    }, ["edit", "recompute", 0, "actor_id"]],
    ["preserve root_motion", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.edit.preserve[1] = { kind: "root_motion" };
    }, ["edit", "preserve", 1, "actor_id"]],
  ])("%s 에 actor_id가 없으면 actor_required이다", (_label, mutate, path) => {
    const graph = handshakeFixture();
    mutate(graph);
    expectCode(graph, "actor_required", path);
  });

  it("같은 항목이 preserve와 recompute에 있으면 selector_overlap이다", () => {
    const graph = handshakeFixture();
    graph.edit.recompute.push({ kind: "camera_track" });
    expectCode(graph, "selector_overlap", ["edit", "preserve", 0]);
  });

  it("같은 motion actor가 양쪽에 있으면 selector_overlap이다", () => {
    const graph = handshakeFixture();
    graph.edit.preserve.push({ kind: "motion", actor_id: "actor_B" });
    expectCode(graph, "selector_overlap", ["edit", "preserve", 4]);
  });
});

describe("ActionGraph contact endpoint b", () => {
  it("actor_id와 object_id가 둘 다 있으면 contact_target이다", () => {
    const graph = handshakeFixture();
    graph.contact_graph[0].b = { actor_id: "actor_B", object_id: "cup_01", part: "right_hand" };
    expectCode(graph, "contact_target", ["contact_graph", 0, "b"]);
  });

  it("actor_id와 object_id가 둘 다 없으면 contact_target이다", () => {
    const graph = handshakeFixture();
    graph.contact_graph[0].b = { part: "right_hand" };
    const errors = errorsOf(graph);
    expect(errors).toEqual([expect.objectContaining({ code: "contact_target", path: ["contact_graph", 0, "b"] })]);
  });

  it("b.actor_id가 있고 part가 없으면 contact_part_required이다", () => {
    const graph = handshakeFixture();
    graph.contact_graph[0].b = { actor_id: "actor_B" };
    const errors = errorsOf(graph);
    expect(errors).toEqual([
      expect.objectContaining({ code: "contact_part_required", path: ["contact_graph", 0, "b", "part"] }),
    ]);
  });

  it("actor_id와 object_id가 둘 다 있고 part가 없으면 두 규칙을 함께 보고한다", () => {
    const graph = handshakeFixture();
    graph.contact_graph[0].b = { actor_id: "actor_B", object_id: "cup_01" };
    const codes = errorsOf(graph).map((error) => error.code).sort();
    expect(codes).toEqual(["contact_part_required", "contact_target"]);
  });
});

describe("ActionGraph references", () => {
  it.each([
    ["event actor", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.events[0].actor_id = "actor_missing";
    }, ["events", 0, "actor_id"]],
    ["utterance actor", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.utterances[0].actor_id = "actor_missing";
    }, ["utterances", 0, "actor_id"]],
    ["contact a actor", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.contact_graph[0].a.actor_id = "actor_missing";
    }, ["contact_graph", 0, "a", "actor_id"]],
    ["contact b actor", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.contact_graph[0].b.actor_id = "actor_missing";
    }, ["contact_graph", 0, "b", "actor_id"]],
    ["preserve actor", (graph: ReturnType<typeof handshakeFixture>) => {
      graph.edit.preserve[1] = { kind: "root_motion", actor_id: "actor_missing" };
    }, ["edit", "preserve", 1, "actor_id"]],
  ])("%s 가 actors에 없으면 unknown_actor이다", (_label, mutate, path) => {
    const graph = handshakeFixture();
    mutate(graph);
    expectCode(graph, "unknown_actor", path);
  });

  it("없는 utterance_id는 unknown_utterance이다", () => {
    const graph = handshakeFixture();
    graph.events[0].utterance_id = "utt_missing";
    expectCode(graph, "unknown_utterance", ["events", 0, "utterance_id"]);
  });

  it("없는 ref_event_id는 unknown_event이다", () => {
    const graph = handshakeFixture();
    graph.events[0].relation = { type: "while", ref_event_id: "evt_missing", offset_frames: 0 };
    expectCode(graph, "unknown_event", ["events", 0, "relation", "ref_event_id"]);
  });

  it("없는 contact_ids 항목은 unknown_contact이다", () => {
    const graph = handshakeFixture();
    graph.events[0].contact_ids = ["missing_contact"];
    expectCode(graph, "unknown_contact", ["events", 0, "contact_ids", 0]);
  });

  it("없는 contact 셀렉터는 unknown_contact이다", () => {
    const graph = handshakeFixture();
    graph.edit.recompute[1] = { kind: "contact", contact_id: "missing_contact" };
    expectCode(graph, "unknown_contact", ["edit", "recompute", 1, "contact_id"]);
  });
});

describe("ActionGraphValidator.parseReady", () => {
  it("needs_clarification은 스키마로는 통과하고 Video 진입점에서는 거절한다", () => {
    const graph = handshakeFixture();
    graph.status = "needs_clarification";
    graph.clarifications = [
      { clarification_id: "clarify_hand", question: "어느 손인가요?", entity_ref: "actor_B" },
    ];
    expect(ActionGraphSchema.safeParse(graph).success).toBe(true);
    const result = ActionGraphValidator.parseReady(graph);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toEqual([
      {
        path: ["status"],
        message: 'status가 "needs_clarification"인 그래프는 Video 레인에서 받지 않습니다.',
        code: "needs_clarification",
      },
    ]);
  });

  it("형태가 깨진 입력도 예외 없이 구조화된 오류를 돌려준다", () => {
    expect(() => ActionGraphValidator.parseReady(null)).not.toThrow();
    const result = ActionGraphValidator.parseReady({ schema_version: "0.1", fps: "24" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => typeof error.message === "string" && Array.isArray(error.path))).toBe(true);
    expect(result.errors.some((error) => error.code === "invalid_type")).toBe(true);
  });
});
