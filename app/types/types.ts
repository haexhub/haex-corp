import type { StepId, StepStatus } from "~/utils/steps";

export interface ProjectListItem {
  slug: string;
  // orgId is always present from the API; orgSlug is enriched server-side
  // via a join so the UI can build /specs/<orgSlug>/<projSlug> links.
  orgId: string;
  orgSlug: string;
  title: string;
  description?: string;
  projectRoot?: string | null;
  currentStage?: string;
  updatedAt?: string;
  run?: { status?: string } | null;
}

export interface StepState {
  id: StepId;
  status: StepStatus;
  lastSessionId?: string;
  staleSince?: string;
  staleReason?: string;
  updatedAt?: string;
}

export interface SessionMetadata {
  id: string;
  stepId: StepId;
  title: string;
  // "interrupted" = was running when the server died/restarted; user can retry to resume.
  status: "idle" | "running" | "completed" | "failed" | "interrupted";
  claudeSessionId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  // Highest seq of any persisted turn event for this session. Clients use it as the
  // initial `since` when subscribing to /turn/stream so they don't replay history.
  lastEventSeq?: number;
  // For status === "running": the seq value just before the in-flight turn began.
  // Clients reconnecting use this as `since` to replay only the active turn's events.
  // Cleared (null) when the turn ends.
  runningSinceSeq?: number | null;
  interruptedAt?: string;
  interruptedReason?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  thinking?: string;
  createdAt: string;
  toolUse?: {
    name: string;
    input?: Record<string, unknown>;
  };
}

