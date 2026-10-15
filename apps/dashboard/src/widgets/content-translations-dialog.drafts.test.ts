import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { languageDisplayName } from "@waitron/shared";
import type {
  ContentSuggestionRead,
  ContentSuggestionView,
  DashboardApi,
  TranslationBatch,
  TranslationPage,
  TranslationRef,
  TranslationTarget,
} from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./content-translations-dialog.js";
import type { ContentTranslationsDialog } from "./content-translations-dialog.js";

const target = (id: string, overrides: Partial<TranslationTarget> = {}): TranslationTarget => ({
  kind: "product",
  id,
  name: `STAFF ${id}`,
  reason: "absent",
  selectedText: null,
  defaultText: null,
  effectiveSelectedText: null,
  effectiveDefaultText: null,
  defaultRequired: false,
  eligible: true,
  unavailableReason: null,
  owners: { kind: "product", parentId: null },
  expected: `baseline-${id}`,
  ...overrides,
});
const suggestion = (
  id: string,
  itemId: string,
  overrides: Partial<ContentSuggestionView> = {},
): ContentSuggestionView => ({
  id,
  kind: "product",
  itemId,
  language: "es",
  text: `CLIENT-es ${itemId}`,
  placeholder: false,
  fix: null,
  stale: false,
  ...overrides,
});

/** The venue behind the dialog's routes; a save or a discard changes what the next read returns. */
interface Venue {
  language: string;
  config: { defaultLanguage: string; languages: string[] };
  listed: TranslationTarget[];
  omitted: TranslationTarget[];
  suggestions: ContentSuggestionView[];
  suggestionPage: number;
}
const venue = (overrides: Partial<Venue> = {}): Venue => ({
  language: "es",
  config: { defaultLanguage: "en", languages: ["en", "es"] },
  listed: [],
  omitted: [],
  suggestions: [],
  suggestionPage: 100,
  ...overrides,
});
function fakeApi(state: Venue, overrides: Record<string, unknown> = {}) {
  const page = (rows: TranslationTarget[], next: string | null): TranslationPage => ({
    language: state.language,
    config: state.config,
    required: [],
    rows,
    next,
    total: state.listed.length,
  });
  return {
    getContentTranslationTargets: vi.fn(
      async (_language: string, query: { after?: string; targets?: TranslationRef[] }) => {
        if (query.targets)
          return page(
            query.targets.map(
              (ref) =>
                [...state.listed, ...state.omitted].find(
                  (row) => row.kind === ref.kind && row.id === ref.id,
                ) ?? target(ref.id, { eligible: false, unavailableReason: "missing" }),
            ),
            null,
          );
        const start = query.after === undefined ? 0 : Number(query.after);
        return page(
          state.listed.slice(start, start + 50),
          start + 50 < state.listed.length ? String(start + 50) : null,
        );
      },
    ),
    getContentSuggestions: vi.fn(
      async (language: string, after?: string): Promise<ContentSuggestionRead> => {
        const start = after === undefined ? 0 : Number(after);
        const end = start + state.suggestionPage;
        return {
          language,
          run: null,
          service: "on",
          cloudOrigin: null,
          suggestions: state.suggestions.slice(start, end),
          next: end < state.suggestions.length ? String(end) : null,
        };
      },
    ),
    saveContentTranslations: vi.fn(async (_language: string, batch: TranslationBatch) => {
      const saved = new Set(batch.edits.map((edit) => `${edit.kind}:${edit.id}`));
      state.listed = state.listed.filter((row) => !saved.has(`${row.kind}:${row.id}`));
      state.omitted = state.omitted.filter((row) => !saved.has(`${row.kind}:${row.id}`));
      state.suggestions = state.suggestions.filter(
        (view) => !saved.has(`${view.kind}:${view.itemId}`),
      );
      return { saved: [] };
    }),
    discardContentSuggestion: vi.fn(async (id: string) => {
      if (!state.suggestions.some((view) => view.id === id))
        throw { code: "content.suggestion_not_found", params: { suggestionId: id } };
      state.suggestions = state.suggestions.filter((view) => view.id !== id);
      return { deleted: id };
    }),
    startContentSuggestions: vi.fn(async () => ({ run: null })),
    ...overrides,
  };
}
async function open(state: Venue, overrides: Record<string, unknown> = {}) {
  const api = fakeApi(state, overrides);
  const mounted = await mountWidget<ContentTranslationsDialog>(
    "dashboard-content-translations-dialog",
    { open: true, language: state.language, api: api as unknown as DashboardApi },
  );
  await vi.waitFor(() => expect(q(mounted.el, "[data-test=loading]")).toBeNull());
  await settle(mounted.el);
  return { ...mounted, api };
}
const q = <T extends HTMLElement = HTMLElement>(
  el: ContentTranslationsDialog,
  selector: string,
): T | null =>
  el.shadowRoot!.querySelector<T>(selector) ??
  el.shadowRoot!.querySelector("wt-data-table")?.shadowRoot?.querySelector<T>(selector) ??
  null;
const field = (el: ContentTranslationsDialog, id: string, name = "text") =>
  q<HTMLElementTagNameMap["wt-input"]>(el, `[name="translation-${name}-product-${id}"]`);
async function settle(el: ContentTranslationsDialog) {
  await el.updateComplete;
  await q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")?.updateComplete;
}
async function edit(el: ContentTranslationsDialog, id: string, text: string, name = "text") {
  field(el, id, name)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: text }, bubbles: true, composed: true }),
  );
  await settle(el);
}
async function click(el: ContentTranslationsDialog, action: string) {
  q(el, `[data-test=${action}]`)!.click();
  await settle(el);
}
const save = (el: ContentTranslationsDialog) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!;
const bottomMessage = (el: ContentTranslationsDialog) =>
  q<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error;
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("Translate all suggestions as drafts", () => {
  it("fills suggestions as drafts marked Suggested and opens with Save enabled", async () => {
    const { el } = await open(
      venue({ listed: [target("one"), target("two")], suggestions: [suggestion("s1", "one")] }),
    );
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(q(el, "[data-test=suggested-product-one]")!.textContent!.trim()).toBe(
      t("suggestions.suggested"),
    );
    expect(q(el, "[data-test=discard-product-one]")).not.toBeNull();
    expect(field(el, "two")!.value).toBe("");
    expect(q(el, "[data-test=suggested-product-two]")).toBeNull();
    expect(q(el, "[data-test=discard-product-two]")).toBeNull();
    expect(save(el).disabled).toBe(false);
    expect(save(el).variant).toBe("primary");
    await click(el, "show-edited");
    expect(field(el, "one")).not.toBeNull();
    expect(field(el, "two")).toBeNull();
  });
  it("fills a missing default only when its default-language suggestion came too", async () => {
    const { el } = await open(
      venue({
        listed: [
          target("one", { defaultRequired: true }),
          target("two", { defaultRequired: true }),
        ],
        suggestions: [
          suggestion("s1", "one"),
          suggestion("s2", "one", { language: "en", text: "CLIENT-en one" }),
          suggestion("s3", "two"),
        ],
      }),
    );
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(field(el, "one", "defaultText")!.value).toBe("CLIENT-en one");
    expect(field(el, "two")!.value).toBe("");
    expect(field(el, "two", "defaultText")).toBeNull();
  });
  it("reads every suggestion page before filling", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two"), target("three")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two"), suggestion("s3", "three")],
        suggestionPage: 1,
      }),
    );
    expect(api.getContentSuggestions).toHaveBeenCalledWith("es", "1");
    expect(api.getContentSuggestions).toHaveBeenCalledWith("es", "2");
    expect(field(el, "three")!.value).toBe("CLIENT-es three");
  });
  it("saves suggested and typed names together, and an edited suggestion as typed", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two"), target("three")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
      }),
    );
    await edit(el, "two", "Croqueta casera");
    expect(q(el, "[data-test=suggested-product-two]")).toBeNull();
    await edit(el, "three", "Pan");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
      edits: [
        { kind: "product", id: "one", expected: "baseline-one", text: "CLIENT-es one" },
        { kind: "product", id: "two", expected: "baseline-two", text: "Croqueta casera" },
        { kind: "product", id: "three", expected: "baseline-three", text: "Pan" },
      ],
    });
  });
  it("Discard deletes each of the row's suggestions in turn and empties the row", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one", { defaultRequired: true })],
        suggestions: [
          suggestion("s1", "one"),
          suggestion("s2", "one", { language: "en", text: "CLIENT-en one" }),
        ],
      }),
    );
    await click(el, "discard-product-one");
    await vi.waitFor(() => expect(field(el, "one")!.value).toBe(""));
    expect(api.discardContentSuggestion.mock.calls).toEqual([["s1"], ["s2"]]);
    expect(field(el, "one", "defaultText")).toBeNull();
    expect(q(el, "[data-test=suggested-product-one]")).toBeNull();
    expect(q(el, "[data-test=discard-product-one]")).toBeNull();
    expect(save(el).disabled).toBe(true);
  });
  it("a suggestion the server no longer holds counts as discarded; any other refusal is shown", async () => {
    const state = venue({
      listed: [target("one"), target("two")],
      suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
    });
    const { el, api } = await open(state);
    state.suggestions = state.suggestions.filter((view) => view.id !== "s1");
    await click(el, "discard-product-one");
    await vi.waitFor(() => expect(field(el, "one")!.value).toBe(""));
    api.discardContentSuggestion.mockRejectedValueOnce({ code: "server.internal" });
    await click(el, "discard-product-two");
    await vi.waitFor(() => expect(bottomMessage(el)).toBe(codeMessage("server.internal")));
    expect(field(el, "two")!.value).toBe("CLIENT-es two");
    expect(q(el, "[data-test=suggested-product-two]")).not.toBeNull();
  });
  it("Discard sends once while its own request or a save is being sent", async () => {
    let answer!: () => void;
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
      }),
      {
        discardContentSuggestion: vi.fn(
          () => new Promise((resolve) => (answer = () => resolve({ deleted: "s1" }))),
        ),
        saveContentTranslations: vi.fn(() => new Promise(() => {})),
      },
    );
    await click(el, "discard-product-one");
    expect(
      q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=discard-product-one]")!.disabled,
    ).toBe(true);
    await click(el, "discard-product-one");
    expect(api.discardContentSuggestion).toHaveBeenCalledTimes(1);
    answer();
    await vi.waitFor(() => expect(field(el, "one")!.value).toBe(""));
    await click(el, "save");
    await vi.waitFor(() => expect(api.saveContentTranslations).toHaveBeenCalled());
    await click(el, "discard-product-two");
    expect(api.discardContentSuggestion).toHaveBeenCalledTimes(1);
  });
  it("a Discard answered after the dialog was closed and reopened leaves the new dialog and its own Discard alone", async () => {
    for (const outcome of ["resolve", "reject"] as const) {
      const answers: Array<() => void> = [];
      const { el } = await open(
        venue({ listed: [target("one")], suggestions: [suggestion("s1", "one")] }),
        {
          discardContentSuggestion: vi.fn(
            () =>
              new Promise((resolve, reject) =>
                answers.push(() =>
                  outcome === "resolve"
                    ? resolve({ deleted: "s1" })
                    : reject({ code: "server.internal" }),
                ),
              ),
          ),
        },
      );
      await click(el, "discard-product-one");
      el.open = false;
      await el.updateComplete;
      el.open = true;
      await vi.waitFor(() => expect(field(el, "one")?.value).toBe("CLIENT-es one"));
      await click(el, "discard-product-one");
      answers[0]!();
      // A zero-delay timer runs after every step #discard has left, which are all microtasks.
      await new Promise((resolve) => setTimeout(resolve, 0));
      el.requestUpdate();
      q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")!.requestUpdate();
      await settle(el);
      expect(field(el, "one")!.value).toBe("CLIENT-es one");
      expect(q(el, "[data-test=suggested-product-one]")).not.toBeNull();
      expect(bottomMessage(el)).toBe("");
      expect(
        q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=discard-product-one]")!.disabled,
      ).toBe(true);
      cleanupWidgets();
    }
  });
  it("Save waits while a Discard is being sent, so it never sends the suggestion being discarded", async () => {
    let answer!: () => void;
    const { el, api } = await open(
      venue({ listed: [target("one"), target("two")], suggestions: [suggestion("s1", "one")] }),
      {
        discardContentSuggestion: vi.fn(
          () => new Promise((resolve) => (answer = () => resolve({ deleted: "s1" }))),
        ),
      },
    );
    await edit(el, "two", "Pan");
    await click(el, "discard-product-one");
    expect(save(el).disabled).toBe(true);
    await click(el, "save");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    answer();
    await vi.waitFor(() => expect(save(el).disabled).toBe(false));
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
      edits: [{ kind: "product", id: "two", expected: "baseline-two", text: "Pan" }],
    });
  });
  it("a Discard held when the dialog is detached does not keep its button disabled after reattaching", async () => {
    const { el, api } = await open(
      venue({ listed: [target("one")], suggestions: [suggestion("s1", "one")] }),
      { discardContentSuggestion: vi.fn(() => new Promise(() => {})) },
    );
    await click(el, "discard-product-one");
    const button = () =>
      q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=discard-product-one]")!;
    expect(button().disabled).toBe(true);
    const parent = el.parentElement!;
    el.remove();
    parent.appendChild(el);
    const reads = api.getContentTranslationTargets.mock.calls.length;
    await vi.waitFor(() =>
      expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThan(reads),
    );
    await vi.waitFor(async () => {
      q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")!.requestUpdate();
      await settle(el);
      expect(button().disabled).toBe(false);
    });
  });
  it("a scan replaced while it reads suggestion pages stops reading them", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const state = venue({
      listed: [target("one")],
      suggestions: [suggestion("s1", "one"), suggestion("s2", "one"), suggestion("s3", "one")],
      suggestionPage: 1,
    });
    const api = fakeApi(state);
    const read = api.getContentSuggestions.getMockImplementation()!;
    api.getContentSuggestions.mockImplementation(async (language: string, after?: string) => {
      if (after === "1") await held;
      return read(language, after);
    });
    const { el } = await mountWidget<ContentTranslationsDialog>(
      "dashboard-content-translations-dialog",
      { open: true, language: "es", api: api as unknown as DashboardApi },
    );
    await vi.waitFor(() => expect(api.getContentSuggestions).toHaveBeenCalledWith("es", "1"));
    el.open = false;
    await el.updateComplete;
    release();
    await held;
    // A zero-delay timer runs after every microtask the released read queues, so a further page
    // request would already have been made.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.getContentSuggestions).not.toHaveBeenCalledWith("es", "2");
  });
  it("a stale refusal on save empties that suggested row and keeps the others", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
      }),
    );
    api.saveContentTranslations.mockRejectedValueOnce({
      code: "content.translation_stale",
      params: { kind: "product", id: "two" },
    });
    await click(el, "save");
    await vi.waitFor(() =>
      expect(bottomMessage(el)).toContain(codeMessage("content.translation_stale")),
    );
    expect(field(el, "two")!.value).toBe("");
    expect(q(el, "[data-test=suggested-product-two]")).toBeNull();
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenLastCalledWith("es", {
      edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "CLIENT-es one" }],
    });
  });
  it("a suggestion arriving while the dialog is open fills an untouched row and leaves a typed one", async () => {
    const liveData = new LiveData();
    const state = venue({ listed: [target("one"), target("two")] });
    const { el, api } = await open(state, { liveData });
    await edit(el, "one", "Mine");
    state.suggestions = [suggestion("s1", "one"), suggestion("s2", "two")];
    const reads = api.getContentTranslationTargets.mock.calls.length;
    liveData.invalidate([{ type: "content_suggestions" }]);
    await vi.waitFor(() =>
      expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThan(reads),
    );
    await vi.waitFor(() => expect(field(el, "two")!.value).toBe("CLIENT-es two"));
    expect(field(el, "one")!.value).toBe("Mine");
  });
  it("a refused suggestion read keeps the translations usable and tells the refusal in the bar", async () => {
    const { el, api } = await open(venue({ listed: [target("one")] }), {
      getContentSuggestions: vi.fn(async () => {
        throw { code: "cloud.state_invalid" };
      }),
    });
    const bar = el.shadowRoot!.querySelector<
      HTMLElementTagNameMap["dashboard-content-suggestions-bar"]
    >("dashboard-content-suggestions-bar")!;
    await vi.waitFor(() => expect(bar.error).toBe(codeMessage("cloud.state_invalid")));
    expect(q(el, "[data-test=read-error]")).toBeNull();
    expect(q(el, "wt-data-table")).not.toBeNull();
    await edit(el, "one", "Pan");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
      edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "Pan" }],
    });
  });
  it("a suggestion page for another language, or one that repeats its cursor, fills nothing", async () => {
    for (const answer of [
      { language: "fr", next: null },
      { language: "es", next: "1" },
    ]) {
      const { el, api } = await open(venue({ listed: [target("one")] }), {
        getContentSuggestions: vi.fn(async () => ({
          ...answer,
          run: null,
          service: "on",
          cloudOrigin: null,
          suggestions: [suggestion("s1", "one")],
        })),
      });
      expect(q(el, "[data-test=read-error]")).toBeNull();
      expect(field(el, "one")!.value).toBe("");
      expect(api.getContentSuggestions).toHaveBeenCalled();
      cleanupWidgets();
    }
  });
  it("a suggestion read refused after a good one keeps the suggestions already filled", async () => {
    const liveData = new LiveData();
    const state = venue({
      listed: [target("one"), target("two")],
      suggestions: [suggestion("s1", "one")],
    });
    const { el, api } = await open(state, { liveData });
    api.getContentSuggestions.mockRejectedValue({ code: "cloud.state_invalid" });
    state.listed = [...state.listed, target("three")];
    liveData.invalidate([{ type: "content_suggestions" }]);
    await vi.waitFor(() => expect(q(el, "[data-test=arrivals]")).not.toBeNull());
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(q(el, "[data-test=suggested-product-one]")).not.toBeNull();
    expect(q(el, "[data-test=read-error]")).toBeNull();
  });
});

describe("Translate all notes", () => {
  it("shows a placeholder's note, fills nothing and offers Discard", async () => {
    const { el } = await open(
      venue({
        listed: [target("one")],
        suggestions: [suggestion("s1", "one", { language: null, text: null, placeholder: true })],
      }),
    );
    expect(q(el, "[data-test=placeholder-product-one]")!.textContent!.trim()).toBe(
      t("suggestions.placeholder"),
    );
    expect(field(el, "one")!.value).toBe("");
    expect(q(el, "[data-test=suggested-product-one]")).toBeNull();
    expect(q(el, "[data-test=discard-product-one]")).not.toBeNull();
    expect(save(el).disabled).toBe(true);
  });
  it("shows a spelling fix to the internal name beside the editor link, and still fills", async () => {
    const { el } = await open(
      venue({
        listed: [target("one")],
        suggestions: [
          suggestion("s1", "one"),
          suggestion("s2", "one", {
            language: null,
            text: null,
            fix: { field: "internal", wrong: "ZURRITO", right: "ZURITO" },
          }),
        ],
      }),
    );
    expect(q(el, "[data-test=fix-product-one-internal]")!.textContent!.trim()).toBe(
      fill("suggestions.fix_internal", { wrong: "ZURRITO", right: "ZURITO" }),
    );
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    const row = field(el, "one")!.closest("tr")!;
    expect(row.querySelector("a")!.getAttribute("href")).toBe("/manage/catalogue/product/one");
  });
  it("shows a fix to a name entered in another language as a note naming that language", async () => {
    const { el } = await open(
      venue({
        listed: [target("one", { defaultText: "CLIENT-en Croquettes" })],
        suggestions: [
          suggestion("s1", "one", {
            language: "en",
            text: null,
            fix: { field: "en", wrong: "Croquetes", right: "Croquettes" },
          }),
        ],
      }),
    );
    expect(q(el, "[data-test=fix-product-one-en]")!.textContent!.trim()).toBe(
      fill("suggestions.fix_language", {
        language: languageDisplayName("en", currentLocale()),
        wrong: "Croquetes",
        right: "Croquettes",
      }),
    );
    expect(field(el, "one")!.value).toBe("");
  });
  it("shows an out-of-date suggestion's note and fills nothing, as after a stale refusal", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [suggestion("s1", "one", { stale: true }), suggestion("s2", "two")],
      }),
    );
    expect(q(el, "[data-test=stale-product-one]")!.textContent!.trim()).toBe(
      t("suggestions.stale"),
    );
    expect(field(el, "one")!.value).toBe("");
    api.saveContentTranslations.mockRejectedValueOnce({
      code: "content.translation_stale",
      params: { kind: "product", id: "two" },
    });
    await click(el, "save");
    await vi.waitFor(() => expect(q(el, "[data-test=stale-product-two]")).not.toBeNull());
  });
});

describe("rows the page leaves out", () => {
  const oneLanguage = (overrides: Partial<Venue> = {}) =>
    venue({
      language: "ca",
      config: { defaultLanguage: "ca", languages: ["ca"] },
      omitted: [target("empty", { defaultRequired: true })],
      suggestions: [suggestion("s1", "empty", { language: "ca", text: "CLIENT-ca Croquetes" })],
      ...overrides,
    });
  it("shows a one-language venue's suggestion for an empty name and saves it", async () => {
    const { el, api } = await open(oneLanguage());
    expect(api.getContentTranslationTargets).toHaveBeenCalledWith("ca", {
      targets: [{ kind: "product", id: "empty" }],
    });
    expect(field(el, "empty")!.value).toBe("CLIENT-ca Croquetes");
    expect(q(el, "[data-test=suggested-product-empty]")).not.toBeNull();
    expect(q(el, "[data-test=complete]")).toBeNull();
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("ca", {
      edits: [
        { kind: "product", id: "empty", expected: "baseline-empty", text: "CLIENT-ca Croquetes" },
      ],
    });
  });
  it("keeps a page-omitted suggested row through a live refresh", async () => {
    const liveData = new LiveData();
    const { el, api } = await open(oneLanguage(), { liveData });
    const reads = api.getContentTranslationTargets.mock.calls.length;
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() =>
      expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThanOrEqual(reads + 2),
    );
    await settle(el);
    expect(field(el, "empty")!.value).toBe("CLIENT-ca Croquetes");
    expect(q(el, "[data-test=suggested-product-empty]")).not.toBeNull();
  });
  it("leaves out an omitted item that is gone, named since, or whose suggestion is out of date", async () => {
    const { el, api } = await open(
      oneLanguage({
        omitted: [
          target("gone", { eligible: false, unavailableReason: "missing" }),
          target("named", { selectedText: "Pa", effectiveSelectedText: "Pa" }),
          target("old"),
        ],
        suggestions: [
          suggestion("s1", "gone", { language: "ca" }),
          suggestion("s2", "named", { language: "ca" }),
          suggestion("s3", "old", { language: "ca", stale: true }),
        ],
      }),
    );
    expect(api.getContentTranslationTargets).toHaveBeenCalledWith("ca", {
      targets: [
        { kind: "product", id: "gone" },
        { kind: "product", id: "named" },
      ],
    });
    expect(q(el, "[data-test=complete]")).not.toBeNull();
  });
  it("reads omitted items fifty at a time", async () => {
    const ids = Array.from({ length: 60 }, (_, n) => `e${String(n).padStart(2, "0")}`);
    const { el, api } = await open(
      oneLanguage({
        omitted: ids.map((id) => target(id)),
        suggestions: ids.map((id) =>
          suggestion(`s-${id}`, id, { language: "ca", text: `CLIENT-ca ${id}` }),
        ),
      }),
    );
    const sizes = api.getContentTranslationTargets.mock.calls
      .filter(([, query]) => query.targets)
      .map(([, query]) => query.targets!.length);
    expect(sizes).toEqual([50, 10]);
    expect(field(el, "e00")!.value).toBe("CLIENT-ca e00");
  });
  it("stops reading omitted items once the dialog closes during a read", async () => {
    const ids = Array.from({ length: 60 }, (_, n) => `e${String(n).padStart(2, "0")}`);
    const state = oneLanguage({
      omitted: ids.map((id) => target(id)),
      suggestions: ids.map((id) =>
        suggestion(`s-${id}`, id, { language: "ca", text: `CLIENT-ca ${id}` }),
      ),
    });
    const base = fakeApi(state);
    let held = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const liveData = new LiveData();
    const { el, api } = await open(state, {
      liveData,
      getContentTranslationTargets: vi.fn(
        async (language: string, query: { after?: string; targets?: TranslationRef[] }) => {
          if (query.targets && held) await gate;
          return base.getContentTranslationTargets(language, query);
        },
      ),
    });
    const targetReads = () =>
      api.getContentTranslationTargets.mock.calls.filter(([, query]) => query.targets).length;
    expect(targetReads()).toBe(2);
    held = true;
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(targetReads()).toBe(3));
    el.open = false;
    await el.updateComplete;
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(targetReads()).toBe(3);
  });
});

describe("the 100-draft limit and continuing later", () => {
  const many = () => {
    const rows = Array.from({ length: 150 }, (_, n) => target(String(n).padStart(3, "0")));
    return venue({
      listed: rows,
      suggestions: rows.map((row) => suggestion(`s${row.id}`, row.id)),
    });
  };
  it("fills at most 100 drafts, says so, and saves those 100", async () => {
    const { el, api } = await open(many());
    expect(q(el, "[data-test=suggestion-capacity]")!.textContent!.trim()).toBe(
      fill("suggestions.capacity", { shown: "100" }),
    );
    await click(el, "next");
    await click(el, "next");
    expect(field(el, "100")!.value).toBe("");
    expect(field(el, "100")!.disabled).toBe(true);
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    const edits = api.saveContentTranslations.mock.calls[0]![1].edits;
    expect(edits).toHaveLength(100);
    expect(edits.at(-1)).toEqual({
      kind: "product",
      id: "099",
      expected: "baseline-099",
      text: "CLIENT-es 099",
    });
  });
  it("closing keeps every suggestion for the next opening", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
      }),
    );
    await click(el, "close");
    await vi.waitFor(() => expect(el.open).toBe(false));
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() => expect(field(el, "two")?.value).toBe("CLIENT-es two"));
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(api.discardContentSuggestion).not.toHaveBeenCalled();
  });
  it("saving a page closes the dialog, and the next opening fills the rest", async () => {
    const { el } = await open(many());
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() => expect(field(el, "100")?.value).toBe("CLIENT-es 100"));
    await settle(el);
    expect(field(el, "000")).toBeNull();
    expect(q(el, "[data-test=suggestion-capacity]")).toBeNull();
    expect(field(el, "149")!.value).toBe("CLIENT-es 149");
  });
});
