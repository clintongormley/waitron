import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { ADJUSTMENTS_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

/** A reason row as an export writes it: snake_case columns, booleans as 0 and 1, and each list
 * as the JSON text the column stores. */
function row(
  kind: "void" | "comp",
  noteRequired: 0 | 1,
  change: Record<string, unknown> = {},
): Record<string, unknown> {
  const isVoid = kind === "void";
  return {
    id: `${kind}-${noteRequired}`,
    kind,
    actions: JSON.stringify(isVoid ? ["cancel"] : ["comp", "discount_percent"]),
    max_percent: null,
    max_amount: null,
    apply_roles: JSON.stringify(isVoid ? [] : ["supervisor", "manager"]),
    approver_roles: JSON.stringify(isVoid ? [] : ["manager"]),
    note_required: noteRequired,
    ...change,
  };
}

/** The starter list's kinds and notes (`provisioning.ts`): five Void reasons, Other asking for a
 * note, then four Comp reasons. */
const STARTER = [
  row("void", 0),
  row("void", 0),
  row("void", 0),
  row("void", 0),
  row("void", 1),
  row("comp", 0),
  row("comp", 0),
  row("comp", 0),
  row("comp", 0),
];

function refusal(tables: Record<string, Record<string, unknown>[]>): unknown {
  try {
    ADJUSTMENTS_CONFIGURATION_TRANSFER.validate(tables);
  } catch (error) {
    return error instanceof AppError ? { code: error.code, params: error.params } : error;
  }
  return undefined;
}

const REFUSED = { code: "setup.request_invalid", params: { field: "adjustment_reasons" } };

function refusedAt(field: string) {
  return { code: "setup.request_invalid", params: { field } };
}

/** The starter list with one more reason, which every check below makes unholdable. */
function withExtra(extra: Record<string, unknown>) {
  return { adjustment_reasons: [...STARTER, extra] };
}

describe("ADJUSTMENTS_CONFIGURATION_TRANSFER", () => {
  it("transfers the reasons and the venue's discount limit, which are venue policy rather than trading history", () => {
    expect(ADJUSTMENTS_CONFIGURATION_TRANSFER).toEqual({
      kind: "tables",
      tables: [{ name: "adjustment_reasons" }, { name: "adjustment_settings" }],
      validate: expect.any(Function),
    });
  });

  it("passes the starter list", () => {
    expect(refusal({ adjustment_reasons: STARTER })).toBeUndefined();
  });

  it("refuses a bundle with no adjustment reasons table", () => {
    expect(refusal({ adjustment_settings: [] })).toEqual(REFUSED);
  });

  it("refuses a bundle with no Void reason", () => {
    expect(refusal({ adjustment_reasons: [row("comp", 1), row("comp", 0)] })).toEqual(REFUSED);
    expect(refusal({ adjustment_reasons: [] })).toEqual(REFUSED);
  });

  it("refuses a bundle whose Void reasons ask for no note", () => {
    expect(
      refusal({ adjustment_reasons: [row("void", 0), row("void", 0), row("comp", 1)] }),
    ).toEqual(REFUSED);
  });

  it("passes a bundle whose one Void reason asks for a note", () => {
    expect(refusal({ adjustment_reasons: [row("void", 1)] })).toBeUndefined();
  });

  it("refuses a bundle whose only note-taking Void reason cannot cancel", () => {
    expect(
      refusal({
        adjustment_reasons: [row("void", 1, { actions: JSON.stringify(["comp"]) }), row("void", 0)],
      }),
    ).toEqual(refusedAt("adjustment_reasons.actions"));
  });

  it.each([
    ["a Void reason that also comps", row("void", 0, { actions: '["cancel","comp"]' })],
    ["a Void reason with no action", row("void", 0, { actions: "[]" })],
    ["a Comp reason that cancels", row("comp", 0, { actions: '["comp","cancel"]' })],
    ["a Comp reason with no action", row("comp", 0, { actions: "[]" })],
    ["a Comp reason offering one action twice", row("comp", 0, { actions: '["comp","comp"]' })],
    ["an action no reason can offer", row("comp", 0, { actions: '["refund"]' })],
    ["actions that are not a list", row("comp", 0, { actions: '"comp"' })],
    ["actions that are not JSON", row("comp", 0, { actions: "comp" })],
    ["actions already parsed", row("comp", 0, { actions: ["comp"] })],
    ["no actions", row("comp", 0, { actions: undefined })],
  ])("refuses %s", (_, extra) => {
    expect(refusal(withExtra(extra))).toEqual(refusedAt("adjustment_reasons.actions"));
  });

  it.each([
    ["apply_roles", "a role that is not one", '["owner"]'],
    ["apply_roles", "a role twice", '["manager","manager"]'],
    ["apply_roles", "an empty list", "[]"],
    ["apply_roles", "a list holding a number", "[1]"],
    ["approver_roles", "a role that is not one", '["owner"]'],
    ["approver_roles", "a role twice", '["admin","admin"]'],
    ["approver_roles", "an empty list", "[]"],
  ])("refuses a Comp reason whose %s is %s", (column, _, value) => {
    expect(refusal(withExtra(row("comp", 0, { [column]: value })))).toEqual(
      refusedAt(`adjustment_reasons.${column}`),
    );
  });

  it.each([
    ["apply_roles", '["staff"]'],
    ["approver_roles", '["manager"]'],
  ])("refuses a Void reason with %s", (column, value) => {
    expect(refusal(withExtra(row("void", 0, { [column]: value })))).toEqual(
      refusedAt(`adjustment_reasons.${column}`),
    );
  });

  it("refuses a reason of no kind there is", () => {
    expect(refusal(withExtra(row("comp", 0, { kind: "refund" })))).toEqual(
      refusedAt("adjustment_reasons.kind"),
    );
  });

  it("refuses a Comp reason offering Free whose most off one item is under 100%", () => {
    expect(refusal(withExtra(row("comp", 0, { max_percent: 5000 })))).toEqual(
      refusedAt("adjustment_reasons.max_percent"),
    );
    expect(
      refusal(withExtra(row("comp", 0, { actions: '["discount_percent"]', max_percent: 5000 }))),
    ).toBeUndefined();
  });

  it.each([
    ["max_percent", 5000],
    ["max_amount", 500],
  ])("refuses a Void reason with a %s limit", (column, value) => {
    expect(refusal(withExtra(row("void", 0, { [column]: value })))).toEqual(
      refusedAt(`adjustment_reasons.${column}`),
    );
  });

  it("passes the venue's settings with a list of distinct roles", () => {
    expect(
      refusal({
        adjustment_reasons: STARTER,
        adjustment_settings: [
          { id: 1, max_bill_comp: 5000, bill_approver_roles: '["manager","admin"]' },
        ],
      }),
    ).toBeUndefined();
  });

  it.each([
    ["a role that is not one", '["owner"]'],
    ["a role twice", '["manager","manager"]'],
    ["an empty list", "[]"],
    ["text that is not JSON", "manager"],
    ["no list", undefined],
  ])("refuses settings whose bill approvers are %s", (_, value) => {
    expect(
      refusal({
        adjustment_reasons: STARTER,
        adjustment_settings: [{ id: 1, max_bill_comp: null, bill_approver_roles: value }],
      }),
    ).toEqual(refusedAt("adjustment_settings.bill_approver_roles"));
  });
});
