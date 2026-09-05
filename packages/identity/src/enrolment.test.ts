import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { persons, webauthnCredentials } from "./schema/index.js";
import { IDENTITY_ENROLMENT } from "./enrolment.js";

const byName = new Map(IDENTITY_ENROLMENT.map((e) => [e.table, e]));

describe("IDENTITY_ENROLMENT", () => {
  it("enrols persons and webauthn_credentials", () => {
    expect([...byName.keys()].sort()).toEqual(["persons", "webauthn_credentials"]);
  });
  it("persons: insert+update, no delete grant; webauthn_credentials: insert+update+delete", () => {
    expect(byName.get("persons")).toMatchObject({
      mode: "watermark-upsert",
      watermarkColumn: null,
      captureOps: ["insert", "update"],
      fkRank: 0,
      lane: "ordered",
    });
    expect(byName.get("webauthn_credentials")).toMatchObject({
      mode: "watermark-upsert",
      watermarkColumn: null,
      captureOps: ["insert", "update", "delete"],
      fkRank: 1,
      lane: "ordered",
    });
  });
  it("columns are derived from the schema", () => {
    expect(byName.get("persons")!.columns).toEqual(
      Object.values(getTableColumns(persons)).map((c) => c.name),
    );
    expect(byName.get("webauthn_credentials")!.columns).toEqual(
      Object.values(getTableColumns(webauthnCredentials)).map((c) => c.name),
    );
  });
  it("every non-null watermarkColumn is a real column of its table", () => {
    for (const e of IDENTITY_ENROLMENT) {
      if (e.watermarkColumn !== null) expect(e.columns).toContain(e.watermarkColumn);
    }
  });
  it("both tables are config-class (membership Slice 7, R-S7-1)", () => {
    expect(byName.get("persons")!.configClass).toBe(true);
    expect(byName.get("webauthn_credentials")!.configClass).toBe(true);
  });
});
