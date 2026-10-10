import { describe, expect, it } from "vitest";
import {
  CORE_CONFIGURATION_TRANSFER,
  validateCoreConfiguration,
} from "./configuration-transfer.js";

const refusal = expect.objectContaining({
  code: "setup.request_invalid",
  params: { field: "table_service_statuses.color" },
});

function status(color?: unknown): Record<string, unknown> {
  const row: Record<string, unknown> = { id: "s1", label: "Bill requested" };
  if (color !== undefined) row.color = color;
  return row;
}

describe("validateCoreConfiguration", () => {
  it("refuses a status colour a save would refuse", () => {
    expect(() =>
      validateCoreConfiguration({ table_service_statuses: [status("red;position:fixed")] }),
    ).toThrowError(refusal);
  });

  it("refuses a status with no colour, which the column cannot store", () => {
    expect(() => validateCoreConfiguration({ table_service_statuses: [status()] })).toThrowError(
      refusal,
    );
  });

  it("accepts a named colour and a hex", () => {
    expect(() =>
      validateCoreConfiguration({ table_service_statuses: [status("amber"), status("#ef4444")] }),
    ).not.toThrow();
  });

  it("accepts a bundle with no statuses", () => {
    expect(() => validateCoreConfiguration({})).not.toThrow();
  });

  it("refuses a printer row marked deleted, which the exporter never sends", () => {
    expect(() =>
      validateCoreConfiguration({
        printers: [
          { id: "p1", deleted_at: null },
          { id: "p2", deleted_at: "2026-10-10T10:00:00.000Z" },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "printers.deleted_at" },
      }),
    );
  });

  it("accepts printer rows whose deleted mark is null or absent", () => {
    expect(() =>
      validateCoreConfiguration({ printers: [{ id: "p1", deleted_at: null }, { id: "p2" }] }),
    ).not.toThrow();
  });

  it("is the core transfer's validate", () => {
    expect(validateCoreConfiguration).toBeTypeOf("function");
    expect(CORE_CONFIGURATION_TRANSFER.validate).toBe(validateCoreConfiguration);
  });
});

describe("CORE_CONFIGURATION_TRANSFER", () => {
  it("leaves a deleted printer behind and never carries its poll credential", () => {
    expect(CORE_CONFIGURATION_TRANSFER.tables.find((table) => table.name === "printers")).toEqual({
      name: "printers",
      locationColumns: ["location_id"],
      omit: ["poll_token_hash"],
      reconnect: true,
      leaveBehindWhenSet: "deleted_at",
    });
  });
});
