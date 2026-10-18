import { describe, expect, it } from "vitest";
import type { ContentLanguages } from "@waitron/shared";
import {
  translationCellKey,
  type TranslationCell,
  type TranslationCellRef,
  type TranslationCellEdit,
} from "@waitron/catalogue/src/content-translation-types.js";
import type { ContentSuggestionView } from "@waitron/catalogue/src/content-suggestion-types.js";
import { TranslationDrafts } from "./content-translations-model.js";

const config: ContentLanguages = { defaultLanguage: "en", languages: ["en", "es", "fr"] };
const cell = (id = "one", overrides: Partial<TranslationCell> = {}): TranslationCell => ({
  kind: "product",
  id,
  language: "es",
  field: "name",
  text: null,
  inheritedText: null,
  effectiveText: null,
  defaultText: null,
  inheritedDefaultText: null,
  effectiveDefaultText: null,
  staffText: "STAFF croquette",
  eligible: true,
  unavailableReason: null,
  owners: { kind: "product", parentId: null },
  expected: `baseline-${id}`,
  ...overrides,
});
const page = (cells: TranslationCell[], settings = config) => ({
  config: settings,
  required: [],
  configuration: JSON.stringify(settings),
  cells,
});
const ref = ({ kind, id, language, field }: TranslationCellRef): TranslationCellRef => ({
  kind,
  id,
  language,
  field,
});
const edit = (target: TranslationCell, text: string | null): TranslationCellEdit => ({
  ...ref(target),
  expected: target.expected,
  text,
});
const view = (
  target: TranslationCell,
  overrides: Partial<ContentSuggestionView> = {},
): ContentSuggestionView => ({
  id: `s-${target.id}-${target.language}`,
  kind: target.kind,
  itemId: target.id,
  item: { name: target.staffText ?? target.id },
  language: target.language,
  text: `CLIENT-${target.language} ${target.id}`,
  placeholder: false,
  fix: null,
  stale: false,
  cell: ref(target),
  expected: target.expected,
  ...overrides,
});

describe("translation drafts", () => {
  it("allows a blank default and never copies staff text into either language", () => {
    const one = cell(),
      english = cell("one", { language: "en" });
    const drafts = new TranslationDrafts(config, [one, english]);
    expect(drafts.submission()).toEqual({ edits: [] });
    drafts.edit(one, "  Croqueta de jamón  ");
    expect(drafts.value(english)).toBe("");
    expect(drafts.validate()).toEqual([]);
    expect(drafts.submission()).toEqual({ edits: [edit(one, "Croqueta de jamón")] });
    drafts.edit(english, " Ham  croquette ");
    expect(drafts.validate()).toEqual([]);
    expect(drafts.submission()).toEqual({
      edits: [edit(one, "Croqueta de jamón"), edit(english, "Ham  croquette")],
    });
    expect(drafts.value(one)).toBe("  Croqueta de jamón  ");
  });
  it("keeps edits for hidden targets and distinguishes identical ids in different kinds", () => {
    const product = cell(),
      unit = cell("one", { kind: "unit", owners: { kind: "unit" } });
    const drafts = new TranslationDrafts(config, [product, unit]);
    drafts.edit(product, "Croqueta");
    drafts.edit(unit, "Ración");
    drafts.receive(page([cell("other")]));
    expect(drafts.staged()).toEqual([ref(product), ref(unit)]);
    expect(drafts.submission()).toEqual({
      edits: [edit(product, "Croqueta"), edit(unit, "Ración")],
    });
  });
  it("omits untouched cells and cancels edits returned to their blank baselines", () => {
    const one = cell(),
      english = cell("one", { language: "en" });
    const drafts = new TranslationDrafts(config, [one, english, cell("two")]);
    drafts.edit(one, "Croqueta");
    drafts.edit(english, "Ham");
    drafts.edit(one, " \n ");
    expect(drafts.validate()).toEqual([]);
    expect(drafts.submission()).toEqual({ edits: [edit(english, "Ham")] });
    drafts.edit(english, "  ");
    expect(drafts.staged()).toEqual([]);
    expect(drafts.validate()).toEqual([]);
    expect(drafts.submission()).toEqual({ edits: [] });
  });
  it("preserves an unedited effective default and sends a second language only when explicitly edited", () => {
    const one = cell("one", { effectiveDefaultText: "Inherited" });
    const english = cell("one", {
      language: "en",
      inheritedText: "Inherited",
      effectiveText: "Inherited",
    });
    const drafts = new TranslationDrafts(config, [one, english]);
    drafts.edit(one, "Croqueta");
    expect(drafts.submission()).toEqual({ edits: [edit(one, "Croqueta")] });
    expect(drafts.value(english)).toBe("");
    drafts.edit(english, "Overwrite");
    expect(drafts.submission()).toEqual({
      edits: [edit(one, "Croqueta"), edit(english, "Overwrite")],
    });
    expect(drafts.submission().edits[0]).not.toHaveProperty("defaultText");
  });
  it("retains the 101st personal cell and admits it after undoing one selected cell", () => {
    const rows = Array.from({ length: 101 }, (_, n) => cell(String(n)));
    const drafts = new TranslationDrafts(config, rows);
    for (const row of rows) drafts.edit(row, "Nombre");
    expect(drafts.staged()).toHaveLength(101);
    expect(drafts.value(rows[100]!)).toBe("Nombre");
    expect(drafts.validate()).toEqual([{ cell: ref(rows[100]!), message: "capacity" }]);
    drafts.edit(rows[0]!, "");
    drafts.edit(rows[100]!, "Última");
    expect(drafts.staged()).toHaveLength(100);
    expect(drafts.value(rows[100]!)).toBe("Última");
    expect(drafts.validate()).toEqual([]);
  });
  it("checks actual UTF-8 bytes for both language fields and the serialized batch", () => {
    const one = cell(),
      english = cell("one", { language: "en" });
    const drafts = new TranslationDrafts(config, [one, english]);
    drafts.edit(one, "é".repeat(2048));
    drafts.edit(english, "x".repeat(4096));
    expect(drafts.validate()).toEqual([]);
    drafts.edit(one, "é".repeat(2049));
    drafts.edit(english, "x".repeat(4097));
    expect(drafts.validate()).toEqual([
      { cell: ref(one), message: "name_bytes" },
      { cell: ref(english), message: "name_bytes" },
    ]);
    const rows = Array.from({ length: 64 }, (_, n) => cell(String(n)));
    const many = new TranslationDrafts(config, rows);
    for (const row of rows) many.edit(row, "x".repeat(4096));
    expect(many.validate().some((fault) => fault.message === "batch_bytes")).toBe(true);
  });
  it("does not stage unavailable targets or redirect unknown references", () => {
    const one = cell("one", { eligible: false, unavailableReason: "inactive" });
    const drafts = new TranslationDrafts(config, [one]);
    expect(drafts.edit(one, "Nombre")).toBe(false);
    expect(drafts.edit(cell("missing"), "Otro")).toBe(false);
    expect(drafts.submission()).toEqual({ edits: [] });
  });
  it("compares trimmed input with its saved baseline and unstage restores saved text", () => {
    const one = cell("one", { text: "Saved", effectiveText: "Saved" });
    const drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, " Saved ");
    expect(drafts.staged()).toHaveLength(0);
    drafts.edit(one, "Changed");
    expect(drafts.staged()).toHaveLength(1);
    drafts.unstage(one);
    expect(drafts.value(one)).toBe("Saved");
    expect(drafts.staged()).toHaveLength(0);
  });
});

describe("translation snapshot review", () => {
  it("retains dirty departures without adopting a concurrent fill and accepts a separate page", () => {
    const one = cell(),
      clean = cell("clean"),
      arrival = cell("arrival");
    const drafts = new TranslationDrafts(config, [one, clean]);
    drafts.edit(one, "My draft");
    drafts.receive(
      page([
        arrival,
        { ...one, text: "Their name", effectiveText: "Their name", expected: "current" },
      ]),
    );
    expect(drafts.current(clean)).toBeUndefined();
    expect(drafts.current(arrival)).toEqual(arrival);
    expect(drafts.staged()).toEqual([ref(one)]);
    expect(drafts.value(one)).toBe("My draft");
    expect(drafts.changed(one)).toBe(true);
    expect(drafts.validate()).toContainEqual({ cell: ref(one), message: "review" });
    expect(drafts.submission().edits[0]!.expected).toBe("baseline-one");
  });
  it.each(["keep", "replace", "discard"] as const)(
    "accepts the current baseline only after explicit %s",
    (choice) => {
      const one = cell(),
        latest = cell("one", {
          text: "Their name",
          effectiveText: "Their name",
          expected: "current",
        });
      const drafts = new TranslationDrafts(config, [one]);
      drafts.edit(one, "My draft");
      drafts.receive(page([latest]));
      drafts.review([latest], new Map());
      expect(drafts.value(one)).toBe("My draft");
      expect(drafts.submission().edits[0]!.expected).toBe("baseline-one");
      drafts.review([latest], new Map([[translationCellKey(one), choice]]));
      expect(drafts.changed(one)).toBe(false);
      expect(drafts.value(one)).toBe(choice === "keep" ? "My draft" : "Their name");
      expect(drafts.submission()).toEqual(
        choice === "keep" ? { edits: [edit(latest, "My draft")] } : { edits: [] },
      );
    },
  );
  it("retains unavailable edits and refuses to reassign them to replacement owners", () => {
    const one = cell("one", {
      kind: "option_label",
      owners: { kind: "option_label", listId: "old-list" },
    });
    const moved = {
      ...one,
      owners: { kind: "option_label" as const, listId: "new-list" },
      expected: "moved",
    };
    const drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "My draft");
    drafts.receive(page([moved]));
    drafts.review([moved], new Map([[translationCellKey(one), "keep"]]));
    expect(drafts.submission().edits[0]!.expected).toBe("baseline-one");
    expect(drafts.value(one)).toBe("My draft");
    expect(drafts.validate()).toContainEqual({ cell: ref(one), message: "review" });
    const missing = {
      ...one,
      eligible: false,
      unavailableReason: "missing" as const,
      expected: "missing",
    };
    drafts.receive(page([missing]));
    expect(drafts.current(one)?.eligible).toBe(false);
    expect(drafts.staged()).toHaveLength(1);
    drafts.review([missing], new Map([[translationCellKey(one), "discard"]]));
    expect(drafts.staged()).toHaveLength(0);
  });
  it("incorporates the latest page in order while preserving unchanged drafts", () => {
    const one = cell(),
      arrival = cell("arrival");
    const drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "My draft");
    drafts.receive(page([arrival, one]));
    drafts.review([arrival, one], new Map());
    expect(drafts.current(arrival)).toEqual(arrival);
    expect(drafts.current(one)).toEqual(one);
    expect(drafts.staged()).toEqual([ref(one)]);
    expect(drafts.submission()).toEqual({ edits: [edit(one, "My draft")] });
  });
  it("reviewing a changed default never transfers an English draft into French", () => {
    const one = cell(),
      english = cell("one", { language: "en" }),
      french = cell("one", { language: "fr" });
    const drafts = new TranslationDrafts(config, [one, english, french]);
    drafts.edit(one, "Croqueta");
    drafts.edit(english, "English companion");
    const settings = { ...config, defaultLanguage: "fr" };
    const latest = { ...one, expected: "new-default-es" },
      latestEnglish = { ...english, expected: "new-default-en" };
    drafts.receive(page([latest, latestEnglish, french], settings));
    expect(drafts.validate()).toEqual([
      { cell: ref(one), message: "review" },
      { cell: ref(english), message: "review" },
    ]);
    drafts.review(
      [latest, latestEnglish],
      new Map([
        [translationCellKey(one), "keep"],
        [translationCellKey(english), "keep"],
      ]),
    );
    expect(drafts.value(one)).toBe("Croqueta");
    expect(drafts.value(english)).toBe("English companion");
    expect(drafts.value(french)).toBe("");
    expect(drafts.validate()).toEqual([]);
    drafts.edit(french, "Compagnon français");
    expect(drafts.submission()).toEqual({
      edits: [
        edit(latest, "Croqueta"),
        edit(latestEnglish, "English companion"),
        edit(french, "Compagnon français"),
      ],
    });
  });
  it("a clean departure can return on a later page rather than disappearing forever", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.receive(page([]));
    expect(drafts.current(one)).toBeUndefined();
    drafts.receive(page([one]));
    expect(drafts.current(one)).toEqual(one);
    expect(drafts.staged()).toEqual([]);
  });
  it("a draft added while another page loads is retained without falsely treating omission as deletion", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.edit(one, "Late draft");
    drafts.receive(page([]));
    expect(drafts.staged()).toEqual([ref(one)]);
    expect(drafts.changed(one)).toBe(false);
    expect(drafts.submission().edits[0]!.text).toBe("Late draft");
    drafts.receive(
      page([{ ...one, eligible: false, unavailableReason: "missing", expected: "gone" }]),
    );
    expect(drafts.changed(one)).toBe(true);
    expect(drafts.value(one)).toBe("Late draft");
  });
  it("reviews each language separately when another person fills the former companion", () => {
    const one = cell(),
      english = cell("one", { language: "en" });
    const drafts = new TranslationDrafts(config, [one, english]);
    drafts.edit(one, "Croqueta");
    drafts.edit(english, "Old English draft");
    const current = { ...one, text: "Croqueta", effectiveText: "Croqueta", expected: "current-es" };
    const currentEnglish = {
      ...english,
      text: "Current English",
      effectiveText: "Current English",
      expected: "current-en",
    };
    drafts.receive(page([current, currentEnglish]));
    drafts.review([current, currentEnglish], new Map([[translationCellKey(one), "keep"]]));
    expect(drafts.staged()).toEqual([ref(english)]);
    expect(drafts.value(english)).toBe("Old English draft");
    drafts.review([currentEnglish], new Map([[translationCellKey(english), "replace"]]));
    expect(drafts.staged()).toHaveLength(0);
    expect(drafts.value(english)).toBe("Current English");
    expect(drafts.submission()).toEqual({ edits: [] });
  });
});

describe("suggested drafts", () => {
  it("fills untouched eligible empty cells and leaves a person's edit alone", () => {
    const one = cell(),
      two = cell("two"),
      off = cell("off", { eligible: false, unavailableReason: "inactive" });
    const named = cell("named", { text: "Pan", effectiveText: "Pan" });
    const drafts = new TranslationDrafts(config, [one, two, off, named]);
    drafts.edit(two, "Mine");
    drafts.suggest([one, two, off, named].map((target) => view(target)));
    expect(drafts.value(one)).toBe("CLIENT-es one");
    expect(drafts.origin(one)).toBe("suggested");
    expect(drafts.value(two)).toBe("Mine");
    expect(drafts.origin(two)).toBe("personal");
    expect(drafts.value(off)).toBe("");
    expect(drafts.value(named)).toBe("Pan");
    expect(drafts.suggestedCount).toBe(1);
    expect(drafts.staged()).toHaveLength(2);
    expect(drafts.submission()).toEqual({ edits: [edit(two, "Mine"), edit(one, "CLIENT-es one")] });
    expect(drafts.personalSubmission()).toEqual({ edits: [edit(two, "Mine")] });
  });
  it("skips stale suggestions and placeholders but does not require a default-language suggestion", () => {
    const stale = cell("stale"),
      placeholder = cell("placeholder"),
      alone = cell("alone"),
      both = cell("both"),
      english = cell("both", { language: "en" });
    const drafts = new TranslationDrafts(config, [stale, placeholder, alone, both, english]);
    drafts.suggest([
      view(stale, { stale: true }),
      view(placeholder, { placeholder: true, text: null }),
      view(alone),
      view(both),
      view(english),
    ]);
    expect(drafts.suggestedCount).toBe(3);
    expect(drafts.value(stale)).toBe("");
    expect(drafts.value(placeholder)).toBe("");
    expect(drafts.value(alone)).toBe("CLIENT-es alone");
    expect(drafts.value(english)).toBe("CLIENT-en both");
    expect(drafts.submission()).toEqual({
      edits: [
        edit(alone, "CLIENT-es alone"),
        edit(both, "CLIENT-es both"),
        edit(english, "CLIENT-en both"),
      ],
    });
  });
  it("counts personal cells toward 100, evicts borrowed fills first and leaves overflow for explicit selection", () => {
    const rows = Array.from({ length: 102 }, (_, n) => cell(String(n)));
    const drafts = new TranslationDrafts(config, rows);
    drafts.edit(rows[101]!, "Mine");
    drafts.suggest(rows.map((target) => view(target)));
    expect(drafts.staged()).toHaveLength(100);
    expect(drafts.suggestedCount).toBe(99);
    expect(drafts.origin(rows[98]!)).toBe("suggested");
    expect(drafts.origin(rows[99]!)).toBeNull();
    expect(drafts.waitingCount).toBe(2);
    drafts.edit(rows[99]!, "Other");
    expect(drafts.value(rows[99]!)).toBe("Other");
    expect(drafts.origin(rows[98]!)).toBeNull();
    expect(drafts.staged()).toHaveLength(100);
    drafts.edit(rows[0]!, "Changed");
    expect(drafts.value(rows[0]!)).toBe("Changed");
    drafts.unstage(rows[1]!);
    drafts.suggest(rows.map((target) => view(target)));
    expect(drafts.value(rows[1]!)).toBe("");
    expect(drafts.value(rows[100]!)).toBe("");
    expect(drafts.staged()).toHaveLength(99);
    expect(drafts.validate()).toEqual([]);
  });
  it("touching a suggestion takes personal ownership even when typing back to its text", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.suggest([view(one)]);
    drafts.edit(one, "Croqueta casera");
    expect(drafts.origin(one)).toBe("personal");
    expect(drafts.personalSubmission()).toEqual({ edits: [edit(one, "Croqueta casera")] });
    drafts.edit(one, "CLIENT-es one");
    expect(drafts.origin(one)).toBe("personal");
    expect(drafts.personalSubmission()).toEqual({ edits: [edit(one, "CLIENT-es one")] });
    drafts.edit(one, "  ");
    expect(drafts.origin(one)).toBe("personal");
    expect(drafts.submission()).toEqual({ edits: [] });
    drafts.unstage(one);
    drafts.suggest([view(one)]);
    expect(drafts.value(one)).toBe("CLIENT-es one");
    expect(drafts.origin(one)).toBe("suggested");
  });
  it("typing back to a suggestion after a refresh retains personal ownership", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.suggest([view(one)]);
    drafts.edit(one, "Mine");
    drafts.receive(page([one]));
    drafts.edit(one, "CLIENT-es one");
    expect(drafts.origin(one)).toBe("personal");
    expect(drafts.personalSubmission()).toEqual({ edits: [edit(one, "CLIENT-es one")] });
  });
  it("a personal English field beside a suggested Spanish name keeps both independent cells", () => {
    const one = cell(),
      english = cell("one", { language: "en" });
    const drafts = new TranslationDrafts(config, [one, english]);
    drafts.suggest([view(one), view(english)]);
    drafts.edit(english, "Ham croquette");
    expect(drafts.submission()).toEqual({
      edits: [edit(one, "CLIENT-es one"), edit(english, "Ham croquette")],
    });
    expect(drafts.personalSubmission()).toEqual({ edits: [edit(english, "Ham croquette")] });
  });
  it("Discard empties the borrowed cell and ignores that id on later reads, but accepts a new id", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    const first = view(one, { id: "s1" });
    drafts.suggest([first]);
    drafts.discardSuggestion("s1");
    expect(drafts.value(one)).toBe("");
    drafts.suggest([first]);
    expect(drafts.value(one)).toBe("");
    drafts.suggest([view(one, { id: "s9", text: "CLIENT-es again" })]);
    expect(drafts.value(one)).toBe("CLIENT-es again");
  });
  it("Discard removes only borrowed language cells and preserves each personal field", () => {
    for (const mode of ["es", "en", "both"]) {
      const one = cell(mode),
        english = cell(mode, { language: "en" });
      const drafts = new TranslationDrafts(config, [one, english]);
      const spanishView = view(one),
        englishView = view(english);
      drafts.suggest([spanishView, englishView]);
      if (mode !== "en") drafts.edit(one, "Mi nombre");
      if (mode !== "es") drafts.edit(english, "My name");
      drafts.discardSuggestion(spanishView.id);
      drafts.discardSuggestion(englishView.id);
      expect(drafts.value(one)).toBe(mode === "en" ? "" : "Mi nombre");
      expect(drafts.value(english)).toBe(mode === "es" ? "" : "My name");
      expect(drafts.personalSubmission()).toEqual({
        edits: [
          ...(mode !== "en" ? [edit(one, "Mi nombre")] : []),
          ...(mode !== "es" ? [edit(english, "My name")] : []),
        ],
      });
    }
  });
  it("Discard takes back its borrowed field after a page stopped listing the id, and unrelated deletion does nothing", () => {
    const one = cell(),
      english = cell("one", { language: "en" });
    const drafts = new TranslationDrafts(config, [one, english]);
    drafts.suggest([view(one, { id: "s1" }), view(english, { id: "s2" })]);
    drafts.edit(one, "Mine");
    drafts.suggest([]);
    drafts.discardSuggestion("s7");
    expect(drafts.value(english)).toBe("CLIENT-en one");
    drafts.discardSuggestion("s2");
    expect(drafts.value(english)).toBe("");
    expect(drafts.personalSubmission()).toEqual({ edits: [edit(one, "Mine")] });
  });
  it("Discard of a later unborrowed suggestion leaves the earlier borrowed cell alone", () => {
    const one = cell(),
      english = cell("one", { language: "en" });
    const drafts = new TranslationDrafts(config, [one, english]);
    drafts.suggest([view(one, { id: "s1" }), view(english, { id: "s2" })]);
    drafts.edit(one, "Mine");
    drafts.discardSuggestion("s5");
    expect(drafts.value(english)).toBe("CLIENT-en one");
    expect(drafts.submission()).toEqual({
      edits: [edit(one, "Mine"), edit(english, "CLIENT-en one")],
    });
    expect(drafts.personalSubmission()).toEqual({ edits: [edit(one, "Mine")] });
  });
  it("discarding one old id does not suppress a replacement borrowed from a different id", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.suggest([view(one, { id: "s0" })]);
    drafts.suggest([view(one, { id: "s5", text: "Replacement" })]);
    drafts.discardSuggestion("s0");
    expect(drafts.value(one)).toBe("Replacement");
    expect(drafts.origin(one)).toBe("suggested");
    drafts.suggest([view(one, { id: "s9", text: "CLIENT-es again" })]);
    expect(drafts.value(one)).toBe("CLIENT-es again");
  });
  it("accepts an independently returned new id after the old id was discarded", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.suggest([view(one, { id: "s0" })]);
    drafts.discardSuggestion("s0");
    expect(drafts.value(one)).toBe("");
    drafts.suggest([view(one, { id: "s5", text: "CLIENT-es new" })]);
    expect(drafts.value(one)).toBe("CLIENT-es new");
  });
  it("a discarded id cannot refill its cell while a new id fills a separate language", () => {
    const one = cell(),
      english = cell("one", { language: "en" });
    const drafts = new TranslationDrafts(config, [one, english]);
    drafts.suggest([view(one, { id: "s0" })]);
    drafts.discardSuggestion("s0");
    drafts.suggest([view(one, { id: "s0" }), view(english, { id: "s7" })]);
    expect(drafts.value(one)).toBe("");
    expect(drafts.origin(one)).toBeNull();
    expect(drafts.value(english)).toBe("CLIENT-en one");
    drafts.suggest([view(one, { id: "s9", text: "CLIENT-es new" })]);
    expect(drafts.value(one)).toBe("CLIENT-es new");
  });
  it("Discard suppresses its exact id even before a read has listed it", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.discardSuggestion("s0");
    drafts.suggest([view(one, { id: "s0" })]);
    expect(drafts.value(one)).toBe("");
    expect(drafts.origin(one)).toBeNull();
    drafts.suggest([view(one, { id: "s1" })]);
    expect(drafts.value(one)).toBe("CLIENT-es one");
  });
  it("Discard leaves no dirty edit when personal input returned to saved text", () => {
    const one = cell("one", { text: "Croqueta", effectiveText: "Croqueta" });
    const drafts = new TranslationDrafts(config, [one]);
    drafts.suggest([view(one)]);
    drafts.edit(one, "Other");
    expect(drafts.staged()).toHaveLength(1);
    drafts.edit(one, "Croqueta");
    drafts.discardSuggestion(view(one).id);
    expect(drafts.staged()).toHaveLength(0);
    expect(drafts.value(one)).toBe("Croqueta");
    expect(drafts.submission()).toEqual({ edits: [] });
  });
  it("new suggestion text cannot silently replace an edited cell even when it matches old or new suggestions", () => {
    const one = cell(),
      two = cell("two");
    const drafts = new TranslationDrafts(config, [one, two]);
    drafts.suggest([
      view(one, { id: "s1", text: "OLD one" }),
      view(two, { id: "s2", text: "OLD two" }),
    ]);
    drafts.edit(one, "Mine");
    drafts.suggest([
      view(one, { id: "s9", text: "NEW one" }),
      view(two, { id: "s8", text: "NEW two" }),
    ]);
    expect(drafts.value(one)).toBe("Mine");
    expect(drafts.value(two)).toBe("NEW two");
    drafts.edit(one, "OLD one");
    expect(drafts.origin(one)).toBe("personal");
    drafts.edit(one, "NEW one");
    expect(drafts.origin(one)).toBe("personal");
    expect(drafts.personalSubmission()).toEqual({ edits: [edit(one, "NEW one")] });
  });
  it("Discard and stale evidence for a bare cell leave other suggestions filled", () => {
    const one = cell(),
      bare = cell("bare");
    const drafts = new TranslationDrafts(config, [one, bare]);
    drafts.suggest([view(one)]);
    drafts.discardSuggestion("absent");
    drafts.suggest([view(bare, { stale: true })]);
    expect(drafts.origin(one)).toBe("suggested");
    expect(drafts.origin(bare)).toBeNull();
  });
  it("stale evidence withdraws just its untouched suggestion and fills nothing from it", () => {
    const one = cell(),
      two = cell("two");
    const drafts = new TranslationDrafts(config, [one, two]);
    const first = view(one);
    drafts.suggest([first, view(two)]);
    drafts.suggest([{ ...first, stale: true }]);
    expect(drafts.value(one)).toBe("");
    expect(drafts.origin(two)).toBe("suggested");
    drafts.suggest([{ ...first, stale: true }]);
    expect(drafts.value(one)).toBe("");
  });
  it("refreshes returned suggestions and retains an off-page fill until explicit current-cell evidence withdraws it", () => {
    const listed = cell("listed"),
      absent = cell("absent");
    const drafts = new TranslationDrafts(config, [listed, absent]);
    const listedView = view(listed),
      absentView = view(absent);
    drafts.suggest([listedView, absentView]);
    const fresh = { ...absent, expected: "refreshed-absent" };
    drafts.receive(page([listed, fresh]));
    drafts.suggest([{ ...absentView, expected: fresh.expected }]);
    expect(drafts.origin(absent)).toBe("suggested");
    expect(drafts.submission().edits.map((row) => row.expected)).toEqual([
      "baseline-listed",
      "refreshed-absent",
    ]);
    drafts.receive(page([listed]));
    expect(drafts.staged()).toHaveLength(2);
    expect(drafts.value(absent)).toBe("CLIENT-es absent");
    drafts.receive(page([{ ...fresh, eligible: false, unavailableReason: "missing" }]));
    expect(drafts.origin(absent)).toBeNull();
    expect(drafts.staged()).toHaveLength(1);
    drafts.receive(page([listed, absent]));
    drafts.suggest([listedView, { ...absentView, id: "replacement" }]);
    expect(drafts.value(absent)).toBe("CLIENT-es absent");
  });
  it("a new default refreshes untouched suggestions without creating personal edits or changing languages", () => {
    const one = cell(),
      english = cell("one", { language: "en" });
    const drafts = new TranslationDrafts(config, [one, english]);
    drafts.suggest([view(one), view(english)]);
    const latest = { ...one, expected: "new-default-es" },
      latestEnglish = { ...english, expected: "new-default-en" };
    drafts.receive(page([latest, latestEnglish], { ...config, defaultLanguage: "fr" }));
    expect(drafts.staged()).toEqual([]);
    drafts.suggest([view(latest), view(latestEnglish)]);
    expect(drafts.submission()).toEqual({
      edits: [edit(latest, "CLIENT-es one"), edit(latestEnglish, "CLIENT-en one")],
    });
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
    expect(drafts.validate()).toEqual([]);
  });
  it("checks a suggested name's UTF-8 bytes like a typed one", () => {
    const one = cell(),
      drafts = new TranslationDrafts(config, [one]);
    drafts.suggest([view(one, { text: "é".repeat(2049) })]);
    expect(drafts.validate()).toEqual([{ cell: ref(one), message: "name_bytes" }]);
  });
  it("keeps language suggestions, staff notes and placeholders independent instead of grouping their stale flags", () => {
    const one = cell(),
      english = cell("one", { language: "en" });
    const variant = cell("one", {
      kind: "variant",
      owners: { kind: "variant", parentId: "parent" },
    });
    const drafts = new TranslationDrafts(config, [one, english, variant]);
    const notes: ContentSuggestionView[] = [
      view(one, { id: "s1" }),
      view(english, { id: "s2", stale: true }),
      view(one, {
        id: "s3",
        language: null,
        text: null,
        cell: null,
        expected: null,
        fix: { field: "internal", wrong: "ZURRITO", right: "ZURITO" },
      }),
      view(variant, { id: "s4", placeholder: true, text: null }),
      view(one, {
        id: "s5",
        language: "fr",
        text: null,
        fix: { field: "fr", wrong: "Crocretes", right: "Croquettes" },
        cell: { ...ref(one), language: "fr" },
      }),
    ];
    drafts.suggest(notes);
    expect(drafts.submission()).toEqual({ edits: [edit(one, "CLIENT-es one")] });
    expect(drafts.value(english)).toBe("");
    expect(drafts.value(variant)).toBe("");
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
    drafts.discardSuggestion("s3");
    drafts.discardSuggestion("s4");
    expect(drafts.value(one)).toBe("CLIENT-es one");
  });
});

it("removes a discarded overflow suggestion from the waiting count without disturbing the selected batch", () => {
  const cells = Array.from({ length: 101 }, (_, n) => cell(String(n)));
  const drafts = new TranslationDrafts(config, cells);
  drafts.suggest(cells.map((target) => view(target)));
  expect(drafts.suggestedCount).toBe(100);
  expect(drafts.waitingCount).toBe(1);
  const submitted = drafts.submission();
  drafts.discardSuggestion("s-100-es");
  expect(drafts.waitingCount).toBe(0);
  expect(drafts.submission()).toEqual(submitted);
  drafts.suggest([view(cells[100]!)]);
  expect(drafts.value(cells[100]!)).toBe("");
  expect(drafts.waitingCount).toBe(0);
});
