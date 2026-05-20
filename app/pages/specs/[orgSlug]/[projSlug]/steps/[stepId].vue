<script setup lang="ts">
import { PanelRightOpen, Play, Menu, PanelLeft } from "lucide-vue-next";
import { Badge } from "~/components/shadcn/badge";
import { Button } from "~/components/shadcn/button";
import ProjectStepSidebar from "~/components/projects/ProjectStepSidebar.vue";
import SpeckitStepChatHost from "~/components/speckit/SpeckitStepChatHost.vue";
import ArtifactViewer from "~/components/ui/ArtifactViewer.vue";
import HookGateBanner from "~/components/common/HookGateBanner.vue";
import { stepById, type StepId } from "~/utils/steps";
import type { WorkflowStep } from "~/utils/workflows";
import { gatesForStep } from "~/utils/hooks";

const route = useRoute();

const { orgSlug, projSlug, apiBase, cacheKey } = useProjectContext();
const { project, workflow, workflowSteps } = await useProject();
const { statusMap: workflowStatusMap, refresh: refreshStepStates } = await useStepStates(workflowSteps);

const stepIdParam = computed(() => route.params.stepId as string);

const step = computed(() => {
  try {
    return stepById(stepIdParam.value as StepId, workflowSteps.value);
  } catch {
    return null;
  }
});
const stepIndex = computed(() =>
  workflowSteps.value.findIndex((s: WorkflowStep) => s.id === stepIdParam.value)
);

const artifactReloadToken = ref(0);
const artifactOpen = ref(true);
const chatHostRef = ref<{ insertIntoDraft: (text: string) => void } | null>(null);

const ARTIFACT_WIDTH_KEY = "specifyr:artifact-sidebar-width";
const ARTIFACT_WIDTH_MIN = 320;
const ARTIFACT_WIDTH_MAX = 960;
const ARTIFACT_WIDTH_DEFAULT = 420;

const artifactWidth = ref(ARTIFACT_WIDTH_DEFAULT);
const artifactResizing = ref(false);

onMounted(() => {
  const stored = Number.parseInt(localStorage.getItem(ARTIFACT_WIDTH_KEY) ?? "", 10);
  if (Number.isFinite(stored)) {
    artifactWidth.value = Math.min(Math.max(stored, ARTIFACT_WIDTH_MIN), ARTIFACT_WIDTH_MAX);
  }
  if (window.matchMedia("(max-width: 1023px)").matches) {
    artifactOpen.value = false;
  }
});

function startArtifactResize(event: MouseEvent) {
  event.preventDefault();
  artifactResizing.value = true;
  const startX = event.clientX;
  const startWidth = artifactWidth.value;
  function onMove(e: MouseEvent) {
    const next = startWidth - (e.clientX - startX);
    artifactWidth.value = Math.min(Math.max(next, ARTIFACT_WIDTH_MIN), ARTIFACT_WIDTH_MAX);
  }
  function onUp() {
    artifactResizing.value = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    localStorage.setItem(ARTIFACT_WIDTH_KEY, String(Math.round(artifactWidth.value)));
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function handlePowerPrompt(prompt: string) {
  chatHostRef.value?.insertIntoDraft(prompt);
}

function handleGateUseCommand(command: string) {
  chatHostRef.value?.insertIntoDraft(`${command} `);
}

function handlePublish() {
  // Bump the artifact-reload token so the viewer re-fetches public
  // files after publish moves the draft to disk.
  artifactReloadToken.value += 1;
  void refreshStepStates();
}

interface ExtensionRecord {
  slug: string;
  status: string;
}

const { data: extensionsManifest } = await useFetch<{ extensions: ExtensionRecord[] }>(
  () => `${apiBase.value}/extensions`,
  { default: () => ({ extensions: [] }), key: () => `ext-${cacheKey.value}` }
);

const installedSlugs = computed(() =>
  (extensionsManifest.value?.extensions ?? [])
    .filter((e) => e.status === "installed")
    .map((e) => e.slug)
);

const hookGates = computed(() => {
  if (!step.value) return [];
  return gatesForStep(step.value.id, installedSlugs.value);
});

const currentStepStatus = computed(() =>
  step.value ? workflowStatusMap.value[step.value.id] : undefined,
);

const runningAction = ref(false);
const runActionError = ref<string | null>(null);

async function runStepAction() {
  if (!step.value?.runAction || runningAction.value) return;
  runningAction.value = true;
  runActionError.value = null;
  try {
    await $fetch(`${apiBase.value}/${step.value.runAction}`, { method: "POST" });
    artifactReloadToken.value += 1;
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string }; message?: string })?.data?.statusMessage
      ?? (err instanceof Error ? err.message : String(err));
    runActionError.value = msg;
  } finally {
    runningAction.value = false;
  }
}

watch(
  [orgSlug, projSlug, stepIdParam],
  async () => {
    await refreshStepStates();
  },
  { immediate: true }
);

const artifactCandidates = computed(() => step.value?.artifacts ?? []);

const stepSidebar = provideProjectStepSidebar();
const projectListSidebar = useProjectListSidebar();
watch(() => route.path, () => stepSidebar.close());
</script>

<template>
  <div v-if="!step" class="p-8 text-sm text-muted-foreground">
    {{ $t("stepDetail.unknownStep", { id: stepIdParam }) }}
  </div>

  <div v-else class="flex h-full">
    <ProjectsProjectStepSidebar
      :org-slug="orgSlug"
      :proj-slug="projSlug"
      :project-title="project?.title"
      :active-step-id="step.id"
      :workflow="workflow"
      :mobile-open="stepSidebar.open.value"
      @close="stepSidebar.close()"
    />

    <ClientOnly>
      <template #fallback>
        <section class="flex h-full flex-1 items-center justify-center text-xs text-muted-foreground">
          {{ $t("stepDetail.loadingWorkspace") }}
        </section>
      </template>

    <section class="flex h-full min-w-0 flex-1 flex-col">
      <header class="flex h-15 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-3 lg:px-6">
        <div class="flex items-center gap-1 lg:hidden">
          <button
            v-if="projectListSidebar"
            type="button"
            class="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
            :aria-label="$t('sidebar.openMenu')"
            @click="projectListSidebar.toggle()"
          >
            <Menu class="size-5" />
          </button>
          <button
            type="button"
            class="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
            :aria-label="$t('sidebar.openStepMenu')"
            @click="stepSidebar.toggle()"
          >
            <PanelLeft class="size-5" />
          </button>
        </div>
        <div class="min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground">
            {{ $t("stepDetail.step", { n: stepIndex + 1, total: workflowSteps.length }) }}
          </p>
          <h1 class="truncate text-lg font-semibold leading-tight">{{ step.label }}</h1>
        </div>
        <div class="flex items-center gap-2">
          <Badge variant="outline">{{ step.command }}</Badge>
          <Button
            v-if="step.runAction && currentStepStatus !== 'complete'"
            size="sm"
            :disabled="runningAction"
            @click="runStepAction"
          >
            <Play class="mr-1.5 size-3.5" :class="runningAction && 'animate-pulse'" />
            {{ runningAction ? $t("common.loading") : $t("stepDetail.run") }}
          </Button>
          <button
            v-if="!artifactOpen"
            type="button"
            class="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground lg:hidden"
            :aria-label="$t('stepDetail.showArtifact')"
            @click="artifactOpen = true"
          >
            <PanelRightOpen class="size-5" />
          </button>
        </div>
      </header>

      <div
        v-if="runActionError"
        class="border-b border-destructive/30 bg-destructive/5 px-6 py-2 text-xs text-destructive"
      >
        {{ runActionError }}
      </div>

      <CommonHookGateBanner :gates="hookGates" @use-command="handleGateUseCommand" />

      <div
        v-if="currentStepStatus === 'stale'"
        class="border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-900 dark:text-amber-200"
      >
        {{ $t("stepDetail.staleWarning") }}
      </div>

      <div class="flex flex-1 flex-col overflow-hidden">
        <SpeckitStepChatHost
          ref="chatHostRef"
          :org-slug="orgSlug"
          :proj-slug="projSlug"
          :step-id="step.id"
          @publish="handlePublish"
        />
      </div>
    </section>

    <aside
      v-if="!artifactOpen"
      class="hidden h-full w-10 shrink-0 flex-col items-center border-l border-border bg-muted/10 lg:flex"
    >
      <div class="flex h-15 shrink-0 items-center justify-center border-b border-border/60">
        <button
          type="button"
          class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
          :title="$t('stepDetail.showArtifact')"
          @click="artifactOpen = true"
        >
          <PanelRightOpen class="size-4" />
        </button>
      </div>
      <p class="mt-4 rotate-180 text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground [writing-mode:vertical-rl]">
        {{ $t("artifact.label") }}
      </p>
    </aside>

    <aside
      v-if="artifactOpen"
      class="fixed inset-0 z-40 flex h-dvh flex-col border-l border-border bg-background lg:relative lg:inset-auto lg:z-auto lg:h-full lg:w-(--artifact-w) lg:bg-muted/10"
      :class="artifactResizing && 'select-none'"
      :style="{ '--artifact-w': `${artifactWidth}px` }"
    >
      <div
        class="group absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize"
        :class="artifactResizing && 'bg-primary/10'"
        @mousedown="startArtifactResize"
      >
        <div
          class="absolute inset-y-0 left-1 w-px transition"
          :class="artifactResizing ? 'bg-primary' : 'bg-transparent group-hover:bg-primary/40'"
        />
      </div>
      <UiArtifactViewer
        :org-slug="orgSlug"
        :proj-slug="projSlug"
        :candidates="artifactCandidates"
        :reload-token="artifactReloadToken"
        @collapse="artifactOpen = false"
        @power-prompt="handlePowerPrompt"
      />
    </aside>
    </ClientOnly>
  </div>
</template>
