<script setup lang="ts">
import { toRef } from "vue";
import ChatPanel from "~/components/speckit/ChatPanel.vue";
import { useSpeckitStepAgent } from "~/composables/useSpeckitStepAgent";

/**
 * Step-chat host. Mirrors SpeckitChatHost.vue but resolves the draft
 * via `GET /spec-drafts/by-step/:stepId` (one draft per
 * (project, user, step), find-or-create on first open) instead of
 * taking a fixed draftId.
 *
 * Re-exposes `insertIntoDraft(text)` so the host page can pipe through
 * PowerPrompt / HookGate "Use this command" calls without caring about
 * the underlying draft id.
 */
const props = defineProps<{
  orgSlug: string;
  projSlug: string;
  stepId: string;
}>();

const emit = defineEmits<{
  publish: [];
}>();

const agent = useSpeckitStepAgent({
  orgSlug: toRef(props, "orgSlug"),
  projSlug: toRef(props, "projSlug"),
  stepId: toRef(props, "stepId"),
});

defineExpose({
  insertIntoDraft: (text: string) => agent.insertDraftText(text),
  agent,
});

function onPublishClick() {
  emit("publish");
}
</script>

<template>
  <ChatPanel
    :session="agent.session.value"
    :is-streaming="agent.isStreaming.value"
    :save-state="agent.saveState.value"
    :pending-save="agent.pendingSave.value"
    @send="(t) => agent.sendMessage(t)"
    @cancel="() => agent.cancel()"
    @publish="onPublishClick"
    @retry-save="() => agent.retrySave()"
  />
</template>
