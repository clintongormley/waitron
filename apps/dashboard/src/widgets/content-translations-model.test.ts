import { describe, expect, it } from "vitest";
import type { ContentSuggestionView, TranslationTarget } from "../api/client.js";
import {
  TranslationDrafts,
  indexSuggestions,
  type RowSuggestion,
} from "./content-translations-legacy-model.js";

const target = (id = "one", overrides: Partial<TranslationTarget> = {}): TranslationTarget => ({
  kind: "product",
  id,
  name: "Staff croquette",
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
  ...overrides,
});

describe("translation drafts", () => {
  it("requires an explicit blank companion, never copying staff text", () => {
    const row = target();
    const drafts = new TranslationDrafts("es", "en", [row]);
    expect(drafts.submission()).toEqual({ edits: [] });
    drafts.edit(row, "text", "  Croqueta de jamón  ");
    expect(drafts.value(row, "defaultText")).toBe("");
    expect(drafts.validate()).toEqual([
      { target: { kind: "product", id: "one" }, field: "defaultText", message: "required" },
    ]);
    drafts.edit(row, "defaultText", " Ham  croquette ");
    expect(drafts.validate()).toEqual([]);
    expect(drafts.submission()).toEqual({
      edits: [
        {
          kind: "product",
          id: "one",
          expected: "baseline-one",
          text: "Croqueta de jamón",
          defaultText: "Ham  croquette",
        },
      ],
    });
    expect(drafts.value(row, "text")).toBe("  Croqueta de jamón  ");
  });
  it("keeps edits for hidden targets and distinguishes identical ids in different kinds", () => {
    const product = target("one", { defaultRequired: false });
    const unit = target("one", { kind: "unit", owners: { kind: "unit" }, defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [product, unit]);
    drafts.edit(product, "text", "Croqueta");
    drafts.edit(unit, "text", "Ración");
    expect(drafts.count).toBe(2);
    expect(drafts.submission()).toEqual({
      edits: [
        { kind: "product", id: "one", expected: "baseline-one", text: "Croqueta" },
        { kind: "unit", id: "one", expected: "baseline-one", text: "Ración" },
      ],
    });
  });
  it("omits untouched rows and cancels an edit when both fields are empty or whitespace", () => {
    const row = target();
    const drafts = new TranslationDrafts("es", "en", [row, target("two")]);
    drafts.edit(row, "text", "Croqueta");
    drafts.edit(row, "defaultText", "Ham");
    drafts.edit(row, "text", " \n ");
    expect(drafts.validate()).toEqual([
      { target: { kind: "product", id: "one" }, field: "text", message: "required" },
    ]);
    drafts.edit(row, "defaultText", "  ");
    expect(drafts.count).toBe(0);
    expect(drafts.validate()).toEqual([]);
    expect(drafts.submission()).toEqual({ edits: [] });
  });
  it("preserves existing effective defaults and never sends an unsolicited second language", () => {
    const row = target("one", { defaultRequired: false, effectiveDefaultText: "Inherited" });
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.edit(row, "text", "Croqueta");
    drafts.edit(row, "defaultText", "Overwrite");
    expect(drafts.submission()).toEqual({
      edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "Croqueta" }],
    });
    const own = new TranslationDrafts("en", "en", [target()]);
    own.edit(row, "text", "Croquette");
    expect(own.validate()).toEqual([]);
    expect(own.submission().edits[0]).not.toHaveProperty("defaultText");
  });
  it("bounds drafts at 100 and admits a new target after undoing one", () => {
    const rows = Array.from({ length: 101 }, (_, n) =>
      target(String(n), { defaultRequired: false }),
    );
    const drafts = new TranslationDrafts("es", "en", rows);
    for (const row of rows) drafts.edit(row, "text", "Nombre");
    expect(drafts.count).toBe(100);
    expect(drafts.value(rows[100]!, "text")).toBe("");
    drafts.edit(rows[0]!, "text", "");
    drafts.edit(rows[100]!, "text", "Última");
    expect(drafts.count).toBe(100);
    expect(drafts.value(rows[100]!, "text")).toBe("Última");
  });
  it("checks actual UTF-8 bytes for both fields and the serialized batch", () => {
    const row = target();
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.edit(row, "text", "é".repeat(2048));
    drafts.edit(row, "defaultText", "x".repeat(4096));
    expect(drafts.validate()).toEqual([]);
    drafts.edit(row, "text", "é".repeat(2049));
    drafts.edit(row, "defaultText", "x".repeat(4097));
    expect(drafts.validate().map((f) => [f.field, f.message])).toEqual([
      ["text", "name_bytes"],
      ["defaultText", "name_bytes"],
    ]);
    const rows = Array.from({ length: 64 }, (_, n) =>
      target(String(n), { defaultRequired: false }),
    );
    const many = new TranslationDrafts("es", "en", rows);
    for (const row of rows) many.edit(row, "text", "x".repeat(4096));
    expect(many.validate().some((f) => f.message === "batch_bytes")).toBe(true);
  });
  it("does not stage unavailable targets or redirect unknown references", () => {
    const row = target("one", { eligible: false, unavailableReason: "inactive" });
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.edit(row, "text", "Nombre");
    drafts.edit(target("missing"), "text", "Otro");
    expect(drafts.submission()).toEqual({ edits: [] });
  });
  it("compares trimmed input with its selected baseline rather than raw typing", () => {
    const row = target("one", { selectedText: "Saved", defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.edit(row, "text", " Saved ");
    expect(drafts.count).toBe(0);
    drafts.edit(row, "text", "Changed");
    expect(drafts.count).toBe(1);
    drafts.reset();
    expect(drafts.value(row, "text")).toBe("Saved");
    expect(drafts.count).toBe(0);
  });
});

describe("translation snapshot review", () => {
  it("holds arrivals and dirty departures without adopting a concurrent fill", () => {
    const one = target("one", { defaultRequired: false });
    const clean = target("clean", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one, clean]);
    drafts.edit(one, "text", "My draft");
    const filled = { ...one, selectedText: "Their name", expected: "current" };
    drafts.snapshot([target("arrival")], [filled]);
    expect(drafts.rows.map((row) => row.id)).toEqual(["one"]);
    expect(drafts.value(one, "text")).toBe("My draft");
    expect(drafts.arrivals).toBe(1);
    expect(drafts.changed(one)).toBe(true);
    expect(drafts.validate()).toContainEqual({
      target: { kind: "product", id: "one" },
      field: "text",
      message: "review",
    });
    expect(drafts.submission().edits[0]!.expected).toBe("baseline-one");
  });
  it.each(["keep", "replace", "discard"] as const)(
    "accepts the current baseline only after explicit %s",
    (choice) => {
      const one = target("one", { defaultRequired: false });
      const drafts = new TranslationDrafts("es", "en", [one]);
      drafts.edit(one, "text", "My draft");
      const latest = { ...one, selectedText: "Their name", expected: "current" };
      drafts.snapshot([], [latest]);
      drafts.review([latest], new Map());
      expect(drafts.value(one, "text")).toBe("My draft");
      expect(drafts.submission().edits[0]!.expected).toBe("baseline-one");
      drafts.review([latest], new Map([["product:one", choice]]));
      expect(drafts.changed(one)).toBe(false);
      expect(drafts.value(one, "text")).toBe(choice === "keep" ? "My draft" : "Their name");
      expect(drafts.submission()).toEqual(
        choice === "keep"
          ? { edits: [{ kind: "product", id: "one", expected: "current", text: "My draft" }] }
          : { edits: [] },
      );
    },
  );
  it("retains unavailable edits and refuses to reassign them to replacement owners", () => {
    const one = target("one", {
      kind: "option_label",
      owners: { kind: "option_label", listId: "old-list" },
      defaultRequired: false,
    });
    const drafts = new TranslationDrafts("es", "en", [one]);
    drafts.edit(one, "text", "My draft");
    const moved = {
      ...one,
      owners: { kind: "option_label" as const, listId: "new-list" },
      expected: "moved",
    };
    drafts.snapshot([], [moved]);
    drafts.review([moved], new Map([["option_label:one", "keep"]]));
    expect(drafts.submission().edits[0]!.expected).toBe("baseline-one");
    expect(drafts.value(one, "text")).toBe("My draft");
    expect(drafts.validate()).toContainEqual({
      target: { kind: "option_label", id: "one" },
      field: "text",
      message: "review",
    });
    const missing = {
      ...one,
      eligible: false,
      unavailableReason: "missing" as const,
      expected: "missing",
    };
    drafts.snapshot([], [missing]);
    expect(drafts.current(one)?.eligible).toBe(false);
    expect(drafts.rows).toHaveLength(1);
    drafts.review([missing], new Map([["option_label:one", "discard"]]));
    expect(drafts.count).toBe(0);
  });
  it("incorporates latest arrivals in order on review while preserving unchanged drafts", () => {
    const one = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one]);
    drafts.edit(one, "text", "My draft");
    const arrival = target("arrival", { defaultRequired: false });
    drafts.snapshot([arrival, one], [one]);
    drafts.review([arrival, one], new Map());
    expect(drafts.rows.map((row) => row.id)).toEqual(["arrival", "one"]);
    expect(drafts.arrivals).toBe(0);
    expect(drafts.submission()).toEqual({
      edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "My draft" }],
    });
  });
});

it("reviewing a changed default never transfers the old companion into the new language", () => {
  const row = target();
  const drafts = new TranslationDrafts("es", "en", [row]);
  drafts.edit(row, "text", "Croqueta");
  drafts.edit(row, "defaultText", "English companion");
  const latest = { ...row, expected: "new-default" };
  drafts.snapshot([latest], [latest], "fr");
  drafts.review([latest], new Map([["product:one", "keep"]]));
  expect(drafts.defaultLanguage).toBe("fr");
  expect(drafts.value(row, "text")).toBe("Croqueta");
  expect(drafts.value(row, "defaultText")).toBe("");
  expect(drafts.validate()).toContainEqual({
    target: { kind: "product", id: "one" },
    field: "defaultText",
    message: "required",
  });
  drafts.edit(row, "defaultText", "Compagnon français");
  expect(drafts.submission()).toEqual({
    edits: [
      {
        kind: "product",
        id: "one",
        expected: "new-default",
        text: "Croqueta",
        defaultText: "Compagnon français",
      },
    ],
  });
});
it("a clean departure can return as a new arrival rather than disappearing forever", () => {
  const row = target("one", { defaultRequired: false });
  const drafts = new TranslationDrafts("es", "en", [row]);
  drafts.snapshot([], []);
  expect(drafts.rows).toEqual([]);
  drafts.snapshot([row], []);
  expect(drafts.arrivals).toBe(1);
});

it("a draft added during a scan stays marked for review when that scan omitted its reference", () => {
  const row = target("one", { defaultRequired: false });
  const drafts = new TranslationDrafts("es", "en", [row]);
  drafts.edit(row, "text", "Late draft");
  drafts.snapshot([], []);
  expect(drafts.rows).toHaveLength(1);
  expect(drafts.changed(row)).toBe(true);
  expect(drafts.submission().edits[0]!.text).toBe("Late draft");
});

it("keeping a draft whose companion was filled elsewhere never stages that obsolete companion", () => {
  const row = target();
  const drafts = new TranslationDrafts("es", "en", [row]);
  drafts.edit(row, "text", "Croqueta");
  drafts.edit(row, "defaultText", "Old English draft");
  const current = {
    ...row,
    selectedText: "Croqueta",
    effectiveSelectedText: "Croqueta",
    defaultText: "Current English",
    effectiveDefaultText: "Current English",
    defaultRequired: false,
    expected: "current",
  };
  drafts.snapshot([], [current]);
  drafts.review([current], new Map([["product:one", "keep"]]));
  expect(drafts.count).toBe(0);
  expect(drafts.value(row, "defaultText")).toBe("");
  expect(drafts.submission()).toEqual({ edits: [] });
});

const found = (overrides: Partial<RowSuggestion> = {}): RowSuggestion => ({
  ids: ["s"],
  text: null,
  defaultText: null,
  stale: false,
  placeholder: false,
  fixes: [],
  ...overrides,
});

describe("suggested drafts", () => {
  it("fills untouched eligible rows that have no text, and leaves a person's edit alone", () => {
    const one = target("one", { defaultRequired: false });
    const two = target("two", { defaultRequired: false });
    const off = target("off", {
      defaultRequired: false,
      eligible: false,
      unavailableReason: "inactive",
    });
    const named = target("named", { defaultRequired: false, effectiveSelectedText: "Pan" });
    const drafts = new TranslationDrafts("es", "en", [one, two, off, named]);
    drafts.edit(two, "text", "Mine");
    drafts.suggest(
      new Map([
        ["product:one", found({ ids: ["s1"], text: "CLIENT-es one" })],
        ["product:two", found({ ids: ["s2"], text: "CLIENT-es two" })],
        ["product:off", found({ ids: ["s3"], text: "CLIENT-es off" })],
        ["product:named", found({ ids: ["s4"], text: "CLIENT-es named" })],
      ]),
    );
    expect(drafts.value(one, "text")).toBe("CLIENT-es one");
    expect(drafts.isSuggested(one)).toBe(true);
    expect(drafts.isEdited(one)).toBe(false);
    expect(drafts.value(two, "text")).toBe("Mine");
    expect(drafts.isSuggested(two)).toBe(false);
    expect(drafts.value(off, "text")).toBe("");
    expect(drafts.value(named, "text")).toBe("");
    expect(drafts.suggestedCount).toBe(1);
    expect(drafts.count).toBe(2);
    expect(drafts.submission()).toEqual({
      edits: [
        { kind: "product", id: "one", expected: "baseline-one", text: "CLIENT-es one" },
        { kind: "product", id: "two", expected: "baseline-two", text: "Mine" },
      ],
    });
    expect(drafts.personalSubmission()).toEqual({
      edits: [{ kind: "product", id: "two", expected: "baseline-two", text: "Mine" }],
    });
  });
  it("skips a stale suggestion, a placeholder, and a missing default with no suggestion of its own", () => {
    const stale = target("stale", { defaultRequired: false });
    const placeholder = target("placeholder", { defaultRequired: false });
    const alone = target("alone");
    const both = target("both");
    const drafts = new TranslationDrafts("es", "en", [stale, placeholder, alone, both]);
    drafts.suggest(
      new Map([
        ["product:stale", found({ text: "CLIENT-es stale", stale: true })],
        ["product:placeholder", found({ placeholder: true })],
        ["product:alone", found({ text: "CLIENT-es alone" })],
        ["product:both", found({ text: "CLIENT-es both", defaultText: "CLIENT-en both" })],
      ]),
    );
    expect(drafts.suggestedCount).toBe(1);
    expect(drafts.value(alone, "text")).toBe("");
    expect(drafts.value(both, "defaultText")).toBe("CLIENT-en both");
    expect(drafts.submission()).toEqual({
      edits: [
        {
          kind: "product",
          id: "both",
          expected: "baseline-both",
          text: "CLIENT-es both",
          defaultText: "CLIENT-en both",
        },
      ],
    });
  });
  it("stops at 100 drafts counting a person's edits, and a freed place goes to the next row", () => {
    const rows = Array.from({ length: 102 }, (_, n) =>
      target(String(n), { defaultRequired: false }),
    );
    const drafts = new TranslationDrafts("es", "en", rows);
    drafts.edit(rows[101]!, "text", "Mine");
    drafts.suggest(
      new Map(
        rows.map((row) => [
          `product:${row.id}`,
          found({ ids: [`s${row.id}`], text: `CLIENT-es ${row.id}` }),
        ]),
      ),
    );
    expect(drafts.count).toBe(100);
    expect(drafts.suggestedCount).toBe(99);
    expect(drafts.isSuggested(rows[98]!)).toBe(true);
    expect(drafts.isSuggested(rows[99]!)).toBe(false);
    expect(drafts.unfilledCount).toBe(2);
    drafts.edit(rows[99]!, "text", "Other");
    expect(drafts.value(rows[99]!, "text")).toBe("");
    drafts.edit(rows[0]!, "text", "Changed");
    expect(drafts.value(rows[0]!, "text")).toBe("Changed");
    expect(drafts.count).toBe(100);
    drafts.unsuggest(rows[1]!);
    expect(drafts.isSuggested(rows[99]!)).toBe(true);
    expect(drafts.isSuggested(rows[100]!)).toBe(false);
    expect(drafts.unfilledCount).toBe(1);
  });
  it("an edited suggestion is the person's edit until it matches the suggestion again, and reset restores it", () => {
    const one = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one]);
    drafts.suggest(new Map([["product:one", found({ text: "CLIENT-es one" })]]));
    drafts.edit(one, "text", "Croqueta casera");
    expect(drafts.isSuggested(one)).toBe(false);
    expect(drafts.personalSubmission()).toEqual({
      edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "Croqueta casera" }],
    });
    drafts.edit(one, "text", "CLIENT-es one");
    expect(drafts.isSuggested(one)).toBe(true);
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
    drafts.edit(one, "text", "  ");
    expect(drafts.isSuggested(one)).toBe(false);
    expect(drafts.submission()).toEqual({ edits: [] });
    drafts.reset();
    expect(drafts.value(one, "text")).toBe("CLIENT-es one");
    expect(drafts.isSuggested(one)).toBe(true);
  });
  it("typing back to the suggestion after a refresh makes it a suggestion again", () => {
    const one = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one]);
    drafts.suggest(new Map([["product:one", found({ text: "CLIENT-es one" })]]));
    drafts.edit(one, "text", "Mine");
    drafts.snapshot([one], []);
    drafts.edit(one, "text", "CLIENT-es one");
    expect(drafts.isSuggested(one)).toBe(true);
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
  });
  it("a person's companion beside a suggested name keeps the suggested name", () => {
    const row = target("one");
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.suggest(
      new Map([["product:one", found({ text: "CLIENT-es one", defaultText: "CLIENT-en one" })]]),
    );
    drafts.edit(row, "defaultText", "Ham croquette");
    expect(drafts.personalSubmission()).toEqual({
      edits: [
        {
          kind: "product",
          id: "one",
          expected: "baseline-one",
          text: "CLIENT-es one",
          defaultText: "Ham croquette",
        },
      ],
    });
  });
  it("unsuggest empties the row and ignores that suggestion when read again, but not a new one", () => {
    const one = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one]);
    const first = new Map([["product:one", found({ ids: ["s1"], text: "CLIENT-es one" })]]);
    drafts.suggest(first);
    drafts.unsuggest(one);
    expect(drafts.value(one, "text")).toBe("");
    expect(drafts.suggestionFor(one)).toBeUndefined();
    drafts.suggest(first);
    expect(drafts.value(one, "text")).toBe("");
    drafts.suggest(new Map([["product:one", found({ ids: ["s9"], text: "CLIENT-es again" })]]));
    expect(drafts.value(one, "text")).toBe("CLIENT-es again");
  });
  it("unsuggest takes back from a person's edit each field they left as the suggestion filled it", () => {
    const typedName = target("one");
    const typedCompanion = target("two");
    const both = target("three");
    const drafts = new TranslationDrafts("es", "en", [typedName, typedCompanion, both]);
    drafts.suggest(
      new Map(
        ["one", "two", "three"].map((id) => [
          `product:${id}`,
          found({ ids: [`s-${id}`], text: `CLIENT-es ${id}`, defaultText: `CLIENT-en ${id}` }),
        ]),
      ),
    );
    drafts.edit(typedName, "text", "Mi nombre");
    drafts.edit(typedCompanion, "defaultText", "My name");
    drafts.edit(both, "text", "Pan");
    drafts.edit(both, "defaultText", "Bread");
    for (const row of [typedName, typedCompanion, both]) drafts.unsuggest(row);
    expect(drafts.value(typedName, "defaultText")).toBe("");
    expect(drafts.value(typedCompanion, "text")).toBe("");
    expect(drafts.personalSubmission()).toEqual({
      edits: [
        { kind: "product", id: "one", expected: "baseline-one", text: "Mi nombre" },
        { kind: "product", id: "two", expected: "baseline-two", text: "", defaultText: "My name" },
        {
          kind: "product",
          id: "three",
          expected: "baseline-three",
          text: "Pan",
          defaultText: "Bread",
        },
      ],
    });
  });
  it("unsuggest takes back what a deleted suggestion filled after a read stopped listing it, and nothing for another suggestion's deletion", () => {
    const row = target("one");
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.suggest(
      new Map([
        [
          "product:one",
          found({ ids: ["s1", "s2"], text: "CLIENT-es one", defaultText: "CLIENT-en one" }),
        ],
      ]),
    );
    drafts.edit(row, "text", "Mine");
    drafts.suggest(new Map());
    drafts.unsuggest(row, ["s7"]);
    expect(drafts.value(row, "defaultText")).toBe("CLIENT-en one");
    drafts.unsuggest(row, ["s2"]);
    expect(drafts.value(row, "defaultText")).toBe("");
    expect(drafts.personalSubmission()).toEqual({
      edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "Mine" }],
    });
  });
  it("unsuggest leaves an edit's borrowed text alone when the discarded suggestion is a later one it never borrowed from", () => {
    const row = target("one");
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.suggest(
      new Map([
        [
          "product:one",
          found({ ids: ["s1", "s2"], text: "CLIENT-es one", defaultText: "CLIENT-en one" }),
        ],
      ]),
    );
    drafts.edit(row, "text", "Mine");
    drafts.suggest(
      new Map([
        [
          "product:one",
          found({ ids: ["s5"], text: "CLIENT-es later", defaultText: "CLIENT-en later" }),
        ],
      ]),
    );
    drafts.unsuggest(row, ["s5"], ["s5"]);
    expect(drafts.value(row, "defaultText")).toBe("CLIENT-en one");
    expect(drafts.personalSubmission()).toEqual({
      edits: [
        {
          kind: "product",
          id: "one",
          expected: "baseline-one",
          text: "Mine",
          defaultText: "CLIENT-en one",
        },
      ],
    });
  });
  it("unsuggest ignores the row's suggestion once one of the discarded group is deleted, even after a read regrouped the row, but not a new one", () => {
    const row = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.suggest(new Map([["product:one", found({ ids: ["s0", "s1"], text: "CLIENT-es one" })]]));
    const regrouped = new Map([
      ["product:one", found({ ids: ["s1", "s5"], text: "CLIENT-es one" })],
    ]);
    drafts.suggest(regrouped);
    drafts.unsuggest(row, ["s0"], ["s0", "s1"]);
    expect(drafts.value(row, "text")).toBe("");
    expect(drafts.suggestionFor(row)).toBeUndefined();
    drafts.suggest(regrouped);
    expect(drafts.value(row, "text")).toBe("");
    drafts.suggest(new Map([["product:one", found({ ids: ["s9"], text: "CLIENT-es again" })]]));
    expect(drafts.value(row, "text")).toBe("CLIENT-es again");
  });
  it("unsuggest lets a new id a read grouped with the discarded ones fill the row once it comes alone", () => {
    const row = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.suggest(new Map([["product:one", found({ ids: ["s0", "s1"], text: "CLIENT-es one" })]]));
    drafts.suggest(new Map([["product:one", found({ ids: ["s1", "s5"], text: "CLIENT-es one" })]]));
    drafts.unsuggest(row, ["s0"], ["s0", "s1"]);
    expect(drafts.value(row, "text")).toBe("");
    drafts.suggest(new Map([["product:one", found({ ids: ["s5"], text: "CLIENT-es new" })]]));
    expect(drafts.value(row, "text")).toBe("CLIENT-es new");
  });
  it("unsuggest keeps a later read's suggestion out of the row while it groups a discarded id with new ones", () => {
    const row = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.suggest(new Map([["product:one", found({ ids: ["s0", "s1"], text: "CLIENT-es one" })]]));
    drafts.unsuggest(row, ["s0"], ["s0", "s1"]);
    drafts.suggest(new Map([["product:one", found({ ids: ["s1", "s7"], text: "CLIENT-es one" })]]));
    expect(drafts.value(row, "text")).toBe("");
    expect(drafts.suggestionFor(row)).toBeUndefined();
    drafts.suggest(new Map([["product:one", found({ ids: ["s7"], text: "CLIENT-es new" })]]));
    expect(drafts.value(row, "text")).toBe("CLIENT-es new");
  });
  it("unsuggest keeps every suggestion of the discarded group out of the row when no read had listed them yet", () => {
    const row = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.unsuggest(row, ["s0"], ["s0", "s1"]);
    drafts.suggest(new Map([["product:one", found({ ids: ["s1"], text: "CLIENT-es one" })]]));
    expect(drafts.value(row, "text")).toBe("");
    expect(drafts.suggestionFor(row)).toBeUndefined();
  });
  it("unsuggest leaves a row unedited when only the suggestion's text was left in it", () => {
    const row = target("one", { selectedText: "Croqueta" });
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.suggest(
      new Map([["product:one", found({ text: "CLIENT-es one", defaultText: "CLIENT-en one" })]]),
    );
    drafts.edit(row, "text", "Croqueta");
    expect(drafts.isEdited(row)).toBe(true);
    drafts.unsuggest(row);
    expect(drafts.isEdited(row)).toBe(false);
    expect(drafts.value(row, "text")).toBe("Croqueta");
    expect(drafts.submission()).toEqual({ edits: [] });
  });
  it("an edited row compares with the newest suggestion, not the one it was filled from", () => {
    const one = target("one", { defaultRequired: false });
    const two = target("two", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one, two]);
    drafts.suggest(
      new Map([
        ["product:one", found({ ids: ["s1"], text: "OLD one" })],
        ["product:two", found({ ids: ["s2"], text: "OLD two" })],
      ]),
    );
    drafts.edit(one, "text", "Mine");
    drafts.suggest(
      new Map([
        ["product:one", found({ ids: ["s9"], text: "NEW one" })],
        ["product:two", found({ ids: ["s8"], text: "NEW two" })],
      ]),
    );
    drafts.edit(one, "text", "OLD one");
    expect(drafts.isSuggested(one)).toBe(false);
    drafts.edit(one, "text", "NEW one");
    expect(drafts.isSuggested(one)).toBe(true);
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
  });
  it("unsuggest and markStale on a row with no suggestion leave the other rows filled", () => {
    const one = target("one", { defaultRequired: false });
    const bare = target("bare", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one, bare]);
    drafts.suggest(new Map([["product:one", found({ text: "CLIENT-es one" })]]));
    drafts.unsuggest(bare);
    drafts.markStale(bare);
    expect(drafts.isSuggested(one)).toBe(true);
    expect(drafts.suggestionFor(bare)).toBeUndefined();
  });
  it("markStale keeps the suggestion as out of date and fills nothing from it", () => {
    const one = target("one", { defaultRequired: false });
    const two = target("two", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one, two]);
    const index = new Map([
      ["product:one", found({ ids: ["s1"], text: "CLIENT-es one" })],
      ["product:two", found({ ids: ["s2"], text: "CLIENT-es two" })],
    ]);
    drafts.suggest(index);
    drafts.markStale(one);
    expect(drafts.value(one, "text")).toBe("");
    expect(drafts.suggestionFor(one)?.stale).toBe(true);
    expect(drafts.isSuggested(two)).toBe(true);
    drafts.suggest(index);
    expect(drafts.value(one, "text")).toBe("");
  });
  it("a suggested row in the scan is refreshed; one the scan stops listing goes, fill and all", () => {
    const listed = target("listed", { defaultRequired: false });
    const absent = target("absent", { defaultRequired: false });
    const drafts = new TranslationDrafts("ca", "ca", [listed, absent]);
    drafts.suggest(
      new Map([
        ["product:listed", found({ ids: ["s1"], text: "CLIENT-ca listed" })],
        ["product:absent", found({ ids: ["s2"], text: "CLIENT-ca absent" })],
      ]),
    );
    drafts.snapshot([listed, { ...absent, expected: "refreshed-absent" }], []);
    expect(drafts.rows.map((row) => row.id)).toEqual(["listed", "absent"]);
    expect(drafts.isSuggested(absent)).toBe(true);
    expect(drafts.submission().edits.map((edit) => edit.expected)).toEqual([
      "baseline-listed",
      "refreshed-absent",
    ]);
    drafts.snapshot([listed], []);
    expect(drafts.rows.map((row) => row.id)).toEqual(["listed"]);
    expect(drafts.count).toBe(1);
    drafts.snapshot([listed, absent], []);
    expect(drafts.arrivals).toBe(1);
    expect(drafts.isSuggested(absent)).toBe(false);
    drafts.review([listed, absent], new Map());
    expect(drafts.value(absent, "text")).toBe("CLIENT-ca absent");
  });
  it("a new default language is taken up while only suggestions are filled", () => {
    const row = target("one");
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.suggest(
      new Map([["product:one", found({ text: "CLIENT-es one", defaultText: "CLIENT-en one" })]]),
    );
    drafts.snapshot([{ ...row, expected: "new-default" }], [], "fr");
    expect(drafts.defaultLanguage).toBe("fr");
  });
  it("checks a suggested name's UTF-8 bytes like a typed one", () => {
    const one = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one]);
    drafts.suggest(new Map([["product:one", found({ text: "é".repeat(2049) })]]));
    expect(drafts.validate()).toEqual([
      { target: { kind: "product", id: "one" }, field: "text", message: "name_bytes" },
    ]);
  });
});

it("indexes each item's suggestions for the page language, its default and its notes", () => {
  const view = (overrides: Partial<ContentSuggestionView>): ContentSuggestionView => ({
    id: "s",
    kind: "product",
    itemId: "one",
    language: null,
    text: null,
    placeholder: false,
    fix: null,
    stale: false,
    cell: null,
    expected: null,
    ...overrides,
  });
  const views = [
    view({ id: "s1", language: "es", text: "CLIENT-es one" }),
    view({ id: "s2", language: "en", text: "CLIENT-en one", stale: true }),
    view({ id: "s3", fix: { field: "internal", wrong: "ZURRITO", right: "ZURITO" } }),
    view({ id: "s4", kind: "variant", placeholder: true }),
    view({
      id: "s5",
      itemId: "two",
      language: "ca",
      fix: { field: "ca", wrong: "Crocretes", right: "Croquetes" },
    }),
  ];
  expect(indexSuggestions(views, "es", "en")).toEqual(
    new Map([
      [
        "product:one",
        {
          ids: ["s1", "s2", "s3"],
          text: "CLIENT-es one",
          defaultText: "CLIENT-en one",
          stale: true,
          placeholder: false,
          fixes: [{ field: "internal", wrong: "ZURRITO", right: "ZURITO" }],
        },
      ],
      [
        "variant:one",
        { ids: ["s4"], text: null, defaultText: null, stale: false, placeholder: true, fixes: [] },
      ],
      [
        "product:two",
        {
          ids: ["s5"],
          text: null,
          defaultText: null,
          stale: false,
          placeholder: false,
          fixes: [{ field: "ca", wrong: "Crocretes", right: "Croquetes" }],
        },
      ],
    ]),
  );
  expect(indexSuggestions([views[1]!], "en", "en").get("product:one")).toMatchObject({
    text: "CLIENT-en one",
    defaultText: null,
    stale: true,
  });
});
