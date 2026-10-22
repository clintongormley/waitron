import { expect, it } from "vitest";
import { VENUE_SERVICE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

it.each([
  ["department_sale_policies", "department_id", "d2"],
  ["zone_service_policies", "zone_id", "z2"],
  ["zone_sale_policies", "zone_id", "z2"],
] as const)("refuses an imported hierarchy with a missing %s row", (table, key, missing) => {
  const tables = {
    departments: [{ id: "d1" }, { id: "d2" }],
    floor_zones: [{ id: "z1" }, { id: "z2" }],
    department_sale_policies: [{ department_id: "d1" }, { department_id: "d2" }],
    zone_service_policies: [
      { zone_id: "z1", department_id: "d1" },
      { zone_id: "z2", department_id: "d2" },
    ],
    zone_sale_policies: [{ zone_id: "z1" }, { zone_id: "z2" }],
  } satisfies Record<string, Record<string, unknown>[]>;
  const incomplete: Record<string, Record<string, unknown>[]> = structuredClone(tables);
  incomplete[table] = incomplete[table]!.filter((row) => row[key] !== missing);
  expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(incomplete)).toThrowError(
    expect.objectContaining({ code: "setup.request_invalid", params: { field: table } }),
  );
  expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables)).not.toThrow();
});
