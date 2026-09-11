import type { DomainCommand } from "../../commands";
import type { Project } from "../../../domain/project/types";
import type { TimelineClip } from "../../../domain/timeline/types";
import { createNodeBase } from "../nodeFactory";
import type { GraphEdge } from "../../../domain/graph/types";
import { evaluateShotWorkflow } from "../../../domain/workflow";

export type AgentIntentType =
  | "link_world"
  | "apply_shot_preset"
  | "render_shot";

export interface AgentContext {
  project: Project;
  selectedClip: TimelineClip;
}

export interface AgentPlanStep {
  description: string;
}

export interface AgentPlanPreview {
  intent: AgentIntentType;
  steps: AgentPlanStep[];
  commands: DomainCommand[];
  requiresConfirmation: boolean;
  confirmTitle?: string;
  confirmMessage?: string;
  notes?: string[];
}

export interface AgentExecutionSummary {
  intent: AgentIntentType;
  executedCommands: number;
  messages: string[];
}

const now = () => new Date().toISOString();

export class AgentOrchestrator {
  /** Simple rule-based intent detector for MVP */
  static detectIntent(input: string): AgentIntentType | undefined {
    const text = input.toLowerCase();
    if (text.includes("render") || text.includes("렌더")) {
      return "render_shot";
    }
    if (text.includes("cu") || text.includes("샷") || text.includes("preset") || text.includes("프리셋")) {
      return "apply_shot_preset";
    }
    if (text.includes("world") || text.includes("방") || text.includes("월드") || text.includes("배경")) {
      return "link_world";
    }
    return undefined;
  }

  /** Build a plan for a high-level intent. Does not mutate state. */
  static plan(intent: AgentIntentType, ctx: AgentContext): AgentPlanPreview {
    if (intent === "link_world") {
      const worldId = Object.keys(ctx.project.worlds)[0];
      const worldName = worldId ? ctx.project.worlds[worldId]?.name : undefined;
      const commands: DomainCommand[] = worldId
        ? [{ type: "LINK_CLIP_WORLD", clipId: ctx.selectedClip.id, worldId }]
        : [];
      return {
        intent,
        steps: [{ description: worldId ? `Link clip to world "${worldName ?? worldId}"` : "No available worlds to link" }],
        commands,
        requiresConfirmation: false,
        notes: worldId ? undefined : ["Add or generate a world first."],
      };
    }

    if (intent === "apply_shot_preset") {
      // Create or update a ShotPresetNode and connect it to the RenderSettingsNode
      const clip = ctx.selectedClip;
      const graph = ctx.project.clipGraphs[clip.clipGraphId];
      const renderNodeId = `node-${clip.id}-render`;
      const shotNodeId = `node-${clip.id}-shot`;
      const shotNode = createNodeBase({
        id: shotNodeId,
        name: "Shot Preset",
        kind: "ShotPresetNode",
        category: "cinematic",
        parameters: { preset: "CU" },
        timestamp: now(),
        downstreamNodeIds: [renderNodeId],
      });
      const edge: GraphEdge = {
        id: `edge-${shotNodeId}-to-render`,
        sourceNodeId: shotNodeId,
        sourcePort: "out",
        targetNodeId: renderNodeId,
        targetPort: "in",
        kind: "data",
        label: "frames",
      };
      const commands: DomainCommand[] = [
        { type: "CREATE_NODE", node: shotNode, clipGraphId: graph?.id },
        ...(graph ? [{ type: "CONNECT_NODES", clipGraphId: graph.id, edge }] as DomainCommand[] : []),
      ];
      return {
        intent,
        steps: [
          { description: `Create ShotPresetNode (CU) in clip ${clip.name}` },
          { description: "Connect preset frames → RenderSettingsNode" },
        ],
        commands,
        requiresConfirmation: false,
      };
    }

    if (intent === "render_shot") {
      const clip = ctx.selectedClip;
      const graph = ctx.project.clipGraphs[clip.clipGraphId];
      const shotWorkflow = evaluateShotWorkflow({
        clip,
        graph,
        nodes: ctx.project.nodes,
        worlds: ctx.project.worlds,
        caches: ctx.project.caches,
      });
      const ready = shotWorkflow.readyForRender;
      const steps: AgentPlanStep[] = [{ description: ready ? "Shot contract is ready." : "Finish setup before rendering." }];
      const notes = ready ? undefined : shotWorkflow.blockingIssues;
      return {
        intent,
        steps,
        commands: [], // render execution is triggered outside the domain mutator; REQUEST_RENDER can be added later
        requiresConfirmation: ready,
        confirmTitle: "Render shot?",
        confirmMessage: ready
          ? "이 샷을 렌더링할까요? (최종 렌더는 비용이 발생할 수 있습니다)"
          : "렌더링 전에 샷 설정을 완료하세요.",
        notes,
      };
    }

    return {
      intent,
      steps: [{ description: "No-op" }],
      commands: [],
      requiresConfirmation: false,
    };
  }

  /** Execute a prepared plan via provided bus-adapter. Returns a brief summary for assistant UI. */
  static async execute(
    plan: AgentPlanPreview,
    runDomainCommands: (commands: DomainCommand[], logMessage?: string) => void,
  ): Promise<AgentExecutionSummary> {
    if (plan.commands.length === 0) {
      return { intent: plan.intent, executedCommands: 0, messages: plan.notes ?? [] };
    }
    runDomainCommands(plan.commands, `${plan.intent} applied.`);
    return {
      intent: plan.intent,
      executedCommands: plan.commands.length,
      messages: [`${plan.commands.length} command(s) applied.`],
    };
  }
}

