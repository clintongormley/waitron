import {
  CORE_MIGRATIONS,
  captureError,
  checkFailed,
  isUniqueViolation,
  roles,
} from "../../index.js";
import { useVenueDb } from "../../testing/venue-db.js";
import { expect, it } from "vitest";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it.each([
  { value: { builtInKey: "staff" as const, name: "Stored built-in" }, constraint: "roles_name_ck" },
  { value: { builtInKey: null, name: null }, constraint: "roles_name_ck" },
  {
    value: { builtInKey: "admin" as const, permissions: ["payment.take"] },
    constraint: "roles_admin_permissions_ck",
  },
])("refuses an invalid access-role shape: %j", async ({ value, constraint }) => {
  expect(
    checkFailed(await captureError(() => suite.db.insert(roles).values(value)), constraint),
  ).toBe(true);
});

it("keeps custom names unique under their folded spelling", async () => {
  await suite.db.insert(roles).values({ name: "Caf\u00e9", nameFolded: "cafe" });
  expect(
    isUniqueViolation(
      await captureError(() => suite.db.insert(roles).values({ name: "CAFE", nameFolded: "cafe" })),
    ),
  ).toBe(true);
});

it("accepts all built-in keys and refuses an unknown key", async () => {
  for (const builtInKey of ["staff", "supervisor", "manager", "admin"] as const)
    await suite.db.insert(roles).values({ builtInKey });
  expect(
    checkFailed(
      await captureError(() => suite.db.insert(roles).values({ builtInKey: "unknown" as "staff" })),
      "roles_built_in_key_ck",
    ),
  ).toBe(true);
});
