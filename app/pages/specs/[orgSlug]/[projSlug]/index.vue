<script setup lang="ts">
import { ChevronRight, Trash2, Check, AlertTriangle, Loader2 } from "lucide-vue-next";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/shadcn/card";
import { Button } from "~/components/shadcn/button";
import { Badge } from "~/components/shadcn/badge";
import ConfirmDialog from "~/components/ui/ConfirmDialog.vue";
import ProjectShell from "~/components/projects/ProjectShell.vue";
import InstalledExtensionsWidget from "~/components/settings/InstalledExtensionsWidget.vue";
import type { Workflow } from "~/utils/workflows";
import type { StepId, StepStatus } from "~/utils/steps";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const refreshProjects = inject<() => Promise<void>>("refreshProjects", async () => {});

const { orgSlug, projSlug, apiBase, routeBase, cacheKey } = useProjectContext();
const { project, error, workflow, workflowSteps } = await useProject();
const { statusMap } = await useStepStates(workflowSteps);

const deleteDialogOpen = ref(false);
const deleting = ref(false);

const { data: availableWorkflows } = await useFetch<Workflow[]>(
  () => `${apiBase.value}/workflows`,
  { default: () => [], key: () => `workflows-${cacheKey.value}` }
);

const completionStats = computed(() => {
  const statuses = Object.values(statusMap.value);
  const complete = statuses.filter((s) => s === "complete").length;
  const stale = statuses.filter((s) => s === "stale").length;
  return { complete, stale, total: workflowSteps.value.length };
});

function stepRoute(step: { id: string }) {
  return `${routeBase.value}/steps/${step.id}`;
}

function stepStatus(id: StepId): StepStatus | undefined {
  return statusMap.value[id];
}

const switchingWorkflow = ref(false);

async function switchWorkflow(event: Event) {
  const target = event.target as HTMLSelectElement;
  const nextId = target.value;
  if (!nextId || nextId === project.value?.workflow) return;
  if (!confirm(t("specIndex.confirmWorkflowSwitch", { id: nextId }))) {
    target.value = (project.value?.workflow as string) ?? "spec-kit";
    return;
  }
  switchingWorkflow.value = true;
  try {
    await $fetch(`${apiBase.value}/workflow`, {
      method: "POST",
      body: { workflow: nextId }
    });
    await reloadNuxtApp({ path: route.fullPath });
  } catch (err) {
    console.error(err);
    alert(t("specIndex.workflowChangeFailed"));
    target.value = (project.value?.workflow as string) ?? "spec-kit";
  } finally {
    switchingWorkflow.value = false;
  }
}

async function deleteProject() {
  if (deleting.value) return;
  deleting.value = true;
  try {
    await $fetch(apiBase.value, { method: "DELETE" });
    deleteDialogOpen.value = false;
    await refreshProjects();
    await router.push("/");
  } catch (err) {
    console.error(err);
    alert(t("specIndex.deleteFailed"));
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div v-if="error" class="p-8">
    <Card class="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>{{ $t("specIndex.notFound") }}</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground">
        {{ $t("specIndex.notFoundDesc", { slug: projSlug }) }}
      </CardContent>
    </Card>
  </div>

  <ProjectsProjectShell
    v-else-if="project"
    :org-slug="orgSlug"
    :proj-slug="projSlug"
    :project-title="project.title"
    :workflow="workflow"
  >
    <template #sidebar>
      <div class="space-y-2 px-3 py-3 text-xs text-muted-foreground">
        <p class="font-medium text-foreground">{{ $t("specIndex.overview") }}</p>
        <p>
          {{ $t("specIndex.progress") }}
          <span class="font-medium text-foreground">{{ completionStats.complete }}/{{ completionStats.total }}</span>
          {{ $t("specIndex.completed") }}
          <span v-if="completionStats.stale" class="ml-1 text-amber-500">
            {{ $t("specIndex.stale", { count: completionStats.stale }) }}
          </span>
        </p>
      </div>
    </template>

    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ project.title }}</h1>
        <p v-if="project.description" class="text-sm leading-6 text-muted-foreground">
          {{ project.description }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <ProjectsRepositorySyncBadge :org-slug="orgSlug" :proj-slug="projSlug" />
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          @click="deleteDialogOpen = true"
        >
          <Trash2 class="mr-1.5 size-3.5" />
          {{ $t("specIndex.deleteProject") }}
        </Button>
      </div>
    </header>

        <Card>
          <CardHeader>
            <div class="flex items-center justify-between gap-3">
              <CardTitle class="text-base">{{ $t("specIndex.workflowTitle") }}</CardTitle>
              <div class="flex items-center gap-2">
                <select
                  :value="project.workflow ?? 'spec-kit'"
                  :disabled="switchingWorkflow"
                  class="rounded-md border border-input bg-background px-2 py-1 text-xs outline-none ring-offset-background transition focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-60"
                  @change="switchWorkflow($event)"
                >
                  <option v-for="wf in availableWorkflows" :key="wf.id" :value="wf.id">
                    {{ wf.label }}
                  </option>
                </select>
              </div>
            </div>
            <p class="text-xs text-muted-foreground">
              {{ workflow.description }}
            </p>
          </CardHeader>
          <CardContent class="space-y-2">
            <NuxtLink
              v-for="(step, index) in workflowSteps"
              :key="step.id"
              :to="stepRoute(step)"
              class="group flex items-start gap-3 rounded-md border border-border/60 bg-muted/20 p-3 transition hover:border-primary/40 hover:bg-muted/40"
            >
              <span class="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {{ index + 1 }}
              </span>
              <div class="flex-1">
                <p class="text-sm font-medium">{{ step.label }}</p>
                <p class="text-xs text-muted-foreground">{{ step.summary }}</p>
              </div>
              <span class="flex shrink-0 items-center gap-2">
                <Check
                  v-if="stepStatus(step.id) === 'complete'"
                  class="size-4 text-emerald-600"
                  :title="$t('common.statusComplete')"
                />
                <Loader2
                  v-else-if="stepStatus(step.id) === 'in_progress'"
                  class="size-4 animate-spin text-primary"
                  :title="$t('common.statusInProgress')"
                />
                <AlertTriangle
                  v-else-if="stepStatus(step.id) === 'stale'"
                  class="size-4 text-amber-500"
                  :title="$t('common.statusStale')"
                />
                <Badge variant="outline">{{ step.command }}</Badge>
                <ChevronRight class="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
              </span>
            </NuxtLink>
          </CardContent>
        </Card>

    <SettingsInstalledExtensionsWidget :org-slug="orgSlug" :proj-slug="projSlug" />

    <UiConfirmDialog
      v-model:open="deleteDialogOpen"
      :title="$t('specIndex.deleteTitle', { title: project.title })"
      :message="$t('specIndex.deleteMessage')"
      :details="$t('specIndex.deleteDetails', { slug: project.slug })"
      :confirm-label="$t('specIndex.deleteConfirm')"
      destructive
      :busy="deleting"
      @confirm="deleteProject"
    />
  </ProjectsProjectShell>
</template>
