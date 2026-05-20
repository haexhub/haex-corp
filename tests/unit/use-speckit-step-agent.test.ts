/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type Ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createPersistedState } from "pinia-plugin-persistedstate";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModel } from "ai";

import { useSpeckitStepAgent } from "../../app/composables/useSpeckitStepAgent";
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
  return { app, pinia };
}

function mountStepAgent(
  stepId: Ref<string>,
  modelOverride?: LanguageModel,
) {
  const { pinia } = freshPinia();
  let agent: ReturnType<typeof useSpeckitStepAgent> | null = null;
  const Host = defineComponent({
    setup() {
      agent = useSpeckitStepAgent({
        orgSlug: ref(CTX.orgSlug),
        projSlug: ref(CTX.projSlug),
        stepId,
        modelOverride,
      });
      return () => h("div");
    },
  });
  const hostApp = createApp(Host);
  hostApp.use(pinia);
  hostApp.mount(document.createElement("div"));
  return { agent: agent!, teardown: () => hostApp.unmount() };
}

function fakeByStepResponse(
  stepId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `aaaaaaaa-aaaa-aaaa-aaaa-${stepId.padStart(12, "a")}`.slice(0, 36),
    title: `Step: ${stepId}`,
    baseVersion: 0,
    status: "draft",
    stepId,
    files: [],
    conversation: [],
    createdAt: "2026-05-21T10:00:00Z",
    updatedAt: "2026-05-21T10:00:00Z",
    publishedAt: null,
    created: true,
    ...overrides,
  };
}

function fakeDraftResponse(
  draftId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: draftId,
    title: "Step: x",
    baseVersion: 0,
    status: "draft",
    files: [{ name: "spec.md", content: "" }],
    conversation: [],
    createdAt: "2026-05-21T10:00:00Z",
    updatedAt: "2026-05-21T10:00:00Z",
    publishedAt: null,
    ...overrides,
  };
}

describe("useSpeckitStepAgent", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("$fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches by-step on mount and opens the resolved draft", async () => {
    const stepId = ref("spec");
    const byStep = fakeByStepResponse("spec");
    fetchMock.mockResolvedValueOnce(byStep);
    fetchMock.mockResolvedValueOnce(fakeDraftResponse(byStep.id));

    const { agent, teardown } = mountStepAgent(stepId);
    await nextTick();
    await nextTick();
    await nextTick();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${BASE}/spec-drafts/by-step/spec`,
    );
    expect(agent.session.value?.draftId).toBe(byStep.id);
    teardown();
  });

  it("re-fetches by-step when stepId changes and swaps the active draft", async () => {
    const stepId = ref("spec");
    const firstByStep = fakeByStepResponse("spec");
    const firstDraft = fakeDraftResponse(firstByStep.id);
    const secondByStep = fakeByStepResponse("plan", {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });
    const secondDraft = fakeDraftResponse(secondByStep.id);
    fetchMock.mockResolvedValueOnce(firstByStep);
    fetchMock.mockResolvedValueOnce(firstDraft);
    fetchMock.mockResolvedValueOnce(secondByStep);
    fetchMock.mockResolvedValueOnce(secondDraft);

    const { agent, teardown } = mountStepAgent(stepId);
    await nextTick();
    await nextTick();
    await nextTick();
    expect(agent.session.value?.draftId).toBe(firstByStep.id);

    stepId.value = "plan";
    await nextTick();
    await nextTick();
    await nextTick();

    const byStepCalls = fetchMock.mock.calls.filter((c) =>
      typeof c[0] === "string" && c[0].includes("/spec-drafts/by-step/"),
    );
    expect(byStepCalls.length).toBeGreaterThanOrEqual(2);
    expect(byStepCalls[1]![0]).toBe(`${BASE}/spec-drafts/by-step/plan`);
    expect(agent.session.value?.draftId).toBe(secondByStep.id);
    teardown();
  });

  it("insertDraftText buffers a prefix that prepends the next sendMessage", async () => {
    const stepId = ref("spec");
    const byStep = fakeByStepResponse("spec");
    fetchMock.mockResolvedValueOnce(byStep);
    fetchMock.mockResolvedValueOnce(fakeDraftResponse(byStep.id));

    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "response-metadata",
              id: "r1",
              modelId: "mock",
              timestamp: new Date(),
            },
            { type: "text-start", id: "t0" },
            { type: "text-delta", id: "t0", delta: "ok" },
            { type: "text-end", id: "t0" },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ],
        }),
      }),
    });

    const { agent, teardown } = mountStepAgent(
      stepId,
      model as unknown as LanguageModel,
    );
    await nextTick();
    await nextTick();
    await nextTick();

    agent.insertDraftText("foo");
    fetchMock.mockResolvedValueOnce({ updatedAt: "2026-05-21T11:00:00Z" });
    await agent.sendMessage("bar");

    const session = useActiveSessionStore();
    const firstUser = session.session?.conversation.find(
      (m) => (m as { role?: string }).role === "user",
    ) as { content?: unknown } | undefined;
    expect(firstUser?.content).toBe("foo bar");

    // Buffer is cleared after the send.
    fetchMock.mockResolvedValueOnce({ updatedAt: "2026-05-21T11:01:00Z" });
    await agent.sendMessage("again");
    const seconds = (session.session?.conversation ?? []).filter(
      (m) => (m as { role?: string }).role === "user",
    ) as Array<{ content?: unknown }>;
    expect(seconds[seconds.length - 1]?.content).toBe("again");
    teardown();
  });

  it("sendMessage streams a response, appends it, and commits", async () => {
    const stepId = ref("spec");
    const byStep = fakeByStepResponse("spec");
    fetchMock.mockResolvedValueOnce(byStep);
    fetchMock.mockResolvedValueOnce(fakeDraftResponse(byStep.id));

    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "response-metadata",
              id: "r1",
              modelId: "mock",
              timestamp: new Date(),
            },
            { type: "text-start", id: "t0" },
            { type: "text-delta", id: "t0", delta: "hello" },
            { type: "text-end", id: "t0" },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ],
        }),
      }),
    });

    const { agent, teardown } = mountStepAgent(
      stepId,
      model as unknown as LanguageModel,
    );
    await nextTick();
    await nextTick();
    await nextTick();

    fetchMock.mockResolvedValueOnce({ updatedAt: "2026-05-21T11:00:00Z" });
    await agent.sendMessage("hi");

    const session = useActiveSessionStore();
    const roles = (session.session?.conversation ?? []).map(
      (m) => (m as { role?: string }).role,
    );
    expect(roles[0]).toBe("user");
    expect(roles).toContain("assistant");
    expect(session.pendingSave).toBe(false);
    expect(agent.isStreaming.value).toBe(false);
    teardown();
  });
});
