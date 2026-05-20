<script setup lang="ts">
import { KeyRound } from "lucide-vue-next";
import type {
  CredentialRow,
  LlmProvider as Provider,
  ProviderMeta,
} from "~/components/settings/LlmCredentialCard.vue";
import type { SpeckitAgentProfile } from "~/components/agents/SpeckitAgentProfileCard.vue";

const providerMeta: Record<Provider, ProviderMeta> = {
  anthropic: {
    name: "Anthropic (Claude)",
    keyHint: "sk-ant-…",
  },
  openai: {
    name: "OpenAI",
    keyHint: "sk-…",
    baseUrlHint: "https://api.openai.com/v1",
  },
  google: {
    name: "Google (Gemini)",
    keyHint: "AIza…",
  },
  openrouter: {
    name: "OpenRouter",
    keyHint: "sk-or-…",
    baseUrlHint: "https://openrouter.ai/api/v1",
    baseUrlPrefill: "https://openrouter.ai/api/v1",
    hint: "Single key fronts many model families. Agents pick e.g. anthropic/claude-sonnet-4-5 or openai/gpt-5.",
  },
};
const providers: Provider[] = ["anthropic", "openai", "google", "openrouter"];

const { data: credentials, refresh } = await useFetch<CredentialRow[]>(
  "/api/me/llm-credentials",
  { default: () => [] },
);
const { data: speckitProfile, refresh: refreshSpeckitProfile } =
  await useFetch<SpeckitAgentProfile | null>("/api/me/agent-profiles/speckit", {
    default: () => null,
    transform: (r) => r ?? null,
  });

async function refreshAll() {
  await Promise.all([refresh(), refreshSpeckitProfile()]);
}

const credsByProvider = computed(() => {
  const grouped: Record<Provider, CredentialRow[]> = {
    anthropic: [],
    openai: [],
    google: [],
    openrouter: [],
  };
  for (const c of credentials.value ?? []) {
    grouped[c.provider]?.push(c);
  }
  return grouped;
});

const anthropicOauth = computed(
  () =>
    (credentials.value ?? []).find(
      (c) => c.provider === "anthropic" && c.mode === "oauth_claude",
    ) ?? null,
);
</script>

<template>
  <div>
    <NuxtLink
      to="/settings"
      class="text-xs text-muted-foreground hover:text-foreground"
    >
      ← Settings
    </NuxtLink>

    <h1 class="mt-2 flex items-center gap-2 text-2xl font-semibold">
      <KeyRound class="size-6 opacity-80" />
      Hermes credentials (personal)
    </h1>
    <p class="mt-1 text-sm text-muted-foreground">
      API keys for Hermes agents you run personally. Encrypted at rest on the
      Specifyr server. For browser-side Speckit chat, use
      <NuxtLink to="/settings/speckit-agent" class="underline hover:text-foreground">
        Speckit browser models
      </NuxtLink>
      instead. Org-shared Hermes credentials are managed under each org's
      settings.
    </p>

    <AuthAnthropicOAuthCard
      :existing="
        anthropicOauth
          ? { id: anthropicOauth.id, oauthStatus: anthropicOauth.oauthStatus }
          : null
      "
      endpoint="/api/me/llm-credentials/oauth/anthropic"
      delete-endpoint="/api/me/llm-credentials"
      @changed="refreshAll()"
    />

    <AgentsSpeckitAgentProfileCard
      :profile="speckitProfile"
      :credentials="credentials ?? []"
      endpoint="/api/me/agent-profiles/speckit"
      credentials-endpoint="/api/me/llm-credentials"
      @changed="refreshSpeckitProfile()"
    />

    <SettingsLlmCredentialCard
      v-for="provider in providers"
      :key="provider"
      :provider="provider"
      :meta="providerMeta[provider]"
      :credentials="credsByProvider[provider] ?? []"
      endpoint="/api/me/llm-credentials"
      default-display-name="Personal"
      @changed="refreshAll()"
    />
  </div>
</template>
