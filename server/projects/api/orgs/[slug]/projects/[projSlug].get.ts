import path from "node:path";
import { projectArtifactsDir } from "@su/data-dirs";
import { readJson, readText } from "@su/fs-helpers";
import { getProjectWorkflowId } from "@su/workflows";
import { getProjectWorkflow } from "@su/workflow-discovery";

interface ProjectMeta {
  title?: string;
  description?: string;
  projectRoot?: string | null;
  specifyInit?: unknown;
}

export default defineEventHandler(async (event) => {
  const orgId = event.context.orgId!;
  const slug = event.context.projectSlug!;
  const baseDir = projectArtifactsDir(orgId, slug);

  const meta = await readJson<ProjectMeta | null>(path.join(baseDir, "meta.json"), null);
  if (!meta) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }

  const [spec, plan, tasks] = await Promise.all([
    readText(path.join(baseDir, "spec.md"), ""),
    readText(path.join(baseDir, "plan.md"), ""),
    readText(path.join(baseDir, "tasks.md"), ""),
  ]);

  const workflowId = await getProjectWorkflowId(orgId, slug);
  const workflow = await getProjectWorkflow(orgId, slug, workflowId);

  return {
    slug,
    title: meta.title ?? slug,
    description: meta.description ?? "",
    projectRoot: meta.projectRoot ?? null,
    specifyInit: meta.specifyInit ?? null,
    spec: { raw: spec },
    plan: { raw: plan },
    tasks: { raw: tasks },
    workflow: workflowId,
    workflowDefinition: workflow,
  };
});
