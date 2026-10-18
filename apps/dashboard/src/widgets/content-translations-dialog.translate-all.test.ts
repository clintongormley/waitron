import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import type {
  ContentSuggestionRead,
  DashboardApi,
  SuggestionRunView,
  TranslationPage,
  TranslationTarget,
} from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./content-translations-dialog.js";
import type { ContentTranslationsDialog } from "./content-translations-dialog.js";
import type { ContentSuggestionsBar } from "./content-suggestions-bar.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const target = (id: string): TranslationTarget => ({
  kind: "product",
  id,
  name: `STAFF ${id}`,
  reason: "absent",
  selectedText: null,
  defaultText: null,
  effectiveSelectedText: null,
  effectiveDefaultText: null,
  defaultRequired: true,
  eligible: true,
  unavailableReason: null,
  owners: { kind: "product", parentId: null },
  expected: `baseline-${id}`,
});
const translations = (language: string): TranslationPage => ({
  language,
  config: { defaultLanguage: "en", languages: ["en", "es"] },
  required: [],
  rows: [target("one")],
  next: null,
  total: 1,
});
const run = (overrides: Partial<SuggestionRunView> = {}): SuggestionRunView => ({
  state: "running",
  total: 358,
  progress: 180,
  done: 180,
  failed: 0,
  code: null,
  fits: null,
  waiting: 0,
  finishedAt: null,
  opened: false,
  ...overrides,
});
const SENDING = run({ state: "sending", progress: 0, done: 0 });
const read = (overrides: Partial<ContentSuggestionRead> = {}): ContentSuggestionRead => ({
  config: { defaultLanguage: "en", languages: ["en", "es"] },
  required: [],
  configuration: "suggestion-config",
  waitingFixes: 0,
  run: null,
  suggestions: [],
  next: null,
  service: "on",
  cloudOrigin: "https://cloud.example.test",
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function mount(overrides: Record<string, unknown> = {}, liveData?: LiveData) {
  const api = {
    getContentTranslationTargets: vi.fn(async (language: string) => translations(language)),
    saveContentTranslations: vi.fn(),
    getContentSuggestions: vi.fn(async () => read()),
    startContentSuggestions: vi.fn(async () => ({ run: SENDING })),
    ...(liveData ? { liveData } : {}),
    ...overrides,
  } as unknown as DashboardApi;
  const { el } = await mountWidget<ContentTranslationsDialog>(
    "dashboard-content-translations-dialog",
    { open: true, language: "es", api },
  );
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull());
  return { el, api };
}
const bar = (el: ContentTranslationsDialog) =>
  el.shadowRoot!.querySelector<ContentSuggestionsBar>("dashboard-content-suggestions-bar")!;
const button = (el: ContentTranslationsDialog) =>
  bar(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=translate-all]",
  )!;
async function drawn(el: ContentTranslationsDialog): Promise<void> {
  await el.updateComplete;
  await bar(el).updateComplete;
  await button(el).updateComplete;
}
/** One task later: every microtask a read or a LiveData schedule queued has run. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Translate all in the translations dialog", () => {
  it.each([
    ["en-GB", "This server is not connected to Waitron Cloud"],
    ["es-ES", "Este servidor no está conectado a Waitron Cloud"],
  ])(
    "explains a missing Cloud connection in %s for a refused start and a failed run",
    async (locale, message) => {
      setLocale(locale);
      const { el } = await mount({
        startContentSuggestions: vi.fn().mockRejectedValue({ code: "cloud.not_configured" }),
      });
      await vi.waitFor(() => expect(bar(el).service).toBe("on"));
      await drawn(el);
      await userEvent.click(button(el));
      await vi.waitFor(() => expect(bar(el).shadowRoot!.textContent).toContain(message));
      expect(button(el).disabled).toBe(false);

      cleanupWidgets();
      const failed = await mount({
        getContentSuggestions: vi.fn(async () =>
          read({
            run: run({ state: "failed", code: "cloud.not_configured" }),
          }),
        ),
      });
      await vi.waitFor(() => expect(bar(failed.el).shadowRoot!.textContent).toContain(message));
    },
  );

  it("reads the run, the service and the Cloud origin into the bar, and follows the run live", async () => {
    const liveData = new LiveData();
    let current = read({ run: run() });
    const getContentSuggestions = vi.fn(async () => current);
    const { el, api } = await mount({ getContentSuggestions }, liveData);
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("running"));
    expect(getContentSuggestions).toHaveBeenCalledWith();
    expect(bar(el).service).toBe("on");
    expect(bar(el).cloudOrigin).toBe("https://cloud.example.test");
    const translationReads = vi.mocked(api.getContentTranslationTargets).mock.calls.length;
    const suggestionReads = getContentSuggestions.mock.calls.length;
    current = read({ run: run({ state: "done", progress: 358, done: 358, waiting: 358 }) });
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("done"));
    expect(getContentSuggestions).toHaveBeenCalledTimes(suggestionReads + 1);
    expect(api.getContentTranslationTargets).toHaveBeenCalledTimes(translationReads);
  });

  it("starts one run per press, is busy while it is sent, and shows the run it started", async () => {
    const sent = deferred<{ run: SuggestionRunView | null }>();
    const startContentSuggestions = vi.fn(() => sent.promise);
    const { el } = await mount({ startContentSuggestions });
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    await drawn(el);
    await userEvent.click(button(el));
    await drawn(el);
    expect(startContentSuggestions).toHaveBeenCalledOnce();
    expect(startContentSuggestions).toHaveBeenCalledWith();
    expect(bar(el).busy).toBe(true);
    expect(button(el).loading).toBe(true);
    expect(button(el).getAttribute("variant")).toBe("primary");
    bar(el).dispatchEvent(new CustomEvent("translate-all", { bubbles: true, composed: true }));
    expect(startContentSuggestions).toHaveBeenCalledOnce();
    sent.resolve({ run: SENDING });
    await vi.waitFor(() => expect(bar(el).busy).toBe(false));
    await drawn(el);
    expect(bar(el).run?.state).toBe("sending");
    expect(button(el).disabled).toBe(true);
    expect(button(el).getAttribute("variant")).toBe("secondary");
  });

  it("tells a refusal in the bar and leaves the button and the dialog's own message alone", async () => {
    const startContentSuggestions = vi
      .fn()
      .mockRejectedValue({ code: "content.suggestion_job_running" });
    const { el } = await mount({ startContentSuggestions });
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    await drawn(el);
    await userEvent.click(button(el));
    await vi.waitFor(() =>
      expect(bar(el).error).toBe(codeMessage("content.suggestion_job_running")),
    );
    await drawn(el);
    expect(button(el).disabled).toBe(false);
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error,
    ).toBe("");
  });

  it("says nothing was missing, and the next press clears it", async () => {
    setLocale("en-GB");
    const startContentSuggestions = vi
      .fn()
      .mockResolvedValueOnce({ run: null })
      .mockResolvedValueOnce({ run: SENDING });
    const { el } = await mount({ startContentSuggestions });
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    await drawn(el);
    await userEvent.click(button(el));
    await vi.waitFor(() => expect(bar(el).nothing).toBe(true));
    await drawn(el);
    expect(bar(el).shadowRoot!.textContent).toContain(t("suggestions.nothing"));
    expect(button(el).disabled).toBe(false);
    await userEvent.click(button(el));
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("sending"));
    expect(bar(el).nothing).toBe(false);
  });

  it("keeps the nothing-missing line when a read that began before the press answered shows another run", async () => {
    setLocale("en-GB");
    const liveData = new LiveData();
    const late = deferred<ContentSuggestionRead>();
    let held: Promise<ContentSuggestionRead> | undefined;
    const getContentSuggestions = vi.fn(() => {
      const answer = held ?? Promise.resolve(read());
      held = undefined;
      return answer;
    });
    const { el } = await mount(
      { getContentSuggestions, startContentSuggestions: vi.fn(async () => ({ run: null })) },
      liveData,
    );
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    const before = getContentSuggestions.mock.calls.length;
    held = late.promise;
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await vi.waitFor(() => expect(getContentSuggestions).toHaveBeenCalledTimes(before + 1));
    await drawn(el);
    await userEvent.click(button(el));
    await vi.waitFor(() => expect(bar(el).nothing).toBe(true));
    late.resolve(read({ run: run(), cloudOrigin: "https://later.example.test" }));
    await vi.waitFor(() => expect(bar(el).cloudOrigin).toBe("https://later.example.test"));
    await drawn(el);
    expect(bar(el).run).toBeNull();
    expect(bar(el).shadowRoot!.textContent).toContain(t("suggestions.nothing"));
  });

  it("keeps the nothing-missing line while reads show the run the press saw, and replaces it with a newer run", async () => {
    setLocale("en-GB");
    const liveData = new LiveData();
    const finished = run({
      state: "done",
      progress: 358,
      done: 358,
      waiting: 4,
      finishedAt: "2026-10-14T10:00:00.000Z",
    });
    let current = read({ run: finished });
    const getContentSuggestions = vi.fn(async () => current);
    const { el } = await mount(
      { getContentSuggestions, startContentSuggestions: vi.fn(async () => ({ run: null })) },
      liveData,
    );
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("done"));
    await drawn(el);
    await userEvent.click(button(el));
    await vi.waitFor(() => expect(bar(el).nothing).toBe(true));
    const reads = getContentSuggestions.mock.calls.length;
    current = read({ run: { ...finished, waiting: 3, opened: true } });
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await vi.waitFor(() => expect(getContentSuggestions.mock.calls.length).toBeGreaterThan(reads));
    await vi.waitFor(() => expect(bar(el).run?.waiting).toBe(3));
    await drawn(el);
    expect(bar(el).shadowRoot!.textContent).toContain(t("suggestions.nothing"));
    current = read({
      run: run({
        state: "refused",
        total: 1,
        progress: 0,
        done: 0,
        code: "content.suggestion_consent_required",
        finishedAt: "2026-10-14T10:05:00.000Z",
      }),
    });
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("refused"));
    await drawn(el);
    const text = bar(el).shadowRoot!.textContent!;
    expect(text).toContain(codeMessage("content.suggestion_consent_required"));
    expect(text).not.toContain(t("suggestions.nothing"));
    expect(
      bar(el).shadowRoot!.querySelector("[data-test=suggestions-consent]")!.getAttribute("href"),
    ).toBe("https://cloud.example.test/account");
  });

  it("replaces the nothing-missing line with a run another tab started while the press was being sent", async () => {
    const liveData = new LiveData();
    const press = deferred<{ run: SuggestionRunView | null }>();
    let current = read();
    const getContentSuggestions = vi.fn(async () => current);
    const { el } = await mount(
      { getContentSuggestions, startContentSuggestions: vi.fn(() => press.promise) },
      liveData,
    );
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    await drawn(el);
    await userEvent.click(button(el));
    current = read({ run: run() });
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("running"));
    press.resolve({ run: null });
    await vi.waitFor(() => expect(bar(el).nothing).toBe(true));
    current = read({ run: run({ progress: 200, done: 200 }) });
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await vi.waitFor(() => expect(bar(el).run?.progress).toBe(200));
    expect(bar(el).nothing).toBe(false);
  });

  it("tells a failed suggestion read in the bar, keeps the translations usable, and clears it once a read answers", async () => {
    const liveData = new LiveData();
    const getContentSuggestions = vi
      .fn()
      .mockRejectedValueOnce({ code: "cloud.unavailable" })
      .mockResolvedValue(read());
    const { el } = await mount({ getContentSuggestions }, liveData);
    await vi.waitFor(() => expect(bar(el).error).toBe(codeMessage("cloud.unavailable")));
    await drawn(el);
    expect(bar(el).service).toBeNull();
    expect(button(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
    liveData.invalidate([{ type: "content_suggestions" }]);
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    expect(bar(el).error).toBe("");
  });

  it("does not let a read that began before the press answered put back the run it replaced", async () => {
    const liveData = new LiveData();
    const late = deferred<ContentSuggestionRead>();
    let current = read();
    let held: Promise<ContentSuggestionRead> | undefined;
    const getContentSuggestions = vi.fn(() => {
      const answer = held ?? Promise.resolve(current);
      held = undefined;
      return answer;
    });
    const { el } = await mount({ getContentSuggestions }, liveData);
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    const before = getContentSuggestions.mock.calls.length;
    held = late.promise;
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await vi.waitFor(() => expect(getContentSuggestions).toHaveBeenCalledTimes(before + 1));
    await drawn(el);
    await userEvent.click(button(el));
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("sending"));
    // Were the late answer's run applied, the bar would show "done" here.
    late.resolve(
      read({
        run: run({ state: "done", progress: 358, done: 358, waiting: 12 }),
        cloudOrigin: "https://later.example.test",
      }),
    );
    await vi.waitFor(() => expect(bar(el).cloudOrigin).toBe("https://later.example.test"));
    expect(bar(el).run?.state).toBe("sending");
    current = read({ run: run() });
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("running"));
  });

  it.each([
    [
      "answered",
      (sent: ReturnType<typeof deferred<{ run: SuggestionRunView | null }>>) =>
        sent.resolve({ run: null }),
    ],
    [
      "refused",
      (sent: ReturnType<typeof deferred<{ run: SuggestionRunView | null }>>) =>
        sent.reject({ code: "content.suggestion_job_running" }),
    ],
  ] as const)("keeps a press %s after the dialog closed out of the bar", async (_name, answer) => {
    const sent = deferred<{ run: SuggestionRunView | null }>();
    const { el } = await mount({ startContentSuggestions: vi.fn(() => sent.promise) });
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    await drawn(el);
    await userEvent.click(button(el));
    await vi.waitFor(() => expect(bar(el).busy).toBe(true));
    el.open = false;
    await el.updateComplete;
    answer(sent);
    await sent.promise.catch(() => undefined);
    await nextTask();
    await el.updateComplete;
    expect(bar(el).nothing).toBe(false);
    expect(bar(el).error).toBe("");
    expect(bar(el).busy).toBe(false);
  });

  it("reads the new language when the dialog switches, and stops reading once it closes", async () => {
    const liveData = new LiveData();
    const { el, api } = await mount({}, liveData);
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    el.language = "en";
    await vi.waitFor(() => expect(api.getContentSuggestions).toHaveBeenCalledWith());
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    const reads = vi.mocked(api.getContentSuggestions).mock.calls.length;
    el.open = false;
    await el.updateComplete;
    // Were the read still watched, this would read the suggestions once more.
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await nextTask();
    expect(api.getContentSuggestions).toHaveBeenCalledTimes(reads);
  });
});
