<script setup lang="ts">
import { FileText, GitBranch, MessageSquareCode } from "lucide-vue-next";

const props = defineProps<{ orgSlug: string; projSlug: string }>();
const route = useRoute();

const base = computed(() => `/specs/${props.orgSlug}/${props.projSlug}`);
const isRepository = computed(() => route.path.startsWith(`${base.value}/repository`));
const isChat = computed(() => route.path.startsWith(`${base.value}/chat`));
const isSpeckit = computed(() => !isRepository.value && !isChat.value);
</script>

<template>
  <nav class="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
    <NuxtLink
      :to="base"
      class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition"
      :class="isSpeckit
        ? 'bg-background font-medium text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'"
    >
      <FileText class="size-3.5" />
      Speckit
    </NuxtLink>
    <NuxtLink
      :to="`${base}/chat`"
      class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition"
      :class="isChat
        ? 'bg-background font-medium text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'"
    >
      <MessageSquareCode class="size-3.5" />
      Chat
    </NuxtLink>
    <NuxtLink
      :to="`${base}/repository`"
      class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition"
      :class="isRepository
        ? 'bg-background font-medium text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'"
    >
      <GitBranch class="size-3.5" />
      Repository
    </NuxtLink>
  </nav>
</template>
