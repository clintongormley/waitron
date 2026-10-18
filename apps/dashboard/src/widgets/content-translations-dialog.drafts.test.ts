import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { languageDisplayName } from "@waitron/shared";
import type { ContentSuggestionQuery, ContentSuggestionView, DashboardApi } from "../api/client.js";
import type {
  TranslationCell,
  TranslationCellEdit,
  TranslationCellRef,
  TranslationItem,
  TranslationItemPage,
  TranslationQuery,
} from "@waitron/catalogue/src/content-translation-types.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./content-translations-dialog.js";
import type { ContentTranslationsDialog } from "./content-translations-dialog.js";

const cell = (
  id: string,
  language = "es",
  overrides: Partial<TranslationCell> = {},
): TranslationCell => ({
  kind: "product",
  id,
  language,
  field: "name",
  text: null,
  owners: { kind: "product", parentId: null },
  inheritedText: null,
  effectiveText: null,
  defaultText: null,
  inheritedDefaultText: null,
  effectiveDefaultText: null,
  expected: `baseline-${id}-${language}`,
  staffText: `STAFF ${id}`,
  eligible: true,
  unavailableReason: null,
  ...overrides,
});
const target = (id: string, overrides: Partial<TranslationCell> = {}): TranslationItem => ({
  kind: "product",
  id,
  name: `STAFF ${id}`,
  owners: { kind: "product", parentId: null },
  cells: ["en", "es", "fr", "ca"].map((language) => cell(id, language, overrides)),
});
const suggestion = (
  id: string,
  itemId: string,
  overrides: Partial<ContentSuggestionView> = {},
): ContentSuggestionView => {
  const view: ContentSuggestionView = {
    id,
    kind: "product",
    itemId,
    item: { name: `STAFF ${itemId}` },
    language: "es",
    text: `CLIENT-es ${itemId}`,
    placeholder: false,
    fix: null,
    stale: false,
    cell: { kind: "product", id: itemId, language: "es", field: "name" },
    expected: `baseline-${itemId}-es`,
    ...overrides,
  };
  if (view.language) {
    view.cell = { kind: view.kind, id: view.itemId, language: view.language, field: "name" };
    view.expected = `baseline-${itemId}-${view.language}`;
  } else {
    view.cell = null;
    view.expected = null;
  }
  return view;
};
interface Venue {
  language: string;
  config: { defaultLanguage: string; languages: string[] };
  listed: TranslationItem[];
  omitted: TranslationItem[];
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
  const facts = () => ({ config: state.config, required: [], configuration: "configuration-one" });
  const all = () => [...state.listed, ...state.omitted];
  const find = (ref: TranslationCellRef) =>
    all()
      .find((row) => row.kind === ref.kind && row.id === ref.id)
      ?.cells.find((c) => c.language === ref.language && c.field === ref.field) ??
    cell(ref.id, ref.language, { ...ref, eligible: false, unavailableReason: "missing" });
  return {
    getContentLanguages: vi.fn(async () => state.config),
    getContentTranslationTargets: vi.fn(
      async (query: TranslationQuery): Promise<TranslationItemPage> => {
        const listed =
          "targets" in query
            ? query.targets.flatMap((ref) => {
                const row = all().find((row) => row.kind === ref.kind && row.id === ref.id);
                return row ? [row] : [];
              })
            : state.listed.filter(
                (row) =>
                  query.missing.mode === "all" ||
                  state.config.languages.some(
                    (language) =>
                      (query.missing.mode !== "language" || query.missing.language === language) &&
                      !row.cells.find((c) => c.language === language)?.effectiveText,
                  ),
              );
        const after =
          "after" in query && query.after
            ? (JSON.parse(query.after) as { last: { id: string } }).last.id
            : null;
        const start = after === null ? 0 : listed.findIndex((row) => row.id === after) + 1;
        const rows = listed.slice(start, start + 50).map((row) => ({
          ...row,
          cells: row.cells.filter((c) => query.languages.includes(c.language)),
        }));
        const next =
          start + 50 < listed.length
            ? JSON.stringify({
                configuration: "configuration-one",
                filter: {
                  languages: query.languages,
                  missing: "missing" in query ? query.missing : { mode: "all" },
                  kind: "kind" in query ? (query.kind ?? null) : null,
                  search: "search" in query ? (query.search?.trim() ?? "") : "",
                  waitingFixes: "waitingFixes" in query && query.waitingFixes === true,
                },
                last: { kind: "product", id: rows.at(-1)!.id },
              })
            : null;
        return { ...facts(), rows, next, total: listed.length };
      },
    ),
    getContentTranslationCells: vi.fn(async (refs: readonly TranslationCellRef[]) => ({
      ...facts(),
      cells: refs.map(find),
    })),
    getContentSuggestions: vi.fn(async (query: ContentSuggestionQuery = {}) => {
      const start = query.after === undefined ? 0 : Number(query.after);
      const end = start + state.suggestionPage;
      return {
        ...facts(),
        waitingFixes: 0,
        run: null,
        service: "on" as const,
        cloudOrigin: null,
        suggestions: state.suggestions.slice(start, end),
        next: end < state.suggestions.length ? String(end) : null,
      };
    }),
    saveContentTranslations: vi.fn(async (batch: { edits: TranslationCellEdit[] }) => {
      const saved = batch.edits.map((edit) => ({
        ...find(edit),
        ...edit,
        effectiveText: edit.text,
        expected: `saved-${edit.id}-${edit.language}`,
      }));
      for (const value of saved) {
        const row = all().find((row) => row.kind === value.kind && row.id === value.id)!;
        row.cells = row.cells.map((c) =>
          c.language === value.language && c.field === value.field ? value : c,
        );
      }
      state.suggestions = state.suggestions.filter(
        (view) =>
          !batch.edits.some(
            (edit) =>
              view.kind === edit.kind && view.itemId === edit.id && view.language === edit.language,
          ),
      );
      return { saved };
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
const q = <T extends HTMLElement = HTMLElement>(
  el: ContentTranslationsDialog,
  selector: string,
): T | null =>
  el.shadowRoot!.querySelector<T>(selector) ??
  el
    .shadowRoot!.querySelector("dashboard-content-translation-window")
    ?.shadowRoot?.querySelector<T>(selector) ??
  null;
const field = (el: ContentTranslationsDialog, id: string, language = el.language) =>
  q<HTMLElementTagNameMap["wt-input"]>(el, `[name="translation-product-${id}-${language}-name"]`);
const note = (el: ContentTranslationsDialog, id: string) => q(el, `[data-suggestion="${id}"]`);
const discardButton = (el: ContentTranslationsDialog, id: string) =>
  note(el, id)?.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=discard-suggestion]",
  ) ?? null;
const save = (el: ContentTranslationsDialog) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!;
const bar = (el: ContentTranslationsDialog) =>
  q<HTMLElementTagNameMap["dashboard-content-suggestions-bar"]>(
    el,
    "dashboard-content-suggestions-bar",
  )!;
const bottomMessage = (el: ContentTranslationsDialog) =>
  q<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error;
async function settle(el: ContentTranslationsDialog) {
  await el.updateComplete;
  await q<HTMLElementTagNameMap["dashboard-content-translation-window"]>(
    el,
    "dashboard-content-translation-window",
  )?.updateComplete;
  await bar(el)?.updateComplete;
}
async function ready(el: ContentTranslationsDialog) {
  await vi.waitFor(() => expect(q(el, "[data-test=loading]")).toBeNull());
  await settle(el);
}
async function open(
  state: Venue,
  overrides: Record<string, unknown> = {},
  theme?: "light" | "dark",
) {
  const api = fakeApi(state, overrides);
  const mounted = await mountWidget<ContentTranslationsDialog>(
    "dashboard-content-translations-dialog",
    {
      open: true,
      language: state.language,
      config: state.config,
      api: api as unknown as DashboardApi,
    },
    theme,
  );
  await ready(mounted.el);
  return { ...mounted, api };
}
async function edit(
  el: ContentTranslationsDialog,
  id: string,
  text: string,
  language = el.language,
) {
  const control = field(el, id, language);
  expect(control).not.toBeNull();
  control!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: text }, bubbles: true, composed: true }),
  );
  await settle(el);
}
async function click(el: ContentTranslationsDialog, action: string) {
  const control = q<HTMLElement>(el, `[data-test=${action}]`);
  expect(control).not.toBeNull();
  control!.click();
  await settle(el);
  if (["show-edited", "next", "previous", "review"].includes(action)) {
    await vi.waitFor(() =>
      expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(false),
    );
    await settle(el);
  }
}
async function discard(el: ContentTranslationsDialog, id: string) {
  const control = discardButton(el, id);
  expect(control).not.toBeNull();
  control!.click();
  await settle(el);
}
async function reopened(el: ContentTranslationsDialog, language = el.language) {
  el.open = false;
  await el.updateComplete;
  el.language = language;
  el.open = true;
  await el.updateComplete;
  await ready(el);
}
async function delivered(result: Promise<unknown>, el: ContentTranslationsDialog) {
  await result;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await settle(el);
}
const submitted = (id: string, text: string | null, language = "es"): TranslationCellEdit => ({
  kind: "product",
  id,
  language,
  field: "name",
  expected: `baseline-${id}-${language}`,
  text,
});
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
    expect(note(el, "s1")!.textContent).toContain(t("suggestions.suggested"));
    expect(discardButton(el, "s1")).not.toBeNull();
    expect(field(el, "two")!.value).toBe("");
    expect(save(el).disabled).toBe(false);
    expect(save(el).variant).toBe("primary");
    await click(el, "show-edited");
    expect(field(el, "one")).not.toBeNull();
    expect(field(el, "two")).toBeNull();
  });
  it("fills each optional language independently, including the default", async () => {
    const { el } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [
          suggestion("s1", "one"),
          suggestion("s2", "one", { language: "en", text: "CLIENT-en one" }),
          suggestion("s3", "two"),
        ],
      }),
    );
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(field(el, "one", "en")!.value).toBe("CLIENT-en one");
    expect(field(el, "two")!.value).toBe("CLIENT-es two");
    expect(field(el, "two", "en")!.value).toBe("");
    expect(field(el, "two", "en")!.required).toBe(false);
  });
  it("reads one suggestion page at a time and fills further pages only on request", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two"), target("three")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two"), suggestion("s3", "three")],
        suggestionPage: 1,
      }),
    );
    expect(api.getContentSuggestions.mock.calls).toEqual([[{}]]);
    expect(field(el, "three")!.value).toBe("");
    await click(el, "next-suggestions");
    expect(api.getContentSuggestions).toHaveBeenLastCalledWith({
      after: "1",
      configuration: "configuration-one",
    });
    expect(field(el, "two")!.value).toBe("CLIENT-es two");
    await click(el, "next-suggestions");
    expect(api.getContentSuggestions).toHaveBeenLastCalledWith({
      after: "2",
      configuration: "configuration-one",
    });
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
    expect(note(el, "s2")!.textContent).not.toContain(t("suggestions.suggested"));
    await edit(el, "three", "Pan");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        submitted("one", "CLIENT-es one"),
        submitted("two", "Croqueta casera"),
        submitted("three", "Pan"),
      ],
    });
  });
  it("Discard deletes only its named suggestion; each language has a separate action", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one")],
        suggestions: [
          suggestion("s1", "one"),
          suggestion("s2", "one", { language: "en", text: "CLIENT-en one" }),
        ],
      }),
    );
    await discard(el, "s1");
    await vi.waitFor(() => expect(field(el, "one")!.value).toBe(""));
    expect(api.discardContentSuggestion.mock.calls).toEqual([["s1"]]);
    expect(field(el, "one", "en")!.value).toBe("CLIENT-en one");
    await discard(el, "s2");
    await vi.waitFor(() => expect(field(el, "one", "en")!.value).toBe(""));
    expect(note(el, "s1")).toBeNull();
    expect(note(el, "s2")).toBeNull();
    expect(save(el).disabled).toBe(true);
  });
  it("a suggestion the server no longer holds counts as discarded; any other refusal is shown", async () => {
    const state = venue({
      listed: [target("one"), target("two")],
      suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
    });
    const { el, api } = await open(state);
    state.suggestions = state.suggestions.filter((v) => v.id !== "s1");
    await discard(el, "s1");
    await vi.waitFor(() => expect(field(el, "one")!.value).toBe(""));
    api.discardContentSuggestion.mockRejectedValueOnce({ code: "server.internal" });
    await discard(el, "s2");
    await vi.waitFor(() => expect(bar(el).error).toBe(codeMessage("server.internal")));
    expect(field(el, "two")!.value).toBe("CLIENT-es two");
    expect(note(el, "s2")!.textContent).toContain(t("suggestions.suggested"));
  });
  it("a refused independent Discard preserves its suggestion after an earlier language was deleted", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [
          suggestion("s1", "one"),
          suggestion("s2", "one", { language: "en", text: "CLIENT-en one" }),
        ],
      }),
    );
    await discard(el, "s1");
    await vi.waitFor(() => expect(note(el, "s1")).toBeNull());
    api.discardContentSuggestion.mockRejectedValueOnce({ code: "server.internal" });
    await discard(el, "s2");
    await vi.waitFor(() => expect(bar(el).error).toBe(codeMessage("server.internal")));
    await edit(el, "two", "Pan");
    expect(field(el, "one")!.value).toBe("");
    expect(field(el, "one", "en")!.value).toBe("CLIENT-en one");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [submitted("one", "CLIENT-en one", "en"), submitted("two", "Pan")],
    });
  });
  for (const refresh of [false, true])
    it(`a failed second per-id Discard retains only its own borrowed text, refresh=${refresh}`, async () => {
      const liveData = new LiveData();
      const state = venue({
        listed: [target("one"), target("two")],
        suggestions: [
          suggestion("s0", "one", {
            text: null,
            language: null,
            fix: { field: "internal", wrong: "Pann", right: "Pan" },
          }),
          suggestion("s1", "one"),
        ],
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const base = fakeApi(state);
      const { el, api } = await open(state, {
        liveData,
        discardContentSuggestion: vi.fn(async (id: string) => {
          if (id === "s0") return base.discardContentSuggestion(id);
          await gate;
          throw { code: "server.internal" };
        }),
      });
      await discard(el, "s0");
      await vi.waitFor(() => expect(note(el, "s0")).toBeNull());
      await discard(el, "s1");
      if (refresh) {
        liveData.invalidate([{ type: "content_suggestions" }]);
        await vi.waitFor(() =>
          expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(1),
        );
      }
      release();
      await delivered(
        api.discardContentSuggestion.mock.results[1]!.value.catch(() => {}),
        el,
      );
      expect(bar(el).error).toBe(codeMessage("server.internal"));
      expect(field(el, "one")!.value).toBe("CLIENT-es one");
      expect(save(el).disabled).toBe(false);
      state.suggestions.push(suggestion("s2", "two"));
      liveData.invalidate([{ type: "content_suggestions" }]);
      await vi.waitFor(() => expect(field(el, "two")!.value).toBe("CLIENT-es two"));
      await click(el, "save");
      await vi.waitFor(() => expect(el.open).toBe(false));
      expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
        edits: [submitted("one", "CLIENT-es one"), submitted("two", "CLIENT-es two")],
      });
    });
  for (const typed of ["es", "en"])
    it(`Discard preserves personal ${typed} and saves it without a required companion`, async () => {
      const { el, api } = await open(
        venue({
          listed: [target("one")],
          suggestions: [
            suggestion("s1", "one"),
            suggestion("s2", "one", { language: "en", text: "CLIENT-en one" }),
          ],
        }),
      );
      await edit(el, "one", "Mine", typed);
      await discard(el, "s1");
      await vi.waitFor(() => expect(note(el, "s1")).toBeNull());
      await discard(el, "s2");
      await vi.waitFor(() => expect(note(el, "s2")).toBeNull());
      expect(field(el, "one", typed)!.value).toBe("Mine");
      expect(field(el, "one", typed === "es" ? "en" : "es")!.value).toBe("");
      await click(el, "save");
      await vi.waitFor(() => expect(el.open).toBe(false));
      expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
        edits: [submitted("one", "Mine", typed)],
      });
    });
  it("Discard removes borrowed default text through a refresh while preserving a personal other language", async () => {
    const liveData = new LiveData();
    const state = venue({
      listed: [target("one")],
      suggestions: [
        suggestion("s1", "one"),
        suggestion("s2", "one", { language: "en", text: "CLIENT-en one" }),
      ],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = fakeApi(state);
    const { el, api } = await open(state, {
      liveData,
      discardContentSuggestion: vi.fn(async (id: string) => {
        await gate;
        return base.discardContentSuggestion(id);
      }),
    });
    await edit(el, "one", "Mine");
    await discard(el, "s2");
    liveData.invalidate([{ type: "content_suggestions" }]);
    await vi.waitFor(() => expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(1));
    release();
    await delivered(api.discardContentSuggestion.mock.results[0]!.value, el);
    expect(field(el, "one")!.value).toBe("Mine");
    expect(field(el, "one", "en")!.value).toBe("");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [submitted("one", "Mine")],
    });
  });
  for (const refresh of [false, true])
    it(`a failed Discard retains the other suggestion when its default is typed while waiting, refresh=${refresh}`, async () => {
      const liveData = new LiveData();
      const state = venue({
        listed: [target("one")],
        suggestions: [
          suggestion("s0", "one", {
            text: null,
            language: null,
            fix: { field: "internal", wrong: "Pann", right: "Pan" },
          }),
          suggestion("s1", "one"),
          suggestion("s2", "one", { language: "en", text: "CLIENT-en one" }),
        ],
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const base = fakeApi(state);
      const { el, api } = await open(state, {
        liveData,
        discardContentSuggestion: vi.fn(async (id: string) => {
          if (id === "s0") return base.discardContentSuggestion(id);
          await gate;
          throw { code: "server.internal" };
        }),
      });
      await discard(el, "s0");
      await vi.waitFor(() => expect(note(el, "s0")).toBeNull());
      await discard(el, "s1");
      if (refresh) {
        liveData.invalidate([{ type: "content_suggestions" }]);
        await vi.waitFor(() =>
          expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(1),
        );
      }
      await edit(el, "one", "Mine", "en");
      release();
      await delivered(
        api.discardContentSuggestion.mock.results[1]!.value.catch(() => {}),
        el,
      );
      expect(field(el, "one")!.value).toBe("CLIENT-es one");
      expect(field(el, "one", "en")!.value).toBe("Mine");
      expect(bar(el).error).toBe(codeMessage("server.internal"));
      await click(el, "save");
      await vi.waitFor(() => expect(el.open).toBe(false));
      expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
        edits: [submitted("one", "CLIENT-es one"), submitted("one", "Mine", "en")],
      });
    });
  it("Discard sends once while its own request or a save is being sent", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
      }),
      {
        discardContentSuggestion: vi.fn(async () => {
          await gate;
          return { deleted: "s1" };
        }),
        saveContentTranslations: vi.fn(() => new Promise(() => {})),
      },
    );
    await discard(el, "s1");
    expect(discardButton(el, "s1")!.disabled).toBe(true);
    await discard(el, "s1");
    expect(api.discardContentSuggestion).toHaveBeenCalledTimes(1);
    release();
    await delivered(api.discardContentSuggestion.mock.results[0]!.value, el);
    expect(field(el, "one")!.value).toBe("");
    await click(el, "save");
    await discard(el, "s2");
    expect(api.discardContentSuggestion).toHaveBeenCalledTimes(1);
  });
  it("a Discard unanswered across reopening keeps Discard and Save waiting and then leaves the deleted value out", async () => {
    const state = venue({
      listed: [target("one"), target("two")],
      suggestions: [suggestion("s1", "one")],
    });
    const base = fakeApi(state);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { el, api } = await open(state, {
      discardContentSuggestion: vi.fn(async (id: string) => {
        await gate;
        return base.discardContentSuggestion(id);
      }),
    });
    await discard(el, "s1");
    await reopened(el);
    await edit(el, "two", "Pan");
    expect(discardButton(el, "s1")!.disabled).toBe(true);
    expect(save(el).disabled).toBe(true);
    await discard(el, "s1");
    await click(el, "save");
    expect(api.discardContentSuggestion).toHaveBeenCalledTimes(1);
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    release();
    await delivered(api.discardContentSuggestion.mock.results[0]!.value, el);
    expect(field(el, "one")!.value).toBe("");
    expect(note(el, "s1")).toBeNull();
    expect(save(el).disabled).toBe(false);
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [submitted("two", "Pan")],
    });
  });
  it("a suggestion read begun before Discard does not fill the reopened row after deletion", async () => {
    const state = venue({
      listed: [target("one"), target("two")],
      suggestions: [suggestion("s1", "one")],
    });
    const base = fakeApi(state);
    let releaseDelete!: () => void;
    const deletion = new Promise<void>((resolve) => (releaseDelete = resolve));
    const { el, api } = await open(state, {
      discardContentSuggestion: vi.fn(async (id: string) => {
        await deletion;
        return base.discardContentSuggestion(id);
      }),
    });
    await discard(el, "s1");
    let releaseRead!: () => void;
    const held = new Promise<void>((resolve) => (releaseRead = resolve));
    const read = api.getContentSuggestions.getMockImplementation()!;
    api.getContentSuggestions.mockImplementation(async (query: ContentSuggestionQuery = {}) => {
      const result = await read(query);
      await held;
      return result;
    });
    const reads = api.getContentSuggestions.mock.calls.length;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await vi.waitFor(() =>
      expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads),
    );
    releaseDelete();
    await api.discardContentSuggestion.mock.results[0]!.value;
    releaseRead();
    await delivered(api.getContentSuggestions.mock.results[reads]!.value, el);
    await ready(el);
    expect(field(el, "one")!.value).toBe("");
    expect(note(el, "s1")).toBeNull();
    await edit(el, "two", "Pan");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [submitted("two", "Pan")],
    });
  });
  it("a deletion completed between readers suppresses an older listing after configuration loads", async () => {
    const state = venue({ listed: [target("one")], suggestions: [suggestion("s1", "one")] });
    const base = fakeApi(state);
    let releaseDelete!: () => void;
    const deleting = new Promise<void>((resolve) => (releaseDelete = resolve));
    const { el, api } = await open(state, {
      discardContentSuggestion: vi.fn(async (id: string) => {
        await deleting;
        return base.discardContentSuggestion(id);
      }),
    });
    const older = await base.getContentSuggestions({});
    await discard(el, "s1");
    el.open = false;
    await el.updateComplete;
    el.config = null;
    let releaseConfig!: (config: Venue["config"]) => void;
    api.getContentLanguages.mockImplementationOnce(
      () => new Promise((resolve) => (releaseConfig = resolve)),
    );
    api.getContentSuggestions.mockResolvedValue(older);
    el.open = true;
    await vi.waitFor(() => expect(api.getContentLanguages).toHaveBeenCalledOnce());
    releaseDelete();
    await delivered(api.discardContentSuggestion.mock.results[0]!.value, el);
    releaseConfig(state.config);
    await ready(el);
    expect(field(el, "one")!.value).toBe("");
    expect(note(el, "s1")).toBeNull();
    expect(save(el).disabled).toBe(true);
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
  });
  it("a Discard refused after reopening leaves the suggestion usable and shows no old refusal", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { el, api } = await open(
      venue({ listed: [target("one")], suggestions: [suggestion("s1", "one")] }),
      {
        discardContentSuggestion: vi.fn(async () => {
          await gate;
          throw { code: "server.internal" };
        }),
      },
    );
    await discard(el, "s1");
    await reopened(el);
    release();
    await delivered(
      api.discardContentSuggestion.mock.results[0]!.value.catch(() => {}),
      el,
    );
    expect(discardButton(el, "s1")!.disabled).toBe(false);
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(bar(el).error).toBe("");
    expect(bottomMessage(el)).toBe("");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [submitted("one", "CLIENT-es one")],
    });
  });
  it("a failed independent deletion answered before the reopened first read preserves the still-stored suggestion", async () => {
    const state = venue({
      listed: [target("one")],
      suggestions: [
        suggestion("s0", "one", { language: null, text: null, placeholder: true }),
        suggestion("s1", "one"),
      ],
    });
    const base = fakeApi(state);
    let releaseDelete!: () => void;
    const deletion = new Promise<void>((resolve) => (releaseDelete = resolve));
    const { el, api } = await open(state, {
      discardContentSuggestion: vi.fn(async (id: string) => {
        if (id === "s0") return base.discardContentSuggestion(id);
        await deletion;
        throw { code: "server.internal" };
      }),
    });
    await discard(el, "s0");
    await vi.waitFor(() => expect(note(el, "s0")).toBeNull());
    await discard(el, "s1");
    let releaseRead!: () => void;
    const gate = new Promise<void>((resolve) => (releaseRead = resolve));
    const read = api.getContentSuggestions.getMockImplementation()!;
    api.getContentSuggestions.mockImplementation(async (query: ContentSuggestionQuery = {}) => {
      const value = await read(query);
      await gate;
      return value;
    });
    const reads = api.getContentSuggestions.mock.calls.length;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await vi.waitFor(() =>
      expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads),
    );
    releaseDelete();
    await delivered(
      api.discardContentSuggestion.mock.results[1]!.value.catch(() => {}),
      el,
    );
    releaseRead();
    await delivered(api.getContentSuggestions.mock.results[reads]!.value, el);
    await ready(el);
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(note(el, "s0")).toBeNull();
    expect(bar(el).error).toBe("");
    expect(save(el).disabled).toBe(false);
    await reopened(el);
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
  });
  for (const beforeRead of [false, true])
    it(`a refused Spanish Discard does not remove French after reopening, beforeRead=${beforeRead}`, async () => {
      const state = venue({
        config: { defaultLanguage: "en", languages: ["en", "es", "fr"] },
        listed: [target("one")],
        suggestions: [suggestion("s1", "one")],
      });
      let releaseDelete!: () => void;
      const gate = new Promise<void>((resolve) => (releaseDelete = resolve));
      const { el, api } = await open(state, {
        discardContentSuggestion: vi.fn(async () => {
          await gate;
          throw { code: "server.internal" };
        }),
      });
      await discard(el, "s1");
      state.suggestions.push(suggestion("s3", "one", { language: "fr", text: "CLIENT-fr one" }));
      let releaseRead = () => {};
      const read = api.getContentSuggestions.getMockImplementation()!;
      const reads = api.getContentSuggestions.mock.calls.length;
      if (beforeRead) {
        const held = new Promise<void>((resolve) => (releaseRead = resolve));
        api.getContentSuggestions.mockImplementation(async (query: ContentSuggestionQuery = {}) => {
          const value = await read(query);
          await held;
          return value;
        });
      }
      el.open = false;
      await el.updateComplete;
      el.language = "fr";
      el.open = true;
      await vi.waitFor(() =>
        expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads),
      );
      if (!beforeRead) await ready(el);
      releaseDelete();
      await delivered(
        api.discardContentSuggestion.mock.results[0]!.value.catch(() => {}),
        el,
      );
      releaseRead();
      await delivered(api.getContentSuggestions.mock.results[reads]!.value, el);
      await ready(el);
      expect(field(el, "one", "fr")!.value).toBe("CLIENT-fr one");
      expect(field(el, "one", "es")!.value).toBe("CLIENT-es one");
      expect(bar(el).error).toBe("");
      expect(discardButton(el, "s1")!.disabled).toBe(false);
      await click(el, "save");
      await vi.waitFor(() => expect(el.open).toBe(false));
      expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
        edits: [submitted("one", "CLIENT-es one"), submitted("one", "CLIENT-fr one", "fr")],
      });
    });
  for (const beforeRead of [false, true])
    it(`an earlier deleted note and refused Spanish deletion do not suppress later Spanish reopening, beforeRead=${beforeRead}`, async () => {
      const state = venue({
        config: { defaultLanguage: "en", languages: ["en", "es", "fr"] },
        listed: [target("one")],
        suggestions: [
          suggestion("s0", "one", { text: null, language: null, placeholder: true }),
          suggestion("s1", "one"),
          suggestion("s2", "one", {
            text: null,
            language: null,
            fix: { field: "internal", wrong: "ZURRITO", right: "ZURITO" },
          }),
        ],
      });
      const base = fakeApi(state);
      let releaseDelete!: () => void;
      const gate = new Promise<void>((resolve) => (releaseDelete = resolve));
      const { el, api } = await open(state, {
        discardContentSuggestion: vi.fn(async (id: string) => {
          if (id === "s0") return base.discardContentSuggestion(id);
          await gate;
          throw { code: "server.internal" };
        }),
      });
      await discard(el, "s0");
      await vi.waitFor(() => expect(note(el, "s0")).toBeNull());
      await discard(el, "s1");
      state.suggestions.push(suggestion("s3", "one", { language: "fr", text: "CLIENT-fr one" }));
      let releaseRead = () => {};
      const read = api.getContentSuggestions.getMockImplementation()!;
      const reads = api.getContentSuggestions.mock.calls.length;
      if (beforeRead) {
        const held = new Promise<void>((resolve) => (releaseRead = resolve));
        api.getContentSuggestions.mockImplementation(async (query: ContentSuggestionQuery = {}) => {
          const value = await read(query);
          await held;
          return value;
        });
      }
      el.open = false;
      await el.updateComplete;
      el.language = "fr";
      el.open = true;
      await vi.waitFor(() =>
        expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads),
      );
      if (!beforeRead) await ready(el);
      releaseDelete();
      await delivered(
        api.discardContentSuggestion.mock.results[1]!.value.catch(() => {}),
        el,
      );
      releaseRead();
      await delivered(api.getContentSuggestions.mock.results[reads]!.value, el);
      await ready(el);
      await reopened(el, "es");
      expect(field(el, "one")!.value).toBe("CLIENT-es one");
      expect(note(el, "s0")).toBeNull();
      expect(note(el, "s2")!.textContent).toContain("ZURRITO");
      expect(discardButton(el, "s1")!.disabled).toBe(false);
      await click(el, "save");
      await vi.waitFor(() => expect(el.open).toBe(false));
      expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
        edits: [submitted("one", "CLIENT-es one"), submitted("one", "CLIENT-fr one", "fr")],
      });
    });
  it("Save waits for Discard and never sends the value being discarded", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { el, api } = await open(
      venue({ listed: [target("one"), target("two")], suggestions: [suggestion("s1", "one")] }),
      {
        discardContentSuggestion: vi.fn(async () => {
          await gate;
          return { deleted: "s1" };
        }),
      },
    );
    await edit(el, "two", "Pan");
    await discard(el, "s1");
    expect(save(el).disabled).toBe(true);
    await click(el, "save");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    release();
    await delivered(api.discardContentSuggestion.mock.results[0]!.value, el);
    expect(save(el).disabled).toBe(false);
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [submitted("two", "Pan")],
    });
  });
  it("a Discard unanswered across disconnect and reconnect keeps Save waiting and excludes the deleted value", async () => {
    const state = venue({
      listed: [target("one"), target("two")],
      suggestions: [suggestion("s1", "one")],
    });
    const base = fakeApi(state);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { el, api } = await open(state, {
      discardContentSuggestion: vi.fn(async (id: string) => {
        await gate;
        return base.discardContentSuggestion(id);
      }),
    });
    await edit(el, "two", "Pan");
    await discard(el, "s1");
    const reads = api.getContentTranslationTargets.mock.calls.length;
    const parent = el.parentElement!;
    el.remove();
    parent.appendChild(el);
    await vi.waitFor(() =>
      expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThan(reads),
    );
    await settle(el);
    expect(discardButton(el, "s1")!.disabled).toBe(true);
    expect(save(el).disabled).toBe(true);
    await click(el, "save");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    release();
    await delivered(api.discardContentSuggestion.mock.results[0]!.value, el);
    expect(field(el, "one")!.value).toBe("");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [submitted("two", "Pan")],
    });
  });
  it("a closed editor ignores the pending explicitly requested suggestion page and does not drain the next one", async () => {
    const state = venue({
      listed: [target("one")],
      suggestions: [suggestion("s1", "one"), suggestion("s2", "one"), suggestion("s3", "one")],
      suggestionPage: 1,
    });
    const base = fakeApi(state);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { el, api } = await open(state, {
      getContentSuggestions: vi.fn(async (query: ContentSuggestionQuery = {}) => {
        const value = await base.getContentSuggestions(query);
        if (query.after === "1") await gate;
        return value;
      }),
    });
    await click(el, "next-suggestions");
    await vi.waitFor(() =>
      expect(api.getContentSuggestions).toHaveBeenCalledWith({
        after: "1",
        configuration: "configuration-one",
      }),
    );
    el.open = false;
    await el.updateComplete;
    release();
    await delivered(api.getContentSuggestions.mock.results.at(-1)!.value, el);
    expect(el.open).toBe(false);
    expect(api.getContentSuggestions).not.toHaveBeenCalledWith({
      after: "2",
      configuration: "configuration-one",
    });
  });
  it("a stale save refusal identifies exactly its language field and retains the other drafts", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
      }),
    );
    api.saveContentTranslations.mockRejectedValueOnce({
      code: "content.translation_stale",
      params: { kind: "product", id: "two", language: "es", field: "name" },
    });
    await click(el, "save");
    await vi.waitFor(() =>
      expect(field(el, "two")!.error).toBe(codeMessage("content.translation_stale")),
    );
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(field(el, "two")!.value).toBe("CLIENT-es two");
    expect(save(el).disabled).toBe(false);
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenLastCalledWith({
      edits: [submitted("one", "CLIENT-es one"), submitted("two", "CLIENT-es two")],
    });
  });
  it("live suggestions fill untouched fields and leave personal values", async () => {
    const liveData = new LiveData();
    const state = venue({ listed: [target("one"), target("two")] });
    const { el } = await open(state, { liveData });
    await edit(el, "one", "Mine");
    state.suggestions = [suggestion("s1", "one"), suggestion("s2", "two")];
    liveData.invalidate([{ type: "content_suggestions" }]);
    await vi.waitFor(() => expect(field(el, "two")!.value).toBe("CLIENT-es two"));
    expect(field(el, "one")!.value).toBe("Mine");
  });
  it("a refused suggestion read leaves translations usable and reports in the bar", async () => {
    const { el, api } = await open(venue({ listed: [target("one")] }), {
      getContentSuggestions: vi.fn(async () => {
        throw { code: "cloud.state_invalid" };
      }),
    });
    expect(bar(el).error).toBe(codeMessage("cloud.state_invalid"));
    expect(q(el, "[data-test=read-error]")).toBeNull();
    expect(field(el, "one")).not.toBeNull();
    await edit(el, "one", "Pan");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [submitted("one", "Pan")],
    });
  });
  it("a refused requested continuation reports in the bar and recovers on explicit retry", async () => {
    const state = venue({
      listed: [target("one"), target("two")],
      suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
      suggestionPage: 1,
    });
    const base = fakeApi(state);
    let refuse = true;
    const { el } = await open(state, {
      getContentSuggestions: vi.fn(async (query: ContentSuggestionQuery = {}) => {
        if (query.after && refuse) throw { code: "cloud.unavailable" };
        return base.getContentSuggestions(query);
      }),
    });
    await click(el, "next-suggestions");
    await vi.waitFor(() => expect(bar(el).error).toBe(codeMessage("cloud.unavailable")));
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(field(el, "two")!.value).toBe("");
    expect(q(el, "[data-test=read-error]")).toBeNull();
    await click(el, "next-suggestions");
    await settle(el);
    expect(bar(el).error).toBe(codeMessage("cloud.unavailable"));
    refuse = false;
    await click(el, "next-suggestions");
    await vi.waitFor(() => expect(field(el, "two")!.value).toBe("CLIENT-es two"));
    expect(bar(el).error).toBe("");
  });
  it("Review latest retains continuation drafts while a requested later page refuses", async () => {
    const state = venue({
      listed: [target("one"), target("two"), target("three")],
      suggestions: [suggestion("s1", "one"), suggestion("s2", "two"), suggestion("s3", "three")],
      suggestionPage: 1,
    });
    const base = fakeApi(state);
    let refuse = false;
    const { el, api } = await open(state, {
      getContentSuggestions: vi.fn(async (query: ContentSuggestionQuery = {}) => {
        if (query.after && refuse) throw { code: "cloud.unavailable" };
        return base.getContentSuggestions(query);
      }),
    });
    await click(el, "next-suggestions");
    await vi.waitFor(() => expect(field(el, "two")!.value).toBe("CLIENT-es two"));
    const reads = api.getContentSuggestions.mock.calls.length;
    await click(el, "review");
    expect(api.getContentSuggestions).toHaveBeenCalledTimes(reads);
    refuse = true;
    await click(el, "next-suggestions");
    await vi.waitFor(() => expect(bar(el).error).toBe(codeMessage("cloud.unavailable")));
    expect(field(el, "two")!.value).toBe("CLIENT-es two");
    expect(field(el, "three")!.value).toBe("");
  });
  it("reopening forgets an old continuation refusal while its new first read waits", async () => {
    const state = venue({
      listed: [target("one"), target("two")],
      suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
      suggestionPage: 1,
    });
    const base = fakeApi(state);
    const { el, api } = await open(state, {
      getContentSuggestions: vi.fn(async (query: ContentSuggestionQuery = {}) => {
        if (query.after) throw { code: "cloud.unavailable" };
        return base.getContentSuggestions(query);
      }),
    });
    await click(el, "next-suggestions");
    await vi.waitFor(() => expect(bar(el).error).toBe(codeMessage("cloud.unavailable")));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    api.getContentSuggestions.mockImplementation(async () => {
      await gate;
      return base.getContentSuggestions({});
    });
    const reads = api.getContentSuggestions.mock.calls.length;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await vi.waitFor(() =>
      expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads),
    );
    await settle(el);
    expect(bar(el).error).toBe("");
    release();
    await delivered(api.getContentSuggestions.mock.results[reads]!.value, el);
    await ready(el);
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
  });
  it("a changed configuration or repeated continuation cursor never borrows that page", async () => {
    for (const mismatch of [true, false]) {
      const state = venue({
        listed: [target("one"), target("two")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
        suggestionPage: 1,
      });
      const base = fakeApi(state);
      const { el, api } = await open(state, {
        getContentSuggestions: vi.fn(async (query: ContentSuggestionQuery = {}) => {
          const value = await base.getContentSuggestions(query);
          return query.after
            ? {
                ...value,
                ...(mismatch
                  ? {
                      config: { defaultLanguage: "fr", languages: ["fr"] },
                      configuration: "changed",
                    }
                  : { next: query.after }),
              }
            : value;
        }),
      });
      await click(el, "next-suggestions");
      await vi.waitFor(() => expect(bar(el).error).not.toBe(""));
      expect(field(el, "one")!.value).toBe("CLIENT-es one");
      expect(field(el, "two")!.value).toBe("");
      expect(q(el, "[data-test=read-error]")).toBeNull();
      expect(api.getContentSuggestions).toHaveBeenCalledTimes(2);
      cleanupWidgets();
    }
  });
  it("a later refused suggestion refresh keeps already borrowed text", async () => {
    const liveData = new LiveData();
    const state = venue({
      listed: [target("one"), target("two")],
      suggestions: [suggestion("s1", "one")],
    });
    const { el, api } = await open(state, { liveData });
    api.getContentSuggestions.mockRejectedValue({ code: "cloud.state_invalid" });
    state.listed.push(target("three"));
    liveData.invalidate([{ type: "content_suggestions" }]);
    await vi.waitFor(() => expect(bar(el).error).toBe(codeMessage("cloud.state_invalid")));
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(note(el, "s1")!.textContent).toContain(t("suggestions.suggested"));
    expect(q(el, "[data-test=read-error]")).toBeNull();
  });
});
describe("Translate all notes", () => {
  it("shows a placeholder note, fills nothing and offers Discard", async () => {
    const { el } = await open(
      venue({
        listed: [target("one")],
        suggestions: [suggestion("s1", "one", { language: null, text: null, placeholder: true })],
      }),
    );
    expect(note(el, "s1")!.textContent).toContain(t("suggestions.placeholder"));
    expect(field(el, "one")!.value).toBe("");
    expect(note(el, "s1")!.textContent).not.toContain(t("suggestions.suggested"));
    expect(discardButton(el, "s1")).not.toBeNull();
    expect(save(el).disabled).toBe(true);
  });
  it("shows an internal spelling fix with its editor link while the other suggestion fills", async () => {
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
    expect(note(el, "s2")!.textContent).toContain(
      fill("suggestions.fix_internal", { wrong: "ZURRITO", right: "ZURITO" }),
    );
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(note(el, "s2")!.querySelector("a")!.getAttribute("href")).toBe(
      "/manage/catalogue/product/one",
    );
    expect(note(el, "s2")!.querySelector("[data-test=use-fix]")).toBeNull();
  });
  it("names the language of a spelling fix and waits for Use fix", async () => {
    const row = target("one");
    row.cells = row.cells.map((c) =>
      c.language === "en" ? { ...c, text: "Croquetes", effectiveText: "Croquetes" } : c,
    );
    const { el } = await open(
      venue({
        listed: [row],
        suggestions: [
          suggestion("s1", "one", {
            language: "en",
            text: null,
            fix: { field: "en", wrong: "Croquetes", right: "Croquettes" },
          }),
        ],
      }),
    );
    expect(note(el, "s1")!.textContent).toContain(
      fill("suggestions.fix_language", {
        language: languageDisplayName("en", currentLocale()),
        wrong: "Croquetes",
        right: "Croquettes",
      }),
    );
    expect(field(el, "one", "en")!.value).toBe("Croquetes");
    expect(save(el).disabled).toBe(true);
  });
  it("shows stale notes without borrowing and keeps a stale save refusal field-specific", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [suggestion("s1", "one", { stale: true }), suggestion("s2", "two")],
      }),
    );
    expect(note(el, "s1")!.textContent).toContain(t("suggestions.stale"));
    expect(field(el, "one")!.value).toBe("");
    api.saveContentTranslations.mockRejectedValueOnce({
      code: "content.translation_stale",
      params: { kind: "product", id: "two", language: "es", field: "name" },
    });
    await click(el, "save");
    await vi.waitFor(() =>
      expect(field(el, "two")!.error).toBe(codeMessage("content.translation_stale")),
    );
    expect(field(el, "two")!.value).toBe("CLIENT-es two");
    expect(save(el).disabled).toBe(false);
  });
});

describe("rows outside the current page", () => {
  const oneLanguage = (overrides: Partial<Venue> = {}) =>
    venue({
      language: "ca",
      config: { defaultLanguage: "ca", languages: ["ca"] },
      omitted: [target("empty")],
      suggestions: [suggestion("s1", "empty", { language: "ca", text: "CLIENT-ca Croquetes" })],
      ...overrides,
    });
  it("retains a one-language off-page suggestion, reveals it through Show staged and saves it", async () => {
    const { el, api } = await open(oneLanguage());
    expect(api.getContentTranslationCells).toHaveBeenCalledExactlyOnceWith([
      { kind: "product", id: "empty", language: "ca", field: "name" },
    ]);
    expect(field(el, "empty")).toBeNull();
    expect(note(el, "s1")!.textContent).toContain(t("suggestions.suggested"));
    await click(el, "show-edited");
    expect(field(el, "empty")!.value).toBe("CLIENT-ca Croquetes");
    expect(q(el, "[data-test=complete]")).toBeNull();
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [submitted("empty", "CLIENT-ca Croquetes", "ca")],
    });
  });
  it("retains an off-page suggestion through live refresh", async () => {
    const liveData = new LiveData();
    const { el, api } = await open(oneLanguage(), { liveData });
    const reads = api.getContentTranslationTargets.mock.calls.length;
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() =>
      expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThan(reads),
    );
    await click(el, "show-edited");
    expect(field(el, "empty")!.value).toBe("CLIENT-ca Croquetes");
    expect(note(el, "s1")!.textContent).toContain(t("suggestions.suggested"));
  });
  it("does not stage gone, already named or stale off-page suggestions", async () => {
    const { el, api } = await open(
      oneLanguage({
        omitted: [
          target("gone", { eligible: false, unavailableReason: "missing" }),
          target("named", { text: "Pa", effectiveText: "Pa" }),
          target("old"),
        ],
        suggestions: [
          suggestion("s1", "gone", { language: "ca" }),
          suggestion("s2", "named", { language: "ca" }),
          suggestion("s3", "old", { language: "ca", stale: true }),
        ],
      }),
    );
    expect(api.getContentTranslationCells).toHaveBeenCalledExactlyOnceWith([
      { kind: "product", id: "gone", language: "ca", field: "name" },
      { kind: "product", id: "named", language: "ca", field: "name" },
    ]);
    expect(q(el, "[data-test=complete]")).not.toBeNull();
    expect(save(el).disabled).toBe(true);
    expect(q(el, "[data-test=edited-count]")!.textContent).toContain("0");
  });
  it("reads at most one hundred retained cells and reveals fifty distinct items at a time", async () => {
    const ids = Array.from({ length: 60 }, (_, n) => `e${String(n).padStart(2, "0")}`);
    const { el, api } = await open(
      oneLanguage({
        omitted: ids.map((id) => target(id)),
        suggestions: ids.map((id) =>
          suggestion(`s-${id}`, id, { language: "ca", text: `CLIENT-ca ${id}` }),
        ),
      }),
    );
    expect(api.getContentTranslationCells.mock.calls.map(([refs]) => refs.length)).toEqual([60]);
    expect(api.getContentTranslationTargets).toHaveBeenCalledTimes(1);
    await click(el, "show-edited");
    expect(field(el, "e00")!.value).toBe("CLIENT-ca e00");
    expect(field(el, "e50")).toBeNull();
    await click(el, "next");
    expect(field(el, "e50")!.value).toBe("CLIENT-ca e50");
    expect(field(el, "e59")!.value).toBe("CLIENT-ca e59");
    expect(field(el, "e00")).toBeNull();
  });
  it("shows off-page placeholder and internal-fix notes with Discard without loading item pages", async () => {
    setLocale("en-GB");
    const { el, api } = await open(
      oneLanguage({
        omitted: [target("empty"), target("typo")],
        suggestions: [
          suggestion("s1", "empty", { language: null, text: null, placeholder: true }),
          suggestion("s2", "typo", {
            language: null,
            text: null,
            fix: { field: "internal", wrong: "ZURRITO", right: "ZURITO" },
          }),
        ],
      }),
    );
    expect(note(el, "s1")!.textContent).toContain(t("suggestions.placeholder"));
    expect(note(el, "s2")!.textContent).toContain(
      fill("suggestions.fix_internal", { wrong: "ZURRITO", right: "ZURITO" }),
    );
    expect(field(el, "empty")).toBeNull();
    expect(field(el, "typo")).toBeNull();
    expect(api.getContentTranslationCells).not.toHaveBeenCalled();
    expect(save(el).disabled).toBe(true);
    await discard(el, "s1");
    await vi.waitFor(() => expect(note(el, "s1")).toBeNull());
    expect(api.discardContentSuggestion).toHaveBeenCalledWith("s1");
  });
  it("keeps named-item note metadata through live changes and reopening without reference reads", async () => {
    const liveData = new LiveData();
    const state = oneLanguage({
      listed: [target("one"), target("two")],
      omitted: [target("named", { text: "Pa", effectiveText: "Pa" })],
      suggestions: [
        suggestion("s1", "named", {
          language: null,
          text: null,
          fix: { field: "internal", wrong: "ZURRITO", right: "ZURITO" },
        }),
      ],
    });
    const { el, api } = await open(state, { liveData });
    expect(note(el, "s1")!.querySelector("a")!.getAttribute("href")).toBe(
      "/manage/catalogue/product/named",
    );
    for (const id of ["one", "two"]) {
      state.suggestions.push(
        suggestion(`s-${id}`, id, { language: "ca", text: `CLIENT-ca ${id}` }),
      );
      liveData.invalidate([{ type: "content_suggestions" }]);
      await vi.waitFor(() => expect(field(el, id)!.value).toBe(`CLIENT-ca ${id}`));
    }
    expect(
      api.getContentTranslationCells.mock.calls
        .flatMap(([refs]) => refs)
        .some((ref) => ref.id === "named"),
    ).toBe(false);
    await reopened(el);
    expect(field(el, "two")!.value).toBe("CLIENT-ca two");
    expect(note(el, "s1")!.querySelector("a")!.getAttribute("href")).toBe(
      "/manage/catalogue/product/named",
    );
    expect(
      api.getContentTranslationCells.mock.calls
        .flatMap(([refs]) => refs)
        .some((ref) => ref.id === "named"),
    ).toBe(false);
  });
  it("a read begun before Discard cannot restore an off-page draft", async () => {
    const liveData = new LiveData();
    const { el, api } = await open(oneLanguage({ listed: [target("one")] }), { liveData });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const read = api.getContentSuggestions.getMockImplementation()!;
    api.getContentSuggestions.mockImplementation(async (query: ContentSuggestionQuery = {}) => {
      const value = await read(query);
      await gate;
      return value;
    });
    const reads = api.getContentSuggestions.mock.calls.length;
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() =>
      expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads),
    );
    await discard(el, "s1");
    await delivered(api.discardContentSuggestion.mock.results[0]!.value, el);
    release();
    await delivered(api.getContentSuggestions.mock.results[reads]!.value, el);
    expect(note(el, "s1")).toBeNull();
    expect(save(el).disabled).toBe(true);
    expect(field(el, "one")).not.toBeNull();
    expect(q(el, "[data-test=edited-count]")!.textContent).toContain("0");
  });
  it("a language-fix note needs no automatic reference read on the default-language page", async () => {
    const { el, api } = await open(
      oneLanguage({
        config: { defaultLanguage: "ca", languages: ["ca", "es"] },
        listed: [target("one")],
        omitted: [target("named", { text: "Pa", effectiveText: "Pa" })],
        suggestions: [
          suggestion("s1", "named", {
            language: "es",
            text: null,
            fix: { field: "es", wrong: "Pann", right: "Pan" },
          }),
        ],
      }),
    );
    expect(field(el, "one")).not.toBeNull();
    expect(note(el, "s1")!.textContent).toContain("Pann");
    expect(api.getContentTranslationCells).not.toHaveBeenCalled();
    expect(api.getContentTranslationTargets).toHaveBeenCalledTimes(1);
  });
  it("notes need no reads and an off-page default-language suggestion stages only its empty field", async () => {
    const row = target("done");
    row.cells = row.cells.map((c) =>
      c.language === "es" ? { ...c, text: "Hecho", effectiveText: "Hecho" } : c,
    );
    const { el, api } = await open(
      venue({
        listed: [target("one")],
        omitted: [row],
        suggestions: [
          suggestion("s1", "one"),
          suggestion("s2", "done", {
            language: null,
            text: null,
            fix: { field: "internal", wrong: "ZURRITO", right: "ZURITO" },
          }),
          suggestion("s3", "done", { language: null, text: null, placeholder: true }),
          suggestion("s4", "done", { language: "en", text: "CLIENT-en done" }),
        ],
      }),
    );
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(api.getContentTranslationCells).toHaveBeenCalledExactlyOnceWith([
      { kind: "product", id: "done", language: "en", field: "name" },
    ]);
    await click(el, "show-edited");
    expect(field(el, "done", "en")!.value).toBe("CLIENT-en done");
    expect(field(el, "done", "es")!.value).toBe("Hecho");
  });
  it("stops applying off-page cell reads after close without starting another batch", async () => {
    const state = oneLanguage({ listed: [target("one")] });
    const base = fakeApi(state);
    const liveData = new LiveData();
    let held = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { el, api } = await open(state, {
      liveData,
      getContentTranslationCells: vi.fn(async (refs: readonly TranslationCellRef[]) => {
        const result = await base.getContentTranslationCells(refs);
        if (held) await gate;
        return result;
      }),
    });
    expect(api.getContentTranslationCells).toHaveBeenCalledTimes(1);
    held = true;
    const reads = api.getContentTranslationCells.mock.calls.length;
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() =>
      expect(api.getContentTranslationCells.mock.calls.length).toBeGreaterThan(reads),
    );
    el.open = false;
    await el.updateComplete;
    const count = api.getContentTranslationCells.mock.calls.length;
    release();
    await Promise.all(
      api.getContentTranslationCells.mock.results.slice(reads).map((result) => result.value),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await settle(el);
    expect(api.getContentTranslationCells).toHaveBeenCalledTimes(count);
    expect(el.open).toBe(false);
  });
});

describe("the 100-cell limit and continuing later", () => {
  const many = () => {
    const rows = Array.from({ length: 150 }, (_, n) => target(String(n).padStart(3, "0")));
    return venue({
      listed: rows,
      suggestions: rows.map((row) => suggestion(`s${row.id}`, row.id)),
    });
  };
  it("fills at most one hundred cells and saves that exact batch after explicit paging", async () => {
    const { el, api } = await open(many());
    expect(api.getContentSuggestions).toHaveBeenCalledTimes(1);
    await click(el, "next-suggestions");
    await vi.waitFor(() => expect(q(el, "[data-test=suggestion-capacity]")).not.toBeNull());
    expect(q(el, "[data-test=suggestion-capacity]")!.textContent!.trim()).toBe(
      fill("suggestions.capacity", { shown: "100" }),
    );
    await click(el, "next");
    await click(el, "next");
    expect(field(el, "100")!.value).toBe("");
    expect(field(el, "100")!.disabled).toBe(false);
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    const edits = api.saveContentTranslations.mock.calls[0]![0].edits;
    expect(edits).toHaveLength(100);
    expect(edits.at(-1)).toEqual(submitted("099", "CLIENT-es 099"));
    expect(edits.map((edit) => edit.id)).toEqual(
      Array.from({ length: 100 }, (_, n) => String(n).padStart(3, "0")),
    );
  });
  it("shows the general cell limit when all borrowed cells become personal", async () => {
    const { el } = await open(many());
    await click(el, "next-suggestions");
    for (let n = 0; n < 100; n++) {
      if (n === 50) await click(el, "next");
      await edit(el, String(n).padStart(3, "0"), `Mine ${n}`);
    }
    expect(q(el, "[data-test=suggestion-capacity]")).toBeNull();
    expect(
      [...el.shadowRoot!.querySelectorAll("[role=status]")].some(
        (node) => node.textContent!.trim() === t("translations.batch_full"),
      ),
    ).toBe(true);
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
    await ready(el);
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(field(el, "two")!.value).toBe("CLIENT-es two");
    expect(api.discardContentSuggestion).not.toHaveBeenCalled();
  });
  it("saving a batch closes and reopening fills the remaining saved-on-box suggestions", async () => {
    const { el } = await open(many());
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    el.open = true;
    await el.updateComplete;
    await ready(el);
    expect(field(el, "000")).toBeNull();
    expect(field(el, "100")!.value).toBe("CLIENT-es 100");
    expect(field(el, "149")!.value).toBe("CLIENT-es 149");
    expect(q(el, "[data-test=suggestion-capacity]")).toBeNull();
  });
});

it("rejects a continuation from another configuration while retaining previously borrowed cells", async () => {
  const state = venue({
    listed: [target("one"), target("two")],
    suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
    suggestionPage: 1,
  });
  const base = fakeApi(state);
  const { el, api } = await open(state, {
    getContentSuggestions: vi.fn(async (query: ContentSuggestionQuery = {}) => ({
      ...(await base.getContentSuggestions(query)),
      configuration: query.after === undefined ? "configuration-one" : "changed-config",
    })),
  });
  await click(el, "next-suggestions");
  await vi.waitFor(() => expect(bar(el).error).not.toBe(""));
  expect(api.getContentSuggestions).toHaveBeenLastCalledWith({
    after: "1",
    configuration: "configuration-one",
  });
  expect(field(el, "one")!.value).toBe("CLIENT-es one");
  expect(field(el, "two")!.value).toBe("");
});

describe.each(["light", "dark"] as const)("capacity status accessibility (%s)", (theme) => {
  it.each([390, 1280].flatMap((width) => ["en-GB", "es-ES"].map((locale) => ({ width, locale }))))(
    "keeps the full personal batch editable in $locale at $width px",
    async ({ width, locale }) => {
      await page.viewport(width, 800);
      expect(window.innerWidth).toBe(width);
      setLocale(locale);
      const rows = Array.from({ length: 50 }, (_, n) => target(String(n).padStart(3, "0")));
      const { el, host, api } = await open(venue({ listed: rows }), {}, theme);
      for (const row of rows)
        for (const language of ["en", "es"])
          await edit(el, row.id, `Personal ${language} ${row.id}`, language);
      const message = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[role=status]")].find(
        (node) =>
          node.textContent!.trim() ===
          (locale === "en-GB"
            ? "This batch has reached its 100-field limit."
            : "Este lote ha llegado al límite de 100 campos."),
      );
      expect(message).toBeDefined();
      expect(save(el).disabled).toBe(false);
      expect(api.saveContentTranslations).not.toHaveBeenCalled();
      const modal = q<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!;
      await modal.updateComplete;
      const native = modal.shadowRoot!.querySelector("dialog")!;
      const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
      expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      message!.scrollIntoView({ block: "center" });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const bounds = message!.getBoundingClientRect();
      const container = body.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(container.left);
      expect(bounds.right).toBeLessThanOrEqual(container.right);
      expect(bounds.height).toBeGreaterThan(0);
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: native,
        path: `__screenshots__/look/a682-capacity-${locale}-${theme}-${width}.png`,
      });
    },
  );
});
