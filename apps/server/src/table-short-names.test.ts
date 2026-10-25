import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { resolveShortNames, type ShortNameEntry } from "./table-short-names.js";

const none: ReadonlyMap<string, string> = new Map();

function refusal(run: () => unknown): { code: string; params: unknown } {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const { code, params } = error as AppError;
    return { code, params };
  }
  throw new Error("expected a refusal");
}

describe("resolveShortNames", () => {
  it("proposes a short name for a new entry sent none", () => {
    expect(resolveShortNames([{ label: "Terrace 1" }], none)).toEqual(["T1"]);
  });

  it("keeps a sent short name, trimmed", () => {
    expect(resolveShortNames([{ label: "Terrace 1", shortName: " Tb1 " }], none)).toEqual(["Tb1"]);
  });

  it("keeps a stored short name when the save sends none and the name is unchanged", () => {
    const stored = { label: "Terrace 1", shortName: "Tb1" };
    expect(resolveShortNames([{ label: "Terrace 1", stored }], none)).toEqual(["Tb1"]);
    const storedNone = { label: "Terrace 1", shortName: null };
    expect(resolveShortNames([{ label: "Terrace 1", stored: storedNone }], none)).toEqual(["T1"]);
  });

  it("proposes again for a renamed table sent none", () => {
    const stored = { label: "Terrace 1", shortName: "Tb1" };
    expect(resolveShortNames([{ label: "Terrace 9", stored }], none)).toEqual(["T9"]);
  });

  it("a sent short name does not take an untouched table's stored one", () => {
    const kept: ShortNameEntry = {
      label: "Terrace 1",
      stored: { label: "Terrace 1", shortName: "T1" },
    };
    expect(
      refusal(() => resolveShortNames([kept, { label: "Table 1", shortName: "t1" }], none)),
    ).toEqual({
      code: "table.short_name_taken",
      params: { shortName: "t1", takenBy: "Terrace 1", field: "shortName" },
    });
    expect(resolveShortNames([{ label: "Table 1" }, kept], none)).toEqual([null, "T1"]);
  });

  it("refuses a sent short name another zone's table holds, ignoring case, naming that table", () => {
    const taken = new Map([["t1", "Terrace 1"]]);
    expect(
      refusal(() => resolveShortNames([{ label: "Table 1", shortName: "T1" }], taken)),
    ).toEqual({
      code: "table.short_name_taken",
      params: { shortName: "T1", takenBy: "Terrace 1", field: "shortName" },
    });
  });

  it("refuses the second of two entries sending one short name", () => {
    const entries = [
      { label: "Terrace 1", shortName: "T1" },
      { label: "Table 1", shortName: "t1" },
    ];
    expect(refusal(() => resolveShortNames(entries, none))).toEqual({
      code: "table.short_name_taken",
      params: { shortName: "t1", takenBy: "Terrace 1", field: "shortName" },
    });
  });

  it("a sent short name wins over a proposal, and the proposal's table gets none", () => {
    expect(
      resolveShortNames([{ label: "Terrace 1" }, { label: "Table 1", shortName: "T1" }], none),
    ).toEqual([null, "T1"]);
  });

  it("gives none, never another, when the proposal is taken", () => {
    expect(resolveShortNames([{ label: "Table 1" }], new Map([["t1", "Terrace 1"]]))).toEqual([
      null,
    ]);
    expect(resolveShortNames([{ label: "Window 1" }, { label: "Wall 1" }], none)).toEqual([
      "W1",
      null,
    ]);
  });

  it("lets two entries swap short names", () => {
    const entries = [
      { label: "A 1", shortName: "B1", stored: { label: "A 1", shortName: "A1" } },
      { label: "B 1", shortName: "A1", stored: { label: "B 1", shortName: "B1" } },
    ];
    expect(resolveShortNames(entries, none)).toEqual(["B1", "A1"]);
  });

  it.each(["", "   ", "ABCDEF", "é".repeat(6)])("refuses %j as tables.0.shortName", (shortName) => {
    expect(refusal(() => resolveShortNames([{ label: "Terrace 1", shortName }], none))).toEqual({
      code: "floor_plan.invalid",
      params: { field: "tables.0.shortName" },
    });
  });

  it.each(["ABCDE", "é".repeat(5)])("keeps %j, five characters", (shortName) => {
    expect(resolveShortNames([{ label: "Terrace 1", shortName }], none)).toEqual([shortName]);
  });
});
