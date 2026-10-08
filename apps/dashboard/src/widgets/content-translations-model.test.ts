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
