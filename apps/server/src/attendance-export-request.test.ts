import { describe, expect, it } from "vitest";
import {
  parseAttendanceExportQuery,
  parseAttendanceExportOptions,
} from "./attendance-export-request.js";

const locationId = "A1B2C3D4-1234-4234-9234-123456789ABC";
const personId = "B1B2C3D4-1234-4234-9234-123456789ABC";
const valid = () =>
  new URLSearchParams({
    locationId,
    from: "2020-01-01",
    before: "2026-02-01",
    format: "pdf",
    audience: "standard",
    locale: "en",
  });
describe("working-time export selection", () => {
  it("accepts arbitrary ranges over four years and normalizes references", () => {
    expect(parseAttendanceExportQuery(valid(), "own")).toEqual({
      selection: {
        locationId: locationId.toLowerCase(),
        from: "2020-01-01",
        before: "2026-02-01",
        format: "pdf",
        audience: "standard",
        locale: "en",
      },
    });
    const query = valid();
    query.set("personId", personId);
    query.set("format", "csv");
    query.set("audience", "representatives");
    query.set("locale", "es");
    expect(parseAttendanceExportQuery(query, "manager")).toEqual({
      selection: {
        locationId: locationId.toLowerCase(),
        from: "2020-01-01",
        before: "2026-02-01",
        format: "csv",
        audience: "representatives",
        locale: "es",
      },
      personId: personId.toLowerCase(),
    });
    expect(parseAttendanceExportQuery(valid(), "manager").personId).toBeUndefined();
  });
  it.each([
    ["2024-02-29", "2024-03-01"],
    ["2024-03-01", "2024-04-01"],
    ["0000-01-01", "9999-12-31"],
  ])("keeps the half-open calendar window %s to %s", (from, before) => {
    const q = valid();
    q.set("from", from);
    q.set("before", before);
    expect(parseAttendanceExportQuery(q, "own").selection).toMatchObject({ from, before });
  });
  it.each([
    ["from", "2026-02-01", "range"],
    ["from", "2027-01-01", "range"],
    ["from", "2026-02-29", "from"],
    ["from", "2026-02-30", "from"],
    ["from", "2026-01-01T00:00:00Z", "from"],
    ["before", "2026-02-30", "before"],
    ["before", "not-a-date", "before"],
    ["before", "2026-2-1", "before"],
    ["locationId", "not-a-uuid", "locationId"],
    ["format", "PDF", "format"],
    ["format", "xlsx", "format"],
    ["audience", "Standard", "audience"],
    ["audience", "all", "audience"],
    ["locale", "en-US", "locale"],
    ["locale", "ES", "locale"],
  ])("refuses %s=%s at %s", (key, value, field) => {
    const q = valid();
    q.set(key, value);
    expect(() => parseAttendanceExportQuery(q, "own")).toThrow(
      expect.objectContaining({ code: "management.request_invalid", params: { field } }),
    );
  });
  it.each(["locationId", "from", "before", "format", "audience", "locale"])(
    "refuses missing, blank and repeated %s",
    (key) => {
      const missing = valid();
      missing.delete(key);
      expect(() => parseAttendanceExportQuery(missing, "own")).toThrow(
        expect.objectContaining({ code: "management.request_invalid", params: { field: "query" } }),
      );
      const blank = valid();
      blank.set(key, "");
      expect(() => parseAttendanceExportQuery(blank, "own")).toThrow(
        expect.objectContaining({ code: "management.request_invalid", params: { field: key } }),
      );
      const repeated = valid();
      repeated.append(key, repeated.get(key)!);
      expect(() => parseAttendanceExportQuery(repeated, "manager")).toThrow(
        expect.objectContaining({ code: "management.request_invalid", params: { field: "query" } }),
      );
    },
  );
  it.each(["null", "all", "", "not-a-uuid"])("refuses an invalid manager person %j", (value) => {
    const q = valid();
    q.set("personId", value);
    expect(() => parseAttendanceExportQuery(q, "manager")).toThrow(
      expect.objectContaining({
        code: "management.request_invalid",
        params: { field: "personId" },
      }),
    );
  });
  it("refuses own person injection, unknown keys and repeated optional person", () => {
    for (const [mode, key] of [
      ["own", "personId"],
      ["manager", "override"],
      ["own", "nodeId"],
    ] as const) {
      const q = valid();
      q.set(key, personId);
      expect(() => parseAttendanceExportQuery(q, mode)).toThrow(
        expect.objectContaining({ code: "management.request_invalid", params: { field: "query" } }),
      );
    }
    const q = valid();
    q.append("personId", personId);
    q.append("personId", personId);
    expect(() => parseAttendanceExportQuery(q, "manager")).toThrow(
      expect.objectContaining({ code: "management.request_invalid", params: { field: "query" } }),
    );
  });
  it("options accepts exactly one valid location reference", () => {
    expect(parseAttendanceExportOptions(new URLSearchParams({ locationId }))).toBe(
      locationId.toLowerCase(),
    );
    for (const raw of [
      "",
      `locationId=${locationId}&locationId=${locationId}`,
      `locationId=${locationId}&personId=${personId}`,
    ])
      expect(() => parseAttendanceExportOptions(new URLSearchParams(raw))).toThrow(
        expect.objectContaining({ code: "management.request_invalid", params: { field: "query" } }),
      );
    expect(() => parseAttendanceExportOptions(new URLSearchParams({ locationId: "bad" }))).toThrow(
      expect.objectContaining({
        code: "management.request_invalid",
        params: { field: "locationId" },
      }),
    );
  });
});
