import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import type {
  TranslationCell,
  TranslationCellRef,
  TranslationQuery,
} from "@waitron/catalogue/src/content-translation-types.js";
import type {
  ContentSuggestionView,
  ContentSuggestionQuery,
} from "@waitron/catalogue/src/content-suggestion-types.js";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./content-translations-dialog.js";
import type { ContentTranslationsDialog } from "./content-translations-dialog.js";

registerIcons(DASHBOARD_ICONS);
const originalViewport = { width: window.innerWidth, height: window.innerHeight };
const config = { defaultLanguage: "en", languages: ["en", "es", "fr"] };
const cell = (overrides: Partial<TranslationCell> = {}): TranslationCell => ({
  kind: "product",
  id: "one",
  language: "es",
  field: "name",
  owners: { kind: "product", parentId: null },
  text: "Croqeta",
  inheritedText: null,
  effectiveText: "Croqeta",
  defaultText: "Customer croquette",
  inheritedDefaultText: null,
  effectiveDefaultText: "Customer croquette",
  expected: "old-token",
  staffText: "STAFF croquette",
  eligible: true,
  unavailableReason: null,
  ...overrides,
});
const suggestion = (overrides: Partial<ContentSuggestionView> = {}): ContentSuggestionView => ({
  id: "s1",
  kind: "product",
  itemId: "one",
  language: "es",
  text: null,
  placeholder: false,
  stale: false,
  fix: { field: "es", wrong: "Croqeta", right: "Croqueta" },
  cell: { kind: "product", id: "one", language: "es", field: "name" },
  expected: "old-token",
  ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(
  initial = [suggestion()],
  overrides: Record<string, unknown> = {},
  theme?: "light" | "dark",
) {
  let views = initial;
  let current = cell();
  const read = (query: TranslationQuery) => ({
    config,
    required: [],
    configuration: "config-one",
    total: 1,
    next: null,
    rows: [
      {
        kind: "product" as const,
        id: "one",
        name: "STAFF croquette",
        owners: current.owners,
        cells: query.languages.map((language) =>
          language === "es"
            ? current
            : cell({ language, text: null, effectiveText: null, expected: `old-${language}` }),
        ),
      },
    ],
  });
  const api = {
    getContentTranslationTargets: vi.fn(async (query: TranslationQuery) => read(query)),
    getContentTranslationCells: vi.fn(async (refs: readonly TranslationCellRef[]) => ({
      config,
      required: [],
      configuration: "config-one",
      cells: refs.map((ref) => ({ ...current, ...ref })),
    })),
    getContentSuggestions: vi.fn(async (_query: ContentSuggestionQuery = {}) => ({
      config,
      required: [],
      configuration: _query.configuration ?? "config-one",
      waitingFixes: views.length,
      run: null,
      suggestions: views,
      next: null,
      service: "on" as const,
      cloudOrigin: null,
    })),
    discardContentSuggestion: vi.fn(async (id: string) => {
      views = views.filter((view) => view.id !== id);
      return { deleted: id };
    }),
    saveContentTranslations: vi.fn(
      async (batch: {
        edits: (TranslationCellRef & { expected: string; text: string | null })[];
      }) => ({
        saved: batch.edits.map((edit) => ({
          ...current,
          ...edit,
          effectiveText: edit.text,
          expected: "saved-token",
        })),
      }),
    ),
    ...overrides,
  };
  const mounted = await mountWidget<ContentTranslationsDialog>(
    "dashboard-content-translations-dialog",
    {
      api: api as unknown as DashboardApi,
      config,
      language: "en",
      open: true,
    },
    theme,
  );
  await vi.waitFor(() =>
    expect(mounted.el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull(),
  );
  await mounted.el.updateComplete;
  return {
    ...mounted,
    api,
    setCurrent(value: TranslationCell) {
      current = value;
    },
    setViews(value: ContentSuggestionView[]) {
      views = value;
    },
  };
}
const panel = (el: ContentTranslationsDialog, id = "s1") =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-suggestion]")].find(
    (node) => node.dataset.suggestion === id,
  );
const action = (el: ContentTranslationsDialog, id: string, name: string) =>
  panel(el, id)?.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${name}]`);
const button = (el: ContentTranslationsDialog, name: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${name}]`)!;
const field = (el: ContentTranslationsDialog) =>
  el
    .shadowRoot!.querySelector("dashboard-content-translation-window")!
    .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      '[name="translation-product-one-es-name"]',
    )!;
async function clickFix(el: ContentTranslationsDialog) {
  expect(action(el, "s1", "use-fix")).toBeTruthy();
  action(el, "s1", "use-fix")!.click();
  await el.updateComplete;
  await vi.waitFor(() => expect(action(el, "s1", "use-fix")?.loading).not.toBe(true));
  await el.updateComplete;
  await el.shadowRoot!.querySelector("dashboard-content-translation-window")!.updateComplete;
}
async function edit(el: ContentTranslationsDialog, value: string) {
  await vi.waitFor(() => expect(field(el)).toBeTruthy());
  await field(el).updateComplete;
  await userEvent.fill(field(el).shadowRoot!.querySelector("input")!, value);
  await el.updateComplete;
}
afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  await page.viewport(originalViewport.width, originalViewport.height);
});

describe("deliberate spelling fixes", () => {
  it("rechecks the exact Spanish cell and stages exactly the fresh correction without writing", async () => {
    const { el, api, setCurrent, setViews } = await mount();
    expect(field(el).value).toBe("Croqeta");
    setCurrent(cell({ expected: "fresh-token" }));
    setViews([suggestion({ expected: "fresh-token" })]);
    await clickFix(el);
    expect(api.getContentTranslationCells).toHaveBeenCalledExactlyOnceWith([
      { kind: "product", id: "one", language: "es", field: "name" },
    ]);
    expect(api.getContentSuggestions).toHaveBeenCalledTimes(2);
    expect(field(el).value).toBe("Croqueta");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    button(el, "save").click();
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "fresh-token",
          text: "Croqueta",
        },
      ],
    });
  });
  it.each(["text", "stale", "ownership", "inactive", "disabled", "deleted", "replacement"])(
    "keeps a %s correction unstaged",
    async (mode) => {
      const { el, api, setCurrent, setViews } = await mount();
      if (mode === "text")
        setCurrent(cell({ text: "Other", effectiveText: "Other", expected: "other" }));
      if (mode === "stale") setViews([suggestion({ stale: true })]);
      if (mode === "ownership")
        setCurrent(
          cell({ owners: { kind: "variant", parentId: "replacement" }, expected: "other-owner" }),
        );
      if (mode === "inactive") setCurrent(cell({ eligible: false, unavailableReason: "inactive" }));
      if (mode === "disabled")
        setCurrent(cell({ eligible: false, unavailableReason: "language_disabled" }));
      if (mode === "deleted") setViews([]);
      if (mode === "replacement") setViews([suggestion({ id: "s2" })]);
      await clickFix(el);
      expect(field(el).value).not.toBe("Croqueta");
      expect(panel(el)?.textContent).toContain(t("suggestions.stale"));
      expect(button(el, "save").disabled).toBe(true);
      expect(api.saveContentTranslations).not.toHaveBeenCalled();
    },
  );
  it.each(["My name", ""])(
    "keeps personal text %j entered while the fix read is held",
    async (value) => {
      const held = deferred<{
        config: typeof config;
        required: string[];
        configuration: string;
        cells: TranslationCell[];
      }>();
      const { el, api } = await mount(undefined, {
        getContentTranslationCells: vi.fn(() => held.promise),
      });
      expect(action(el, "s1", "use-fix")).toBeTruthy();
      action(el, "s1", "use-fix")!.click();
      await vi.waitFor(() => expect(api.getContentTranslationCells).toHaveBeenCalledOnce());
      await edit(el, value);
      held.resolve({ config, required: [], configuration: "config-one", cells: [cell()] });
      await held.promise;
      await vi.waitFor(() => expect(action(el, "s1", "use-fix")?.loading).toBe(false));
      expect(field(el).value).toBe(value);
      expect(api.saveContentTranslations).not.toHaveBeenCalled();
    },
  );
  it.each(["success", "failure"] as const)(
    "does not apply a %s fix answered after close and reopen",
    async (outcome) => {
      const held = deferred<{
        config: typeof config;
        required: string[];
        configuration: string;
        cells: TranslationCell[];
      }>();
      const { el, api } = await mount(undefined, {
        getContentTranslationCells: vi.fn(() => held.promise),
      });
      expect(action(el, "s1", "use-fix")).toBeTruthy();
      action(el, "s1", "use-fix")!.click();
      await vi.waitFor(() => expect(api.getContentTranslationCells).toHaveBeenCalledOnce());
      el.open = false;
      await el.updateComplete;
      el.open = true;
      await el.updateComplete;
      await vi.waitFor(() => expect(panel(el)).toBeTruthy());
      if (outcome === "success")
        held.resolve({ config, required: [], configuration: "config-one", cells: [cell()] });
      else held.reject({ code: "connection.failed" });
      await held.promise.catch(() => undefined);
      await vi.waitFor(() => expect(action(el, "s1", "use-fix")?.loading).toBe(false));
      expect(el.shadowRoot!.querySelector("dashboard-content-suggestions-bar")!.error).toBe("");
      expect(api.getContentSuggestions).toHaveBeenCalledTimes(2);
      expect(field(el).value).toBe("Croqeta");
      expect(api.saveContentTranslations).not.toHaveBeenCalled();
    },
  );
});

describe("suggestion notes and discard", () => {
  const borrowed = () => suggestion({ text: "Croqueta sugerida", fix: null });
  const empty = () => cell({ text: null, effectiveText: null });
  it("shows borrowed text, placeholder, internal fix and stale notes without turning them into staff edits", async () => {
    const { el, api } = await mount([
      suggestion({ id: "placeholder", placeholder: true, fix: null, cell: null, language: null }),
      suggestion({
        id: "internal",
        fix: { field: "internal", wrong: "STAFF croqeta", right: "STAFF croqueta" },
        cell: null,
        language: null,
      }),
      suggestion({ id: "stale", stale: true }),
    ]);
    expect(panel(el, "placeholder")?.textContent).toContain(t("suggestions.placeholder"));
    expect(panel(el, "internal")?.textContent).toContain("STAFF croqeta");
    expect(panel(el, "internal")?.querySelector("a")?.getAttribute("href")).toBe(
      "/manage/catalogue/product/one",
    );
    expect(action(el, "internal", "use-fix")).toBeNull();
    expect(panel(el, "stale")?.textContent).toContain(t("suggestions.stale"));
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "deletes only the borrowed value, keeping personal input=%s",
    async (personal) => {
      const { el, api } = await mount([borrowed()], {
        getContentTranslationTargets: vi.fn(async () => ({
          config,
          required: [],
          configuration: "config-one",
          next: null,
          total: 1,
          rows: [
            {
              kind: "product",
              id: "one",
              name: "STAFF croquette",
              owners: empty().owners,
              cells: [empty()],
            },
          ],
        })),
      });
      expect(field(el).value).toBe("Croqueta sugerida");
      expect(panel(el)?.textContent).toContain(t("suggestions.suggested"));
      if (personal) await edit(el, "Mine");
      expect(action(el, "s1", "discard-suggestion")).toBeTruthy();
      action(el, "s1", "discard-suggestion")!.click();
      await vi.waitFor(() => expect(panel(el)).toBeUndefined());
      await el.shadowRoot!.querySelector("dashboard-content-translation-window")!.updateComplete;
      expect(api.discardContentSuggestion).toHaveBeenCalledExactlyOnceWith("s1");
      expect(field(el).value).toBe(personal ? "Mine" : "");
      expect(button(el, "save").disabled).toBe(!personal);
    },
  );
  it("keeps Save waiting across reopen, then suppresses a deleted id even if an older read returns it", async () => {
    const held = deferred<{ deleted: string }>();
    const { el, api } = await mount([borrowed()], {
      discardContentSuggestion: vi.fn(() => held.promise),
      getContentTranslationTargets: vi.fn(async () => ({
        config,
        required: [],
        configuration: "config-one",
        next: null,
        total: 1,
        rows: [
          {
            kind: "product",
            id: "one",
            name: "STAFF croquette",
            owners: empty().owners,
            cells: [empty()],
          },
        ],
      })),
    });
    expect(action(el, "s1", "discard-suggestion")).toBeTruthy();
    action(el, "s1", "discard-suggestion")!.click();
    await vi.waitFor(() => expect(api.discardContentSuggestion).toHaveBeenCalledOnce());
    expect(button(el, "save").disabled).toBe(true);
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() => expect(panel(el)).toBeTruthy());
    expect(button(el, "save").disabled).toBe(true);
    held.resolve({ deleted: "s1" });
    await held.promise;
    await vi.waitFor(() => expect(panel(el)).toBeUndefined());
    await el.shadowRoot!.querySelector("dashboard-content-translation-window")!.updateComplete;
    expect(field(el).value).toBe("");
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() => expect(field(el)).toBeTruthy());
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull());
    expect(panel(el)).toBeUndefined();
    expect(field(el).value).toBe("");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
  });
});

it("discovers waiting fixes on complete rows by explicitly switching Missing in to All names", async () => {
  await page.viewport(390, 700);
  expect(window.innerWidth).toBe(390);
  const { el, api } = await mount();
  const bar = el.shadowRoot!.querySelector("dashboard-content-suggestions-bar")!;
  await bar.updateComplete;
  const review = bar.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=review-fixes]",
  );
  expect(review).toBeTruthy();
  review!.click();
  await vi.waitFor(() =>
    expect(api.getContentTranslationTargets).toHaveBeenCalledWith({
      languages: ["en", "es"],
      missing: { mode: "all" },
      waitingFixes: true,
    }),
  );
  await vi.waitFor(() =>
    expect(api.getContentSuggestions).toHaveBeenCalledWith({ fixesOnly: true }),
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>('[name="missing"]')!.value,
  ).toBe("all");
  expect(el.shadowRoot!.querySelector("[data-test=fixes-filter-notice]")?.textContent).toContain(
    t("suggestions.fixes_filter"),
  );
  expect(field(el).value).toBe("Croqeta");
  expect(api.saveContentTranslations).not.toHaveBeenCalled();
  el.shadowRoot!.querySelector('[name="missing"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "all" }, bubbles: true, composed: true }),
  );
  await vi.waitFor(() =>
    expect(api.getContentTranslationTargets).toHaveBeenLastCalledWith({
      languages: ["en", "es"],
      missing: { mode: "all" },
    }),
  );
  await vi.waitFor(() => expect(api.getContentSuggestions).toHaveBeenLastCalledWith({}));
  expect(el.shadowRoot!.querySelector("[data-test=fixes-filter-notice]")).toBeNull();
});

it("uses passive reads for Use fix and the active client only for saving and discard", async () => {
  const first = await mount();
  const passive = {
    getContentTranslationTargets: first.api.getContentTranslationTargets,
    getContentTranslationCells: first.api.getContentTranslationCells,
    getContentSuggestions: first.api.getContentSuggestions,
  };
  cleanupWidgets();
  const { el, api } = await mount(undefined, { background: passive });
  await clickFix(el);
  expect(api.getContentTranslationTargets).not.toHaveBeenCalled();
  expect(api.getContentTranslationCells).not.toHaveBeenCalled();
  expect(api.getContentSuggestions).not.toHaveBeenCalled();
  expect(field(el).value).toBe("Croqueta");
  action(el, "s1", "discard-suggestion")!.click();
  await vi.waitFor(() =>
    expect(api.discardContentSuggestion).toHaveBeenCalledExactlyOnceWith("s1"),
  );
  expect(field(el).value).toBe("Croqueta");
  button(el, "save").click();
  await vi.waitFor(() => expect(api.saveContentTranslations).toHaveBeenCalledOnce());
});

it("does not drop borrowed text when discard fails and shows the action refusal until another action", async () => {
  const { el, api } = await mount([suggestion({ fix: null, text: "Suggested" })], {
    getContentTranslationTargets: vi.fn(async () => ({
      config,
      required: [],
      configuration: "config-one",
      next: null,
      total: 1,
      rows: [
        {
          kind: "product",
          id: "one",
          name: "STAFF croquette",
          owners: cell().owners,
          cells: [cell({ text: null, effectiveText: null })],
        },
      ],
    })),
    discardContentSuggestion: vi.fn(async () => {
      throw { code: "connection.failed" };
    }),
  });
  action(el, "s1", "discard-suggestion")!.click();
  await vi.waitFor(() => expect(action(el, "s1", "discard-suggestion")?.loading).toBe(false));
  await el.updateComplete;
  expect(panel(el)).toBeTruthy();
  expect(field(el).value).toBe("Suggested");
  const bar = el.shadowRoot!.querySelector("dashboard-content-suggestions-bar")!;
  expect(bar.error).not.toBe("");
  expect(button(el, "save").disabled).toBe(false);
  expect(api.discardContentSuggestion).toHaveBeenCalledOnce();
});

it("stages a still-fresh fix with the latest token after an unrelated language is enabled", async () => {
  let changed = false;
  const settings = () =>
    changed ? { defaultLanguage: "en", languages: ["en", "es", "fr", "it"] } : config;
  const configuration = () => (changed ? "config-two" : "config-one");
  const current = () => cell({ expected: changed ? "latest-config-token" : "old-token" });
  const { el, api } = await mount(undefined, {
    getContentTranslationTargets: vi.fn(async () => ({
      config: settings(),
      required: [],
      configuration: configuration(),
      total: 1,
      next: null,
      rows: [
        {
          kind: "product",
          id: "one",
          name: "STAFF croquette",
          owners: cell().owners,
          cells: [current()],
        },
      ],
    })),
    getContentTranslationCells: vi.fn(async () => ({
      config: settings(),
      required: [],
      configuration: configuration(),
      cells: [current()],
    })),
    getContentSuggestions: vi.fn(async () => ({
      config: settings(),
      required: [],
      configuration: configuration(),
      waitingFixes: 1,
      run: null,
      next: null,
      service: "on",
      cloudOrigin: null,
      suggestions: [suggestion({ expected: current().expected })],
    })),
  });
  changed = true;
  await clickFix(el);
  await vi.waitFor(() => expect(field(el).value).toBe("Croqueta"));
  button(el, "save").click();
  await vi.waitFor(() =>
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "latest-config-token",
          text: "Croqueta",
        },
      ],
    }),
  );
});

it("stages an inherited spelling fix only on its inclusion", async () => {
  const included = cell({
    kind: "included_menu",
    id: "membership",
    text: null,
    inheritedText: "Croqeta",
    owners: {
      kind: "included_menu",
      menuId: "parent-menu",
      sectionId: "section",
      includedMenuId: "child-menu",
      includedRootId: "child-root",
    },
  });
  const view = suggestion({
    kind: "included_menu",
    itemId: "membership",
    cell: { kind: "included_menu", id: "membership", language: "es", field: "name" },
  });
  const { el, api } = await mount([view], {
    getContentTranslationTargets: vi.fn(async () => ({
      config,
      required: [],
      configuration: "config-one",
      total: 1,
      next: null,
      rows: [
        {
          kind: "included_menu",
          id: "membership",
          name: "STAFF folder",
          parent: { id: "parent-menu", name: "Parent menu" },
          owners: included.owners,
          cells: [included],
        },
      ],
    })),
    getContentTranslationCells: vi.fn(async () => ({
      config,
      required: [],
      configuration: "config-one",
      cells: [included],
    })),
  });
  await clickFix(el);
  const input = el
    .shadowRoot!.querySelector("dashboard-content-translation-window")!
    .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      '[name="translation-included_menu-membership-es-name"]',
    )!;
  expect(input.value).toBe("Croqueta");
  expect(api.saveContentTranslations).not.toHaveBeenCalled();
  button(el, "save").click();
  await vi.waitFor(() =>
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "included_menu",
          id: "membership",
          language: "es",
          field: "name",
          expected: "old-token",
          text: "Croqueta",
        },
      ],
    }),
  );
});

for (const locale of ["en-GB", "es-ES"] as const) {
  for (const theme of ["light", "dark"] as const) {
    it.each([390, 1280])(
      `suggestion actions remain accessible in ${locale}/${theme} at %s px`,
      async (width) => {
        await page.viewport(width, 900);
        setLocale(locale);
        const { el, host } = await mount(
          [
            suggestion({
              fix: { field: "es", wrong: "Croqeta", right: `Croqueta${"x".repeat(160)}` },
            }),
          ],
          {},
          theme,
        );
        expect(window.innerWidth).toBe(width);
        expect(host.getAttribute("data-theme")).toBe(theme);
        const modal = el.shadowRoot!.querySelector("wt-modal")!;
        await modal.updateComplete;
        const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
        const notes = panel(el)!;
        expect(notes.textContent).toContain("Croqeta");
        expect(notes.scrollWidth).toBeLessThanOrEqual(notes.clientWidth + 1);
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
        notes.scrollIntoView({ block: "center" });
        for (const control of notes.querySelectorAll("wt-button")) {
          await control.updateComplete;
          expect(control.getBoundingClientRect().width).toBeGreaterThan(0);
          expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        }
        await expectNoA11yViolations(host);
        await page.screenshot({
          element: notes,
          path: `__screenshots__/look/a682-fixes-${locale}-${theme}-${width}.png`,
        });
        const fix = action(el, "s1", "use-fix")!;
        await fix.updateComplete;
        await userEvent.click(fix.shadowRoot!.querySelector("button")!);
        await vi.waitFor(() => expect(field(el).value).toBe(`Croqueta${"x".repeat(160)}`));
        await expectNoA11yViolations(host);
        expect(button(el, "save").disabled).toBe(false);
      },
    );
  }
}

it("opens a suggestion's product in the existing editor event while retaining modified browser links", async () => {
  const { el } = await mount([
    suggestion({
      fix: { field: "internal", wrong: "Croqeta", right: "Croqueta" },
      cell: null,
      language: null,
    }),
  ]);
  const opened = vi.fn();
  el.addEventListener("wt-edit-product", opened);
  const link = panel(el)!.querySelector("a")!;
  const handled: boolean[] = [];
  el.addEventListener("click", (event) => {
    handled.push(event.defaultPrevented);
    event.preventDefault();
  });
  const click = new MouseEvent("click", {
    button: 0,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  link.dispatchEvent(click);
  await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
  expect(opened.mock.calls[0]![0].detail).toEqual({ productId: "one" });
  expect(handled).toEqual([true]);
  const modified = new MouseEvent("click", {
    button: 0,
    ctrlKey: true,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  link.dispatchEvent(modified);
  await el.updateComplete;
  expect(opened).toHaveBeenCalledOnce();
  expect(handled).toEqual([true, false]);
});

it("leaves a fix waiting when 100 personal fields already fill the batch", async () => {
  const { el, api } = await mount(undefined, {
    getContentTranslationTargets: vi.fn(async (query: TranslationQuery) => ({
      config,
      required: [],
      configuration: "config-one",
      total: 50,
      next: null,
      rows: Array.from({ length: 50 }, (_, n) => ({
        kind: "product",
        id: `personal-${n}`,
        name: `STAFF ${n}`,
        owners: cell().owners,
        cells: query.languages.map((language) =>
          cell({ id: `personal-${n}`, language, text: null, effectiveText: null }),
        ),
      })),
    })),
  });
  const view = el.shadowRoot!.querySelector("dashboard-content-translation-window")!;
  await view.updateComplete;
  const fields = [...view.shadowRoot!.querySelectorAll("wt-input")];
  expect(fields).toHaveLength(100);
  for (const field of fields)
    field.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Mine" }, bubbles: true, composed: true }),
    );
  await el.updateComplete;
  await clickFix(el);
  expect(el.shadowRoot!.querySelector("dashboard-content-suggestions-bar")!.error).toBe(
    t("suggestions.fix_capacity"),
  );
  expect(el.shadowRoot!.querySelector("[data-test=edited-count]")!.textContent).toContain("100");
  button(el, "save").click();
  await vi.waitFor(() => expect(api.saveContentTranslations).toHaveBeenCalledOnce());
  const submitted = api.saveContentTranslations.mock.calls[0]![0].edits;
  expect(submitted).toHaveLength(100);
  expect(submitted.every((edit) => edit.id.startsWith("personal-") && edit.text === "Mine")).toBe(
    true,
  );
});

it("shows an existing personal edit as out of date for Use fix without replacing it", async () => {
  const { el, api } = await mount();
  await edit(el, "My croquette");
  expect(panel(el)?.textContent).toContain(t("suggestions.stale"));
  expect(action(el, "s1", "use-fix")?.disabled).toBe(true);
  expect(field(el).value).toBe("My croquette");
  expect(api.getContentTranslationCells).not.toHaveBeenCalled();
  expect(api.saveContentTranslations).not.toHaveBeenCalled();
});

it("rechecks the displayed suggestion page without returning to the first page", async () => {
  const { el, api } = await mount(undefined, {
    getContentSuggestions: vi.fn(async (query: ContentSuggestionQuery = {}) => ({
      config,
      required: [],
      configuration: "config-one",
      waitingFixes: 1,
      run: null,
      service: "on",
      cloudOrigin: null,
      next: query.after ? null : "page-two",
      suggestions: query.after
        ? [suggestion()]
        : [suggestion({ id: "first-note", placeholder: true, fix: null, cell: null })],
    })),
  });
  expect(panel(el)).toBeUndefined();
  button(el, "next-suggestions").click();
  await vi.waitFor(() => expect(action(el, "s1", "use-fix")).toBeTruthy());
  await clickFix(el);
  expect(api.getContentSuggestions).toHaveBeenLastCalledWith({
    after: "page-two",
    configuration: "config-one",
  });
  expect(api.getContentSuggestions).toHaveBeenCalledTimes(3);
  expect(field(el).value).toBe("Croqueta");
  expect(api.saveContentTranslations).not.toHaveBeenCalled();
});
