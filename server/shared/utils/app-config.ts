import path from "node:path";
import { SPECIFYR_DIR, ensureDir, exists, readJson, writeJson } from "./fs-helpers";

export interface LocalExtensionEntry {
  slug: string;
  path: string;
  registeredAt: string;
}

export interface AppConfig {
  standardExtensions: string[];
  localExtensions: LocalExtensionEntry[];
}

const DEFAULT_APP_CONFIG: AppConfig = {
  standardExtensions: [],
  localExtensions: [],
};

const BUNDLED_LOCAL_EXTENSIONS: ReadonlyArray<{ slug: string; path: string }> = [];

function configPath(cwd: string): string {
  return path.join(cwd, SPECIFYR_DIR, "config.json");
}

async function injectBundledLocalExtensions(merged: AppConfig, cwd: string): Promise<void> {
  const registered = new Set(merged.localExtensions.map((e) => e.slug));
  for (const bundled of BUNDLED_LOCAL_EXTENSIONS) {
    if (registered.has(bundled.slug)) continue;
    const absPath = path.resolve(cwd, bundled.path);
    if (!(await exists(absPath))) continue;
    merged.localExtensions = [
      ...merged.localExtensions,
      { slug: bundled.slug, path: absPath, registeredAt: new Date(0).toISOString() },
    ];
  }
}

export async function loadAppConfig(
  cwd: string = process.cwd(),
  { injectBundled = true }: { injectBundled?: boolean } = {},
): Promise<AppConfig> {
  const saved = await readJson<Partial<AppConfig> | null>(configPath(cwd), null);
  const merged: AppConfig = saved
    ? {
        standardExtensions: saved.standardExtensions ?? DEFAULT_APP_CONFIG.standardExtensions,
        localExtensions: saved.localExtensions ?? DEFAULT_APP_CONFIG.localExtensions,
      }
    : { ...DEFAULT_APP_CONFIG };
  if (injectBundled) await injectBundledLocalExtensions(merged, cwd);
  return merged;
}

export async function saveAppConfig(next: AppConfig, cwd: string = process.cwd()): Promise<AppConfig> {
  const filePath = configPath(cwd);
  await ensureDir(path.dirname(filePath));
  await writeJson(filePath, next);
  return next;
}

export async function setStandardExtensions(
  extensions: string[],
  cwd: string = process.cwd(),
): Promise<string[]> {
  const cleaned = Array.from(
    new Set(extensions.map((x) => String(x).trim()).filter(Boolean)),
  );
  const current = await loadAppConfig(cwd, { injectBundled: false });
  const next: AppConfig = { ...current, standardExtensions: cleaned };
  await saveAppConfig(next, cwd);
  return next.standardExtensions;
}

function normalizeLocalEntry(entry: Partial<LocalExtensionEntry>): LocalExtensionEntry {
  const slug = String(entry.slug ?? "").trim();
  const pathValue = String(entry.path ?? "").trim();
  if (!slug) throw new Error("local extension entry requires a non-empty slug");
  if (!pathValue) throw new Error("local extension entry requires a non-empty path");
  return {
    slug,
    path: pathValue,
    registeredAt: entry.registeredAt || new Date().toISOString(),
  };
}

export async function addLocalExtension(
  entry: Partial<LocalExtensionEntry>,
  cwd: string = process.cwd(),
): Promise<LocalExtensionEntry> {
  const normalized = normalizeLocalEntry(entry);
  const current = await loadAppConfig(cwd, { injectBundled: false });
  if (current.localExtensions.some((e) => e.slug === normalized.slug)) {
    throw new Error(`local extension '${normalized.slug}' is already registered`);
  }
  await saveAppConfig(
    { ...current, localExtensions: [...current.localExtensions, normalized] },
    cwd,
  );
  return normalized;
}

export async function removeLocalExtension(
  slug: string,
  cwd: string = process.cwd(),
): Promise<{ slug: string }> {
  const target = String(slug ?? "").trim();
  if (!target) throw new Error("slug is required");
  const current = await loadAppConfig(cwd, { injectBundled: false });
  const kept = current.localExtensions.filter((e) => e.slug !== target);
  if (kept.length === current.localExtensions.length) {
    throw new Error(`local extension '${target}' is not registered`);
  }
  await saveAppConfig(
    {
      ...current,
      localExtensions: kept,
      standardExtensions: current.standardExtensions.filter((s) => s !== target),
    },
    cwd,
  );
  return { slug: target };
}

export async function findLocalExtensionPath(
  slug: string,
  cwd: string = process.cwd(),
): Promise<string | null> {
  const target = String(slug ?? "").trim();
  if (!target) return null;
  const current = await loadAppConfig(cwd);
  return current.localExtensions.find((e) => e.slug === target)?.path ?? null;
}

/**
 * Back-compat shim: legacy callers used `getAppConfigModule()` to lazy-load a
 * dynamic ESM module. After the TS port, all functions are static — wrap them
 * in a Promise.resolve so existing `await getAppConfigModule()` call sites
 * keep working without churn.
 */
export function getAppConfigModule() {
  return Promise.resolve({
    loadAppConfig,
    saveAppConfig,
    setStandardExtensions,
    addLocalExtension,
    removeLocalExtension,
    findLocalExtensionPath,
  });
}
