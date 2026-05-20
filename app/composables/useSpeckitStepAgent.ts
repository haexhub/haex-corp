import { computed, onMounted, ref, watch, type Ref } from "vue";
import { streamText, type LanguageModel } from "ai";

import { SPECKIT_SYSTEM_PROMPT } from "~/lib/speckit-system-prompt";
import { buildLanguageModel } from "~/lib/speckit-model";
import { buildSpeckitTools } from "~/lib/speckit-tools";
import {
  useActiveSessionStore,
  type ConversationMessage,
  type SaveState,
  type ActiveSession,
} from "~/stores/active-session";
import { useProviderIdentityStore } from "~/stores/provider-identity";

/**
 * Step-aware variant of `useSpeckitAgent`.
 *
 * Why not literally wrap `useSpeckitAgent`: that composable auto-opens
 * a draft in its own `onMounted` from a fixed `draftId` arg. Step-chat
 * needs to resolve a draft *by stepId* first (one draft per
 * `(project, user, step)`, find-or-create) and to swap drafts when the
 * caller flips `stepId` without remounting. The cleanest reuse is at
 * the *store* layer (`useActiveSessionStore.openDraft / commitTurn`)
 * and the *libs* (`buildSpeckitTools`, `buildLanguageModel`,
 * `SPECKIT_SYSTEM_PROMPT`); the turn loop here mirrors
 * `useSpeckitAgent.sendMessage` and stays in sync with it.
 */

export type SpeckitStepAgentArgs = {
  orgSlug: Ref<string>;
  projSlug: Ref<string>;
  stepId: Ref<string>;
  /** Test seam — same as `useSpeckitAgent.modelOverride`. */
  modelOverride?: LanguageModel;
};

export type SpeckitStepAgent = {
  session: Ref<ActiveSession | null>;
  saveState: Ref<SaveState>;
  pendingSave: Ref<boolean>;
  isStreaming: Ref<boolean>;
  sendMessage: (text: string) => Promise<void>;
  cancel: () => void;
  insertDraftText: (text: string) => void;
  retrySave: () => Promise<void>;
};

type ByStepResponse = {
  id: string;
  title: string;
  baseVersion: number;
  status: "draft" | "published";
  stepId: string;
  files: Array<{ name: string; content: string }>;
  conversation: unknown[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  created: boolean;
};

export function useSpeckitStepAgent(
  args: SpeckitStepAgentArgs,
): SpeckitStepAgent {
  const session = useActiveSessionStore();
  const identityStore = useProviderIdentityStore();
  const isStreaming = ref(false);
  // Text fragments queued via `insertDraftText` are prepended to the
  // next user message. The chat-host can also choose to dump them into
  // the input box; we keep the buffer-then-concat shape here so callers
  // don't have to thread the value through their own state.
  const pendingInsert = ref<string[]>([]);
  let abortController: AbortController | null = null;

  async function resolveDraft(): Promise<void> {
    const url =
      `/api/orgs/${args.orgSlug.value}/projects/${args.projSlug.value}` +
      `/spec-drafts/by-step/${encodeURIComponent(args.stepId.value)}`;
    const res = await $fetch<ByStepResponse>(url);
    await session.openDraft({
      orgSlug: args.orgSlug.value,
      projSlug: args.projSlug.value,
      draftId: res.id,
    });
  }

  onMounted(() => {
    void resolveDraft();
  });
  watch(
    () => args.stepId.value,
    (next, prev) => {
      if (next === prev) return;
      void resolveDraft();
    },
  );

  function resolveModel(): LanguageModel {
    if (args.modelOverride) return args.modelOverride;
    const id = identityStore.active;
    if (!id) {
      throw new Error(
        "No active provider identity. Configure one in Settings → Speckit agent.",
      );
    }
    return buildLanguageModel(id);
  }

  async function sendMessage(text: string): Promise<void> {
    if (isStreaming.value) return;
    if (!session.session) {
      throw new Error("Speckit session not loaded yet");
    }
    const prefix = pendingInsert.value.join(" ");
    pendingInsert.value = [];
    const finalText = prefix ? `${prefix} ${text}` : text;
    const userMessage: ConversationMessage = {
      role: "user",
      content: finalText,
    };
    session.appendTurn(userMessage);

    isStreaming.value = true;
    abortController = new AbortController();
    try {
      const tools = buildSpeckitTools({
        orgSlug: args.orgSlug.value,
        projSlug: args.projSlug.value,
      });
      const result = streamText({
        model: resolveModel(),
        tools,
        system: SPECKIT_SYSTEM_PROMPT,
        messages: session.session.conversation as never,
        abortSignal: abortController.signal,
      });

      const response = await result.response;
      for (const m of response.messages) {
        session.appendTurn(m as unknown as ConversationMessage);
      }

      await session.commitTurn();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        throw err;
      }
    } finally {
      isStreaming.value = false;
      abortController = null;
    }
  }

  function cancel(): void {
    abortController?.abort();
  }

  function insertDraftText(text: string): void {
    if (!text) return;
    pendingInsert.value.push(text);
  }

  return {
    session: computed(() => session.session) as Ref<ActiveSession | null>,
    saveState: computed(() => session.saveState) as Ref<SaveState>,
    pendingSave: computed(() => session.pendingSave) as Ref<boolean>,
    isStreaming,
    sendMessage,
    cancel,
    insertDraftText,
    retrySave: () => session.retrySaveNow(),
  };
}
