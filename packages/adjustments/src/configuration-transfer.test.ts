import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { ADJUSTMENTS_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

/** A reason row as an export writes it: snake_case columns, booleans as 0 and 1. */
function row(kind: "void" | "comp", active: 0 | 1, noteRequired: 0 | 1) {
  return { id: `${kind}-${active}-${noteRequired}`, kind, active, note_required: noteRequired };
}

/** The starter list's kinds and notes (`provisioning.ts`): five Void reasons, Other asking for a
 * note, then four Comp reasons. */
const STARTER = [
  row("void", 1, 0),
  row("void", 1, 0),
  row("void", 1, 0),
  row("void", 1, 0),
  row("void", 1, 1),
  row("comp", 1, 0),
  row("comp", 1, 0),
  row("comp", 1, 0),
  row("comp", 1, 0),
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

describe("ADJUSTMENTS_CONFIGURATION_TRANSFER", () => {
  it("transfers the reasons and the venue's discount limit, which are venue policy rather than trading history", () => {
    const { kind, tables } = ADJUSTMENTS_CONFIGURATION_TRANSFER;
    expect({ kind, tables }).toEqual({
      kind: "tables",
      tables: [{ name: "adjustment_reasons" }, { name: "adjustment_settings" }],
    });
  });

  it("passes the starter list", () => {
    expect(refusal({ adjustment_reasons: STARTER })).toBeUndefined();
  });

  it("refuses a bundle with no adjustment reasons table", () => {
    expect(refusal({ adjustment_settings: [] })).toEqual(REFUSED);
  });

  it("refuses a bundle with no Void reason", () => {
    expect(refusal({ adjustment_reasons: [row("comp", 1, 1), row("comp", 1, 0)] })).toEqual(
      REFUSED,
    );
    expect(refusal({ adjustment_reasons: [] })).toEqual(REFUSED);
  });

  it("refuses a bundle whose only Void reasons are switched off", () => {
    expect(
      refusal({ adjustment_reasons: [row("void", 0, 1), row("void", 0, 0), row("comp", 1, 1)] }),
    ).toEqual(REFUSED);
  });

  it("refuses a bundle whose switched-on Void reasons ask for no note", () => {
    expect(
      refusal({ adjustment_reasons: [row("void", 1, 0), row("void", 0, 1), row("comp", 1, 1)] }),
    ).toEqual(REFUSED);
  });

  it("passes a bundle whose one switched-on Void reason asks for a note", () => {
    expect(refusal({ adjustment_reasons: [row("void", 1, 1)] })).toBeUndefined();
  });
});
