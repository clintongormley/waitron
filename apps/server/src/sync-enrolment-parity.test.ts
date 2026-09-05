import { ENROLLED } from "@waitron/sync";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "./modules.js";

const SHARED = (e: {
  table: string;
  mode: string;
  conflictKey: string[];
  watermarkColumn: string | null;
  captureOps: string[];
  fkRank: number;
  lane: string;
}) => ({
  table: e.table,
  mode: e.mode,
  conflictKey: e.conflictKey,
  watermarkColumn: e.watermarkColumn,
  captureOps: e.captureOps,
  fkRank: e.fkRank,
  lane: e.lane,
});

describe("assembled module enrolment equals the central ENROLLED (behaviour-preserving)", () => {
  const assembled = ALL_MODULES.flatMap((m) => m.sync ?? []);
  it("covers exactly ENROLLED's 22 tables with identical metadata", () => {
    const byAssembled = new Map(assembled.map((e) => [e.table, SHARED(e)]));
    const byCentral = new Map(ENROLLED.map((e) => [e.table, SHARED(e)]));
    expect([...byAssembled.keys()].sort()).toEqual([...byCentral.keys()].sort());
    expect(assembled).toHaveLength(22);
    for (const [table, central] of byCentral) expect(byAssembled.get(table)).toEqual(central);
  });
});
