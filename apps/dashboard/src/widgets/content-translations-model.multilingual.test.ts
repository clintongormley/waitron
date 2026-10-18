import { describe, expect, it } from "vitest";
import type { ContentLanguages } from "@waitron/shared";
import {
  translationCellKey,
  type TranslationCell,
  type TranslationCellPage,
  type TranslationCellRef,
} from "@waitron/catalogue/src/content-translation-types.js";
import type { ContentSuggestionView } from "@waitron/catalogue/src/content-suggestion-types.js";
import { TranslationDrafts } from "./content-translations-model.js";

const config: ContentLanguages = { defaultLanguage: "en", languages: ["en", "es", "fr"] };
const cell = (overrides: Partial<TranslationCell> = {}): TranslationCell => ({
  kind: "product",
  id: "one",
  language: "es",
  field: "name",
  owners: { kind: "product", parentId: null },
  text: null,
  inheritedText: null,
  effectiveText: null,
  defaultText: "Customer croquette",
  inheritedDefaultText: null,
  effectiveDefaultText: "Customer croquette",
  expected: "original",
  staffText: "STAFF croquette",
  eligible: true,
  unavailableReason: null,
  ...overrides,
});
const page = (cells: TranslationCell[], settings = config): TranslationCellPage => ({
  config: settings,
  required: [],
  configuration: JSON.stringify(settings),
  cells,
});
const suggestion = (
  target: TranslationCell,
  overrides: Partial<ContentSuggestionView> = {},
): ContentSuggestionView => ({
  id: `suggestion-${target.id}-${target.language}-${target.field}`,
  kind: target.kind,
  itemId: target.id,
  language: target.language,
  text: "Croqueta sugerida",
  placeholder: false,
  fix: null,
  stale: false,
  cell: { kind: target.kind, id: target.id, language: target.language, field: target.field },
  expected: target.expected,
  ...overrides,
});
const ref = (target: TranslationCellRef): TranslationCellRef => ({
  kind: target.kind,
  id: target.id,
  language: target.language,
  field: target.field,
});
const changedCells = (count: number): TranslationCell[] =>
  Array.from({ length: count }, (_, n) => cell({ id: String(n) }));

describe("multilingual translation drafts", () => {
  it("keeps separate item, kind, language and unit-field values through page changes", () => {
    const one = cell();
    const french = cell({ language: "fr" });
    const unit = cell({ kind: "unit", owners: { kind: "unit" } });
    const abbreviation = cell({ ...unit, field: "abbreviation", staffText: "kg" });
    const drafts = new TranslationDrafts(config, [one, french, unit, abbreviation]);
    drafts.edit(one, "  Croqueta  ");
    drafts.edit(french, "Croquette");
    drafts.edit(unit, "Kilogramo");
    drafts.edit(abbreviation, "kg");
    drafts.receive(page([cell({ id: "other" })]));
    expect(drafts.value(one)).toBe("  Croqueta  ");
    expect(drafts.value(french)).toBe("Croquette");
    expect(drafts.value(abbreviation)).toBe("kg");
    expect(drafts.staged()).toEqual([ref(one), ref(french), ref(unit), ref(abbreviation)]);
    expect(drafts.submission()).toEqual({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "original",
          text: "Croqueta",
        },
        {
          kind: "product",
          id: "one",
          language: "fr",
          field: "name",
          expected: "original",
          text: "Croquette",
        },
        {
          kind: "unit",
          id: "one",
          language: "es",
          field: "name",
          expected: "original",
          text: "Kilogramo",
        },
        {
          kind: "unit",
          id: "one",
          language: "es",
          field: "abbreviation",
          expected: "original",
          text: "kg",
        },
      ],
    });
  });
  it("submits an intentional clear as null and retains it across refresh and suggestions", () => {
    const one = cell({ text: "Croqueta", effectiveText: "Croqueta" });
    const drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, " \n ");
    drafts.receive(page([one]));
    drafts.suggest([suggestion(one)]);
    expect(drafts.value(one)).toBe(" \n ");
    expect(drafts.origin(one)).toBe("personal");
    expect(drafts.personalSubmission()).toEqual({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "original",
          text: null,
        },
      ],
    });
    expect(drafts.validate()).toEqual([]);
  });
  it("removes only an inclusion override when clearing inherited text", () => {
    const one = cell({
      kind: "included_menu",
      owners: {
        kind: "included_menu",
        menuId: "parent",
        sectionId: "section",
        includedMenuId: "child",
        includedRootId: "root",
      },
      text: "Override",
      inheritedText: "Root",
      effectiveText: "Override",
    });
    const drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "");
    expect(drafts.submission().edits).toEqual([
      {
        kind: "included_menu",
        id: "one",
        language: "es",
        field: "name",
        expected: "original",
        text: null,
      },
    ]);
    expect(drafts.validate()).toEqual([]);
  });
  it("keeps a no-op blank as autofill suppression without a leave prompt", () => {
    const one = cell();
    const drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "");
    drafts.receive(page([]));
    drafts.receive(page([one]));
    drafts.suggest([suggestion(one)]);
    expect(drafts.value(one)).toBe("");
    expect(drafts.origin(one)).toBe("personal");
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
    expect(drafts.staged()).toEqual([]);
    expect(drafts.validate()).toEqual([]);
    drafts.unstage(one);
    drafts.suggest([suggestion(one)]);
    expect(drafts.value(one)).toBe("Croqueta sugerida");
  });
  it("fills only eligible empty saved and empty personal cells in their exact languages", () => {
    const empty = cell(),
      named = cell({ id: "named", text: "Saved", effectiveText: "Saved" });
    const inherited = cell({
      id: "inherited",
      inheritedText: "Inherited",
      effectiveText: "Inherited",
    });
    const personal = cell({ id: "personal" }),
      off = cell({ id: "off", eligible: false, unavailableReason: "inactive" });
    const french = cell({ language: "fr" });
    const drafts = new TranslationDrafts(config, [empty, named, inherited, personal, off, french]);
    drafts.edit(personal, "My words");
    drafts.suggest(
      [empty, named, inherited, personal, off, french].map((target) => suggestion(target)),
    );
    expect(drafts.value(empty)).toBe("Croqueta sugerida");
    expect(drafts.value(french)).toBe("Croqueta sugerida");
    expect(drafts.value(named)).toBe("Saved");
    expect(drafts.value(inherited)).toBe("");
    expect(drafts.value(personal)).toBe("My words");
    expect(drafts.value(off)).toBe("");
    expect(drafts.suggestedCount).toBe(2);
    expect(drafts.personalSubmission().edits.map((edit) => edit.text)).toEqual(["My words"]);
  });
  it("suggestions alone never become personal edits and touching one takes ownership", () => {
    const one = cell();
    const drafts = new TranslationDrafts(config, [one]);
    drafts.suggest([suggestion(one)]);
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
    expect(drafts.origin(one)).toBe("suggested");
    drafts.edit(one, "Other");
    drafts.edit(one, "Croqueta sugerida");
    drafts.suggest([suggestion(one, { text: "New arrival" })]);
    expect(drafts.value(one)).toBe("Croqueta sugerida");
    expect(drafts.origin(one)).toBe("personal");
    expect(drafts.suggestedCount).toBe(0);
    expect(drafts.personalSubmission().edits[0]?.text).toBe("Croqueta sugerida");
    drafts.discardSuggestion(suggestion(one).id);
    expect(drafts.value(one)).toBe("Croqueta sugerida");
  });
  it.each([
    { label: "stale", overrides: { stale: true } },
    { label: "placeholder", overrides: { placeholder: true, text: null } },
    { label: "missing evidence", overrides: { expected: null } },
    { label: "another token", overrides: { expected: "outdated" } },
    {
      label: "internal note",
      overrides: {
        cell: null,
        language: null,
        text: null,
        fix: { field: "internal", wrong: "a", right: "b" },
      },
    },
    { label: "wrong item", overrides: { itemId: "other" } },
  ])("leaves $label suggestions waiting", ({ overrides }) => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.suggest([suggestion(one, overrides)]);
    expect(drafts.submission()).toEqual({ edits: [] });
    expect(drafts.value(one)).toBe("");
  });
  it("removes a discarded untouched suggestion without deleting personal work", () => {
    const one = cell(),
      two = cell({ id: "two" });
    const drafts = new TranslationDrafts(config, [one, two]);
    const first = suggestion(one);
    drafts.suggest([first, suggestion(two)]);
    drafts.edit(two, "Personal");
    drafts.discardSuggestion(first.id);
    drafts.suggest([first, suggestion(two)]);
    expect(drafts.value(one)).toBe("");
    expect(drafts.value(two)).toBe("Personal");
    expect(drafts.suggestedCount).toBe(0);
  });
  it("retains the 101st personal input visibly and blocks Save until an explicit unstage", () => {
    const cells = changedCells(101),
      drafts = new TranslationDrafts(config, cells);
    for (const one of cells) drafts.edit(one, "Manual");
    expect(drafts.staged()).toHaveLength(101);
    expect(drafts.value(cells[100]!)).toBe("Manual");
    expect(drafts.validate()).toContainEqual({ cell: ref(cells[100]!), message: "capacity" });
    expect(drafts.submission().edits).toHaveLength(101);
    drafts.receive(page([cells[100]!]));
    expect(drafts.value(cells[0]!)).toBe("Manual");
    expect(drafts.validate()).toHaveLength(1);
    drafts.unstage(cells[9]!);
    expect(drafts.staged()).toHaveLength(100);
    expect(drafts.value(cells[100]!)).toBe("Manual");
    expect(drafts.validate()).toEqual([]);
  });
  it("frees untouched suggestions before admitting personal input and leaves overflow waiting", () => {
    const cells = changedCells(102),
      drafts = new TranslationDrafts(config, cells);
    drafts.suggest(cells.map((one) => suggestion(one)));
    expect(drafts.suggestedCount).toBe(100);
    expect(drafts.value(cells[100]!)).toBe("");
    drafts.edit(cells[100]!, "Personal");
    expect(drafts.staged()).toHaveLength(100);
    expect(drafts.suggestedCount).toBe(99);
    expect(drafts.value(cells[100]!)).toBe("Personal");
    drafts.receive(page([cells[101]!]));
    expect(drafts.staged()).toHaveLength(100);
    expect(drafts.value(cells[100]!)).toBe("Personal");
    expect(drafts.validate()).toEqual([]);
  });
  it("counts a unit name and abbreviation as separate Save cells", () => {
    const rows = changedCells(99),
      name = cell({ kind: "unit", owners: { kind: "unit" } });
    const abbreviation = cell({ ...name, field: "abbreviation" });
    const drafts = new TranslationDrafts(config, [...rows, name, abbreviation]);
    for (const one of [...rows, name, abbreviation]) drafts.edit(one, "Value");
    expect(drafts.submission().edits).toHaveLength(101);
    expect(drafts.validate()).toEqual([{ cell: ref(abbreviation), message: "capacity" }]);
  });
  it("measures field and actual request bytes in UTF-8 including baseline JSON", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "é".repeat(2048));
    expect(drafts.validate()).toEqual([]);
    drafts.edit(one, "é".repeat(2049));
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "name_bytes" }]);
    const huge = cell({ expected: "é".repeat(131022) }),
      large = new TranslationDrafts(config, [huge]);
    large.edit(huge, "Valid");
    expect(new TextEncoder().encode(JSON.stringify(large.submission())).length).toBeGreaterThan(
      262144,
    );
    expect(large.validate()).toEqual([{ cell: ref(huge), message: "batch_bytes" }]);
  });
  it("refreshes untouched fields without adopting a changed baseline for personal input", () => {
    const one = cell(),
      clean = cell({ id: "clean" });
    const drafts = new TranslationDrafts(config, [one, clean]);
    drafts.edit(one, "My draft");
    const next = cell({
      text: "Another person's words",
      effectiveText: "Another person's words",
      expected: "next",
    });
    const nextClean = cell({
      id: "clean",
      text: "Fresh",
      effectiveText: "Fresh",
      expected: "fresh",
    });
    drafts.receive(page([next, nextClean]));
    expect(drafts.value(one)).toBe("My draft");
    expect(drafts.current(one)).toEqual(next);
    expect(drafts.value(clean)).toBe("Fresh");
    expect(drafts.changed(one)).toBe(true);
    expect(drafts.submission().edits[0]?.expected).toBe("original");
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "review" }]);
  });
  it("requires review when the default changes even if this page omits the edited cell", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Mine");
    drafts.receive(page([], { defaultLanguage: "fr", languages: ["fr", "es", "en"] }));
    expect(drafts.changed(one)).toBe(true);
    expect(drafts.value(one)).toBe("Mine");
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "review" }]);
    const latest = cell({
      expected: "new-default",
      defaultText: "French",
      effectiveDefaultText: "French",
    });
    drafts.review([latest], new Map([[translationCellKey(one), "keep"]]));
    expect(drafts.submission().edits[0]).toMatchObject({ expected: "new-default", text: "Mine" });
    expect(drafts.validate()).toEqual([]);
  });
  it.each([
    {
      label: "missing",
      next: cell({ eligible: false, owners: null, unavailableReason: "missing", expected: "gone" }),
    },
    {
      label: "disabled",
      next: cell({ eligible: false, unavailableReason: "language_disabled", expected: "disabled" }),
    },
    {
      label: "inactive",
      next: cell({ eligible: false, unavailableReason: "inactive", expected: "inactive" }),
    },
  ])("cannot Keep an unavailable $label cell", ({ next }) => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Mine");
    drafts.receive(page([next]));
    drafts.review([next], new Map([[translationCellKey(one), "keep"]]));
    expect(drafts.value(one)).toBe("Mine");
    expect(drafts.submission().edits[0]?.expected).toBe("original");
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "review" }]);
  });
  it("never accepts replacement ownership, even when the replacement is eligible", () => {
    const one = cell({ kind: "option_label", owners: { kind: "option_label", listId: "old" } });
    const next = cell({
      ...one,
      owners: { kind: "option_label", listId: "new" },
      expected: "new-owner",
    });
    const drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Mine");
    drafts.receive(page([next]));
    drafts.review([next], new Map([[translationCellKey(one), "keep"]]));
    expect(drafts.submission().edits[0]?.expected).toBe("original");
    expect(drafts.value(one)).toBe("Mine");
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "review" }]);
  });
  it("Replace adopts saved text and Discard releases explicit blank suppression", () => {
    const one = cell(),
      two = cell({ id: "two" });
    const drafts = new TranslationDrafts(config, [one, two]);
    drafts.edit(one, "Mine");
    drafts.edit(two, "");
    const next = cell({ text: "Saved", effectiveText: "Saved", expected: "next" });
    drafts.receive(page([next, two]));
    drafts.review(
      [next, two],
      new Map([
        [translationCellKey(one), "replace"],
        [translationCellKey(two), "discard"],
      ]),
    );
    expect(drafts.value(one)).toBe("Saved");
    expect(drafts.origin(one)).toBeNull();
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
    drafts.suggest([suggestion(two)]);
    expect(drafts.value(two)).toBe("Croqueta sugerida");
  });
  it("Use fix stages exactly right on the inclusion with its latest Save token", () => {
    const one = cell({
      kind: "included_menu",
      owners: {
        kind: "included_menu",
        menuId: "menu",
        sectionId: "folder",
        includedMenuId: "child",
        includedRootId: "root",
      },
      inheritedText: "Croqeta",
      effectiveText: "Croqeta",
      expected: "current-token",
    });
    const drafts = new TranslationDrafts(config, [one]);
    const fix = suggestion(one, {
      text: null,
      fix: { field: "es", wrong: "Croqeta", right: "Croqueta" },
    });
    expect(drafts.useFix(fix, one)).toBe("staged");
    drafts.suggest([suggestion(one, { text: "Later translation" })]);
    expect(drafts.origin(one)).toBe("fix");
    expect(drafts.personalSubmission()).toEqual({
      edits: [
        {
          kind: "included_menu",
          id: "one",
          language: "es",
          field: "name",
          expected: "current-token",
          text: "Croqueta",
        },
      ],
    });
  });
  it.each(["personal", "blank", "stale", "changed", "no-evidence", "wrong-field", "internal"])(
    "leaves a %s fix unstaged",
    (mode) => {
      const one = cell({ text: "Wrong", effectiveText: "Wrong" }),
        drafts = new TranslationDrafts(config, [one]);
      const fix = suggestion(one, {
        text: null,
        fix: { field: "es", wrong: "Wrong", right: "Right" },
        ...(mode === "stale" ? { stale: true } : mode === "no-evidence" ? { expected: null } : {}),
      });
      if (mode === "personal") drafts.edit(one, "Mine");
      if (mode === "blank") drafts.edit(one, "");
      if (mode === "wrong-field") fix.fix!.field = "fr";
      if (mode === "internal") {
        fix.fix!.field = "internal";
        fix.cell = null;
      }
      const latest =
        mode === "changed"
          ? cell({ ...one, text: "Changed", effectiveText: "Changed", expected: "next" })
          : one;
      expect(drafts.useFix(fix, latest)).toBe("stale");
      expect(drafts.value(one)).toBe(
        mode === "personal" ? "Mine" : mode === "blank" ? "" : "Wrong",
      );
      expect(drafts.origin(one)).not.toBe("fix");
    },
  );
  it("Use fix returns full without losing the 100 selected personal cells", () => {
    const rows = changedCells(100),
      one = cell({ id: "fix", text: "Wrong", effectiveText: "Wrong" });
    const drafts = new TranslationDrafts(config, [...rows, one]);
    for (const row of rows) drafts.edit(row, "Mine");
    expect(
      drafts.useFix(
        suggestion(one, { text: null, fix: { field: "es", wrong: "Wrong", right: "Right" } }),
        one,
      ),
    ).toBe("full");
    expect(drafts.personalSubmission().edits).toHaveLength(100);
    expect(drafts.value(one)).toBe("Wrong");
  });
  it("commits only the submitted snapshot and keeps input entered while Save was pending", () => {
    const one = cell(),
      two = cell({ id: "two" });
    const drafts = new TranslationDrafts(config, [one, two]);
    drafts.edit(one, "Submitted");
    const submitted = drafts.submission();
    drafts.edit(one, "Newer input");
    drafts.edit(two, "Other new input");
    const saved = cell({ text: "Submitted", effectiveText: "Submitted", expected: "after-save" });
    drafts.commit(submitted, [saved]);
    expect(submitted.edits[0]?.text).toBe("Submitted");
    expect(drafts.value(one)).toBe("Newer input");
    expect(drafts.personalSubmission().edits).toEqual([
      {
        kind: "product",
        id: "one",
        language: "es",
        field: "name",
        expected: "after-save",
        text: "Newer input",
      },
      {
        kind: "product",
        id: "two",
        language: "es",
        field: "name",
        expected: "original",
        text: "Other new input",
      },
    ]);
    expect(drafts.validate()).toEqual([]);
  });
  it("keeps a deliberate revert during an in-flight Save as a new null edit", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Submitted");
    const submitted = drafts.submission();
    drafts.edit(one, "");
    drafts.commit(submitted, [
      cell({ text: "Submitted", effectiveText: "Submitted", expected: "saved" }),
    ]);
    expect(drafts.value(one)).toBe("");
    expect(drafts.personalSubmission().edits).toEqual([
      { kind: "product", id: "one", language: "es", field: "name", expected: "saved", text: null },
    ]);
  });
  it("clears successfully submitted suggestions without discarding unsent work", () => {
    const one = cell(),
      two = cell({ id: "two" }),
      drafts = new TranslationDrafts(config, [one, two]);
    drafts.suggest([suggestion(one)]);
    const submitted = drafts.submission();
    drafts.edit(two, "Unsent");
    drafts.commit(submitted, [
      cell({ text: "Croqueta sugerida", effectiveText: "Croqueta sugerida", expected: "saved" }),
    ]);
    expect(drafts.value(one)).toBe("Croqueta sugerida");
    expect(drafts.origin(one)).toBeNull();
    expect(drafts.suggestedCount).toBe(0);
    expect(drafts.personalSubmission().edits.map((edit) => edit.text)).toEqual(["Unsent"]);
  });
  it("requires review of newer input if configuration changed while its Save was pending", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Submitted");
    const submitted = drafts.submission();
    drafts.edit(one, "Newer input");
    drafts.receive(page([], { defaultLanguage: "fr", languages: ["en", "es", "fr"] }));
    drafts.commit(submitted, [
      cell({
        text: "Submitted",
        effectiveText: "Submitted",
        expected: "saved-before-config-change",
      }),
    ]);
    expect(drafts.value(one)).toBe("Newer input");
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "review" }]);
  });
  it("never lets a correction silently retarget personal work to another language", () => {
    const one = cell({ text: "Wrong", effectiveText: "Wrong" });
    const drafts = new TranslationDrafts(config, [one]);
    const fix = suggestion(one, {
      text: null,
      fix: { field: "es", wrong: "Wrong", right: "Right" },
      cell: { ...ref(one), language: "fr" },
    });
    expect(drafts.useFix(fix, one)).toBe("stale");
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
  });
  it("does not promote previously waiting suggestions merely after an unstage and refresh", () => {
    const cells = changedCells(101),
      drafts = new TranslationDrafts(config, cells);
    const views = cells.map((one) => suggestion(one));
    drafts.suggest(views);
    drafts.unstage(cells[0]!);
    drafts.receive(page(cells));
    drafts.suggest(views);
    expect(drafts.staged()).toHaveLength(99);
    expect(drafts.value(cells[0]!)).toBe("");
    expect(drafts.value(cells[100]!)).toBe("");
  });
  it("accepts exactly the body byte limit and rejects the next byte", () => {
    const one = cell({ expected: "é".repeat(131021) + "a" });
    const drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Valid");
    expect(new TextEncoder().encode(JSON.stringify(drafts.submission())).length).toBe(262144);
    expect(drafts.validate()).toEqual([]);
    drafts.edit(one, "Valids");
    expect(new TextEncoder().encode(JSON.stringify(drafts.submission())).length).toBe(262145);
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "batch_bytes" }]);
  });
  it("keeps a later revert subject to review if the default changed before its Save reply", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Submitted");
    const submitted = drafts.submission();
    drafts.edit(one, "");
    drafts.receive(page([], { defaultLanguage: "fr", languages: ["en", "es", "fr"] }));
    drafts.commit(submitted, [
      cell({ text: "Submitted", effectiveText: "Submitted", expected: "saved" }),
    ]);
    expect(drafts.value(one)).toBe("");
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "review" }]);
  });
  it("stages a freshly resolved complete-row fix before that row has been mounted", () => {
    const one = cell({ text: "Wrong", effectiveText: "Wrong" });
    const drafts = new TranslationDrafts(config, []);
    expect(
      drafts.useFix(
        suggestion(one, { text: null, fix: { field: "es", wrong: "Wrong", right: "Right" } }),
        one,
      ),
    ).toBe("staged");
    expect(drafts.personalSubmission().edits).toEqual([
      {
        kind: "product",
        id: "one",
        language: "es",
        field: "name",
        expected: "original",
        text: "Right",
      },
    ]);
  });
  it("does not clear personal input for a copied rather than the exact submitted snapshot", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Sent");
    const submitted = drafts.submission();
    drafts.edit(one, "Still editing");
    drafts.commit(structuredClone(submitted), [
      cell({ text: "Sent", effectiveText: "Sent", expected: "saved" }),
    ]);
    expect(drafts.value(one)).toBe("Still editing");
    expect(drafts.personalSubmission().edits[0]).toMatchObject({
      expected: "original",
      text: "Still editing",
    });
    drafts.commit(submitted, [cell({ text: "Sent", effectiveText: "Sent", expected: "saved" })]);
    expect(drafts.personalSubmission().edits[0]).toMatchObject({
      expected: "saved",
      text: "Still editing",
    });
  });
  it("reports capacity after retaining one overflow input without taking a second overflow", () => {
    const cells = changedCells(102),
      drafts = new TranslationDrafts(config, cells);
    for (const one of cells.slice(0, 101)) drafts.edit(one, "Manual");
    expect(drafts.edit(cells[101]!, "Another input")).toBe(false);
    expect(drafts.value(cells[100]!)).toBe("Manual");
    expect(drafts.staged()).toHaveLength(101);
    expect(drafts.edit(cells[100]!, "Adjusted overflow")).toBe(true);
    expect(drafts.value(cells[100]!)).toBe("Adjusted overflow");
  });
  it("withdraws only untouched suggestions when current saved text or freshness changes", () => {
    const one = cell(),
      two = cell({ id: "two" });
    const drafts = new TranslationDrafts(config, [one, two]);
    drafts.suggest([suggestion(one), suggestion(two)]);
    drafts.edit(two, "Personal");
    drafts.receive(
      page([
        cell({ text: "Saved elsewhere", effectiveText: "Saved elsewhere", expected: "next" }),
        two,
      ]),
    );
    expect(drafts.value(one)).toBe("Saved elsewhere");
    expect(drafts.origin(one)).toBeNull();
    expect(drafts.value(two)).toBe("Personal");
    expect(drafts.suggestedCount).toBe(0);
    const fresh = cell({ id: "fresh" });
    drafts.receive(page([fresh]));
    drafts.suggest([suggestion(fresh)]);
    drafts.suggest([suggestion(fresh, { stale: true })]);
    expect(drafts.value(fresh)).toBe("");
    expect(drafts.suggestedCount).toBe(0);
  });
  it("does not stage an unknown or unavailable field and retains other personal input", () => {
    const one = cell(),
      unavailable = cell({ id: "off", eligible: false, unavailableReason: "inactive" });
    const drafts = new TranslationDrafts(config, [one, unavailable]);
    drafts.edit(one, "Mine");
    expect(drafts.edit(unavailable, "Blocked")).toBe(false);
    expect(drafts.edit(cell({ id: "unknown" }), "Blocked")).toBe(false);
    expect(drafts.personalSubmission().edits.map((edit) => edit.text)).toEqual(["Mine"]);
  });
  it("refuses an older fix read after the model has observed replacement ownership", () => {
    const one = cell({
      kind: "option_label",
      owners: { kind: "option_label", listId: "before" },
      text: "Wrong",
      effectiveText: "Wrong",
    });
    const next = cell({
      ...one,
      owners: { kind: "option_label", listId: "after" },
      expected: "reowned",
    });
    const drafts = new TranslationDrafts(config, [one]);
    drafts.receive(page([next]));
    expect(
      drafts.useFix(
        suggestion(one, { text: null, fix: { field: "es", wrong: "Wrong", right: "Right" } }),
        one,
      ),
    ).toBe("stale");
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
  });
  it("Keep resolves to clean when the latest saved value is already the personal value", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Mine");
    const latest = cell({ text: "Mine", effectiveText: "Mine", expected: "other-save" });
    drafts.receive(page([latest]));
    drafts.review([latest], new Map([[translationCellKey(one), "keep"]]));
    expect(drafts.value(one)).toBe("Mine");
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
    expect(drafts.validate()).toEqual([]);
  });
  it("requires an explicit unavailable observation rather than treating another page as a deletion", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Mine");
    drafts.receive(page([cell({ id: "unrelated" })]));
    expect(drafts.changed(one)).toBe(false);
    drafts.receive(
      page([
        cell({ eligible: false, owners: null, unavailableReason: "missing", expected: "deleted" }),
      ]),
    );
    expect(drafts.changed(one)).toBe(true);
    expect(drafts.value(one)).toBe("Mine");
  });
  it("does not lose edits missing from a Save response or accept unrelated response cells", () => {
    const one = cell(),
      two = cell({ id: "two" }),
      drafts = new TranslationDrafts(config, [one, two]);
    drafts.edit(one, "Mine");
    const submitted = drafts.submission();
    drafts.commit(submitted, [
      cell({ ...two, text: "Other reply", effectiveText: "Other reply", expected: "other" }),
    ]);
    expect(drafts.value(one)).toBe("Mine");
    expect(drafts.personalSubmission().edits[0]?.text).toBe("Mine");
    expect(drafts.value(two)).toBe("");
  });
  it("keeps a newer fix selected while committing only an earlier fix", () => {
    const one = cell({ text: "Wrong", effectiveText: "Wrong" }),
      drafts = new TranslationDrafts(config, [one]);
    drafts.useFix(
      suggestion(one, {
        id: "first",
        text: null,
        fix: { field: "es", wrong: "Wrong", right: "First" },
      }),
      one,
    );
    const submitted = drafts.submission();
    drafts.unstage(one);
    drafts.useFix(
      suggestion(one, {
        id: "second",
        text: null,
        fix: { field: "es", wrong: "Wrong", right: "Second" },
      }),
      one,
    );
    drafts.commit(submitted, [
      cell({ text: "First", effectiveText: "First", expected: "saved-first" }),
    ]);
    expect(drafts.value(one)).toBe("Second");
    expect(drafts.origin(one)).toBe("fix");
    expect(drafts.personalSubmission().edits[0]).toMatchObject({
      expected: "saved-first",
      text: "Second",
    });
  });
  it("does not invent a dirty edit when newer input already equals the acknowledged save", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Sent");
    const submitted = drafts.submission();
    drafts.edit(one, "Other");
    drafts.edit(one, "Sent");
    drafts.commit(submitted, [cell({ text: "Sent", effectiveText: "Sent", expected: "saved" })]);
    expect(drafts.value(one)).toBe("Sent");
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
  });
  it("keeps a previously empty personal blank reviewable when a hidden cell is filled elsewhere", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "");
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
    drafts.receive(page([cell({ id: "other-page" })]));
    const latest = cell({
      text: "Another person's text",
      effectiveText: "Another person's text",
      expected: "concurrent-fill",
    });
    drafts.receive(page([latest]));
    expect(drafts.value(one)).toBe("");
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "review" }]);
    drafts.review([latest], new Map([[translationCellKey(one), "keep"]]));
    expect(drafts.personalSubmission()).toEqual({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "concurrent-fill",
          text: null,
        },
      ],
    });
    expect(drafts.validate()).toEqual([]);
  });
  it("never Keeps a no-op blank against replacement ownership after revisiting the cell", () => {
    const one = cell({ kind: "option_label", owners: { kind: "option_label", listId: "old" } });
    const drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "");
    drafts.receive(page([]));
    const latest = cell({
      ...one,
      owners: { kind: "option_label", listId: "new" },
      text: "Replacement",
      effectiveText: "Replacement",
      expected: "new-owner",
    });
    drafts.receive(page([latest]));
    drafts.review([latest], new Map([[translationCellKey(one), "keep"]]));
    expect(drafts.value(one)).toBe("");
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "review" }]);
    expect(drafts.personalSubmission().edits[0]?.expected).toBe("original");
  });
  it("makes room among suggestions when a personal no-op clear becomes reviewable", () => {
    const cells = changedCells(100),
      one = cell({ id: "personal" });
    const drafts = new TranslationDrafts(config, [...cells, one]);
    drafts.edit(one, "");
    drafts.suggest(cells.map((target) => suggestion(target)));
    expect(drafts.suggestedCount).toBe(100);
    drafts.receive(
      page([cell({ ...one, text: "Concurrent", effectiveText: "Concurrent", expected: "new" })]),
    );
    expect(drafts.staged()).toHaveLength(100);
    expect(drafts.suggestedCount).toBe(99);
    expect(drafts.value(one)).toBe("");
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "review" }]);
  });
});
