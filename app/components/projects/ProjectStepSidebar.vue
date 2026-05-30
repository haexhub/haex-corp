<script setup lang="ts">
import { ArrowLeft, Check, AlertTriangle, X } from "lucide-vue-next";
import { type StepId, type StepStatus } from "~/utils/steps";
import { resolveWorkflow, type Workflow } from "~/utils/workflows";
import type { StepState } from "~/types/types";

const props = withDefaults(
  defineProps<{
    orgSlug: string;
    projSlug: string;
    projectTitle?: string;
    activeStepId?: StepId;
    // Parent passes the full workflow definition (from the project snapshot's workflowDefinition).
    // Falls back to spec-kit if missing so the sidebar stays usable before the snapshot lands.
    workflow?: Workflow | null;
    // Show the Steps list at the bottom. Speckit views want this; Runtime view
    // doesn't (the bottom section there is empty or filled via the slot).
    showSteps?: boolean;
    mobileOpen?: boolean;
  }>(),
  { showSteps: true },
);

const emit = defineEmits<{
  (e: "close"): void;
}>();

const workflow = computed(() => resolveWorkflow(props.workflow?.id, props.workflow ?? null));
const steps = computed(() => workflow.value.steps);
const apiBase = computed(() => `/api/orgs/${props.orgSlug}/projects/${props.projSlug}`);
const routeBase = computed(() => `/specs/${props.orgSlug}/${props.projSlug}`);

// Fetch step states so we can show status badges + gate downstream steps.
const { data: stepStates } = await useFetch<StepState[]>(() => `${apiBase.value}/steps`, {
  default: () => [],
  key: () => `steps-${props.orgSlug}-${props.projSlug}`
});

const statusMap = computed(() => {
  const map: Record<StepId, StepStatus | undefined> = {};
  for (const step of steps.value) map[step.id] = undefined;
  for (const s of stepStates.value ?? []) map[s.id] = s.status;
  return map;
});

function stateFor(id: StepId) {
  return stepStates.value?.find((s) => s.id === id);
}

function stepRoute(step: { id: StepId }) {
  return `${routeBase.value}/steps/${step.id}`;
}
</script>

<template>
  <!-- Mobile backdrop -->
  <Transition
    enter-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-150"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-30 bg-foreground/30 backdrop-blur-sm lg:hidden"
      @click="emit('close')"
    />
  </Transition>

  <aside
    class="flex h-dvh w-[260px] shrink-0 flex-col border-r border-border bg-background transition-transform duration-200 lg:h-screen lg:bg-muted/20 lg:transition-none fixed inset-y-0 left-0 z-40 lg:relative lg:translate-x-0"
    :class="mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
  >
    <div class="flex h-15 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4">
      <div class="flex min-w-0 flex-col justify-center">
        <NuxtLink
          to="/"
          class="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft class="size-3" />
          {{ $t("common.allProjects") }}
        </NuxtLink>
        <NuxtLink
          :to="routeBase"
          class="mt-1 block truncate text-sm font-semibold tracking-tight transition hover:text-primary"
          :title="projectTitle ?? projSlug"
        >
          {{ projectTitle ?? projSlug }}
        </NuxtLink>
      </div>
      <button
        type="button"
        class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground lg:hidden"
        :aria-label="$t('sidebar.closeMenu')"
        @click="emit('close')"
      >
        <X class="size-4" />
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <slot />
    </div>

    <div v-if="showSteps" class="border-t border-border/60 p-2">
      <p class="px-2 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {{ $t("stepSidebar.steps") }}
      </p>
      <p v-if="workflow.source === 'extension'" class="px-2 pb-1 text-[10px] text-muted-foreground">
        {{ workflow.label }}
      </p>
      <ol class="flex flex-col gap-0.5">
        <li v-for="(step, index) in steps" :key="step.id">
          <NuxtLink
            :to="stepRoute(step)"
            class="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition"
            :class="step.id === activeStepId
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'"
          >
            <span class="flex min-w-0 items-center gap-2">
              <span
                class="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                :class="step.id === activeStepId ? 'bg-primary text-primary-foreground' : 'bg-muted'"
              >
                {{ index + 1 }}
              </span>
              <span class="truncate">{{ step.label }}</span>
            </span>
            <span class="shrink-0">
              <Check
                v-if="stateFor(step.id)?.status === 'complete'"
                class="size-3.5 text-emerald-600"
                :title="$t('common.statusComplete')"
              />
              <AlertTriangle
                v-else-if="stateFor(step.id)?.status === 'stale'"
                class="size-3.5 text-amber-500"
                :title="$t('common.statusStale')"
              />
            </span>
          </NuxtLink>
        </li>
      </ol>
    </div>
  </aside>
</template>
