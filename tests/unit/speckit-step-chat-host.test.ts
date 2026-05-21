/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createPersistedState } from "pinia-plugin-persistedstate";

import SpeckitStepChatHost from "../../app/components/speckit/SpeckitStepChatHost.vue";
import { useActiveSessionStore } from "../../app/stores/active-session";

const CTX = {
  orgSlug: "acme",
  projSlug: "demo",
};
const BASE = `/api/orgs/${CTX.orgSlug}/projects/${CTX.projSlug}`;

function freshPinia() {
  const app = createApp({ render: () => null });
  const pinia = createPinia();
  pinia.use(createPersistedState());
  app.use(pinia);
  setActivePinia(pinia);
  return { pinia };
}

function mountHost(stepId = "spec") {
  const { pinia } = freshPinia();
  type HostRef = { insertIntoDraft: (text: string) => void };
  const hostRef = ref<HostRef | null>(null);
  const stepIdRef = ref(stepId);
  let publishCount = 0;
  const Root = defineComponent({
    setup() {
      return () =>
        h(SpeckitStepChatHost, {
          ref: hostRef,
          orgSlug: CTX.orgSlug,
          projSlug: CTX.projSlug,
          stepId: stepIdRef.value,
          onPublish: () => {
            publishCount += 1;
          },
        });
    },
  });
  const app = createApp(Root);
  app.use(pinia);
  const el = document.createElement("div");
  app.mount(el);
  return {
    hostRef,
    stepIdRef,
    el,
    getPublishCount: () => publishCount,
    teardown: () => app.unmount(),
  };
}

function fakeByStepResponse(stepId: string) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: `Step: ${stepId}`,
    baseVersion: 0,
    status: "draft" as const,
    stepId,
    files: [],
    conversation: [
      { role: "user", content: "hello from history" },
      { role: "assistant", content: "hi back" },
    ],
    createdAt: "2026-05-21T10:00:00Z",
    updatedAt: "2026-05-21T10:00:00Z",
    publishedAt: null,
    created: false,
  };
}

function fakeDraftResponse(draftId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: draftId,
    title: "Step: spec",
    baseVersion: 0,
    status: "draft",
    files: [{ name: "spec.md", content: "" }],
    conversation: [
      { role: "user", content: "hello from history" },
      { role: "assistant", content: "hi back" },
    ],
    createdAt: "2026-05-21T10:00:00Z",
    updatedAt: "2026-05-21T10:00:00Z",
    publishedAt: null,
    ...overrides,
  };
}

describe("SpeckitStepChatHost", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("$fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the draft on mount and renders ChatPanel with its conversation", async () => {
    const byStep = fakeByStepResponse("spec");
    fetchMock.mockResolvedValueOnce(byStep);
    fetchMock.mockResolvedValueOnce(fakeDraftResponse(byStep.id));

    const { el, teardown } = mountHost();
    await nextTick();
    await nextTick();
    await nextTick();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${BASE}/spec-drafts/by-step/spec`,
    );
    // ChatPanel renders user/assistant messages as paragraphs.
    expect(el.textContent).toContain("hello from history");
    expect(el.textContent).toContain("hi back");
    teardown();
  });

  it("exposes insertIntoDraft and the agent's insertDraftText API", async () => {
    const byStep = fakeByStepResponse("spec");
    fetchMock.mockResolvedValueOnce(byStep);
    fetchMock.mockResolvedValueOnce(fakeDraftResponse(byStep.id));

    const { hostRef, teardown } = mountHost();
    await nextTick();
    await nextTick();
    await nextTick();

    expect(hostRef.value).toBeTruthy();
    hostRef.value!.insertIntoDraft("rg foo");

    // The buffer lives on the composable; assert via the active session
    // by triggering a send. We can't easily call sendMessage (needs an
    // LLM model), so reach through the exposed agent instead.
    const exposed = hostRef.value as unknown as {
      agent: { insertDraftText: (t: string) => void };
    };
    expect(typeof exposed.agent.insertDraftText).toBe("function");
    teardown();
  });

  it("shows the retry-save banner when saveState is 'failed' and clicking Retry invokes retrySave", async () => {
    const byStep = fakeByStepResponse("spec");
    fetchMock.mockResolvedValueOnce(byStep);
    fetchMock.mockResolvedValueOnce(fakeDraftResponse(byStep.id));

    const { el, teardown } = mountHost();
    await nextTick();
    await nextTick();
    await nextTick();

    const session = useActiveSessionStore();
    session.saveState = { kind: "failed", reason: "boom" };
    await nextTick();

    expect(el.textContent).toContain("Save failed");

    // Find the Retry button and click; retrySaveNow flips saveState
    // away from "failed" (to "idle" / "saving" / "retrying" depending
    // on what commitTurn does next). The invariant we care about here
    // is that the failed banner is no longer the active state — i.e.
    // the click was wired to retrySave.
    const buttons = Array.from(el.querySelectorAll("button"));
    const retry = buttons.find((b) => b.textContent?.includes("Retry"));
    expect(retry).toBeTruthy();
    retry!.click();
    await nextTick();
    expect(session.saveState.kind).not.toBe("failed");
    teardown();
  });

  it("emits 'publish' upward when the panel emits @publish", async () => {
    const byStep = fakeByStepResponse("spec");
    fetchMock.mockResolvedValueOnce(byStep);
    fetchMock.mockResolvedValueOnce(fakeDraftResponse(byStep.id));

    const { el, getPublishCount, teardown } = mountHost();
    await nextTick();
    await nextTick();
    await nextTick();

    const buttons = Array.from(el.querySelectorAll("button"));
    const publish = buttons.find((b) => b.textContent?.includes("Publish"));
    expect(publish).toBeTruthy();
    publish!.click();
    expect(getPublishCount()).toBe(1);
    teardown();
  });
});
