import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ALL_MODULES } from "@waitron/composition";
import {
  deploymentTableExists,
  readDeploymentEnvironment,
  stampDeployment,
  type VenueDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { runCli } from "./cli.js";
import { applyVenue } from "./venue-apply.js";
import { readTenantIdentities } from "./tenant-guard.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const fields = {
  country: "ES",
  "tax-id": "B12345678",
  "legal-name": "Issuer SL",
  "taxpayer-domicile": "Calle Fiscal 8, 28013 Madrid",
  "location-name": "Venue",
  territory: "ES-common",
  locale: "es-ES",
  "operation-description": "Restaurant",
  "address-line1": "Calle Mayor 1",
  "address-line2": "Floor 2",
  "postal-code": "28001",
  city: "Madrid",
  province: "Madrid",
  "time-zone": "Europe/Madrid",
  "day-cutover": "06:00",
  "series-code": "A",
  "rectificative-code": "R",
  "admin-name": "Owner",
  "admin-email": "owner@example.test",
};

async function run(changes: Partial<typeof fields> = {}) {
  const lines: string[] = [];
  let closed = false;
  const code = await runCli(
    [
      "venue",
      "--venue-dir",
      "/fixture/venue",
      "--yes",
      ...Object.entries({ ...fields, ...changes }).flatMap(([key, value]) => [`--${key}`, value]),
    ],
    {
      io: {
        stdout: (line) => void lines.push(line),
        stderr: (line) => void lines.push(line),
        prompt: async () => {
          throw new Error("Unexpected prompt");
        },
        promptSecret: async () => {
          throw new Error("Unexpected secret prompt");
        },
        clearScreen() {},
      },
      env: { WAITRON_ADMIN_PIN: "4321", WAITRON_ADMIN_PASSWORD: "dashPass123" },
      openVenue: async () =>
        ({
          venue: suite.db,
          node: suite.db,
          close: async () => {
            closed = true;
          },
        }) as unknown as VenueDatabase,
      applyVenue,
      modules: ALL_MODULES,
      readEnvironment: readDeploymentEnvironment,
      readDeploymentTable: deploymentTableExists,
      stampEnvironment: stampDeployment,
      readTenants: readTenantIdentities,
    },
  );
  expect(closed).toBe(true);
  return { code, lines };
}
function retained() {
  return Object.fromEntries(
    [
      "tenants",
      "locations",
      "nodes",
      "invoice_series",
      "registro_sif",
      "contadores_instalacion",
    ].map((table) => [
      table,
      suite.db.all(sql`select * from ${sql.identifier(table)} order by rowid`),
    ]),
  );
}

it.each([
  ["location-name", "Another venue"],
  ["address-line1", "Calle Nueva 2"],
  ["address-line2", "Upper floor"],
  ["postal-code", "28014"],
  ["city", "Alcalá de Henares"],
  ["province", "Barcelona"],
  ["time-zone", "UTC"],
  ["day-cutover", "04:30"],
] as const)(
  "the real CLI refuses a changed %s and preserves venue identity and series",
  async (field, value) => {
    expect((await run()).code).toBe(0);
    const before = retained();
    const refusal = await run({ [field]: value });
    expect(refusal.code).toBe(1);
    expect(refusal.lines.filter((line) => line.startsWith("provisioning."))).toEqual([
      "provisioning.second_venue {}",
    ]);
    expect(retained()).toEqual(before);
    expect((await run()).code).toBe(0);
    expect(retained()).toEqual(before);
  },
);
