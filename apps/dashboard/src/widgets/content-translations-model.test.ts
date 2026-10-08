import { describe, expect, it } from "vitest";
import type { TranslationTarget } from "../api/client.js";
import { TranslationDrafts } from "./content-translations-model.js";

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
