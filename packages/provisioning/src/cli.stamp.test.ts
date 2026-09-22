import { describe, expect, it, vi } from "vitest";
import {
  deploymentTableExists,
  readDeploymentEnvironment,
  stampDeployment,
  type VenueDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import type { WaitronModule } from "@waitron/module";
import { runCli } from "./cli.js";
import type { CliDeps } from "./cli.js";
import { readTenantIdentities } from "./tenant-guard.js";
import type { VenueResult } from "./venue-apply.js";

/**
 * `venue`'s stamping, against a REAL migrated venue database and the REAL `stampDeployment` —
 * the primitive, not a double of it.
 *
 * `cli.test.ts` records WHETHER `venue` stamps, with what, and in what order relative to the prompt
 * and the apply; its `stampEnvironment` is a recorder, so it can say nothing about what the
 * primitive does with the value. This file is the other half: what the stamp WRITES, what it leaves
 * alone, and what it refuses. That refusal is the fiscal invariant — one database per environment,
 * and a pre-production database promoted to production leaves a permanent hole in the invoice series
 * (CLAUDE.md §5) — so it is checked here against the same function the browser setup wizard's
 * handler calls (`provisionVenue`, `apps/server/src/provision.ts`), rather than against a copy of
 * its rule.
 *
 * The full manifest is migrated because `venue` reads `tenants` through the real
 * `readTenantIdentities`. `applyVenue` stays injected: the mint has its own suite
 * (`venue-apply.e2e.test.ts`), and what is under test here is what happens to the `deployment` row.
 * The per-test reset empties `deployment` with everything else, so each case starts unstamped.
 */
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

/** The ids the injected apply hands back — never read here beyond proving the apply ran. */
const VENUE_RESULT = {
  locationId: "22222222-2222-2222-2222-222222222222",
  tillId: "33333333-3333-3333-3333-333333333333",
  nodeId: "44444444-4444-4444-4444-444444444444",
  seriesIds: [],
  seeded: [],
} as unknown as VenueResult;

/** No fiscal-slot member: this file never mints a SIF, so the slot resolves to nothing and the
 * territory's own field rules are skipped — the same list `cli.test.ts` runs with. */
const MODULES: readonly WaitronModule[] = [fakeModule("core")];

const VENUE_ARGS = [
  "venue",
  "--venue-dir",
  "/var/lib/waitron/venue",
  "--country",
  "ES",
  "--tax-id",
  "B12345678",
  "--legal-name",
  "Acme SL",
  "--location-name",
  "Centro",
  "--territory",
  "ES-common",
  "--locale",
  "es-ES",
  "--operation-description",
  "Restaurante",
  "--address-line1",
  "Calle Mayor 1",
  "--postal-code",
  "28001",
  "--city",
  "Madrid",
  "--province",
  "Madrid",
  "--time-zone",
  "Europe/Madrid",
  "--day-cutover",
  "06:00",
  "--till-name",
  "Barra 1",
  "--series-code",
  "A",
  "--rectificative-code",
  "R",
  "--admin-name",
  "Owner",
  "--admin-email",
  "owner@example.test",
  "--yes",
];

interface Run {
  code: number;
  lines: string[];
  applyVenue: ReturnType<typeof vi.fn>;
}

/** One `venue` run against the migrated suite database, with every deployment seam REAL. */
async function run(env: Record<string, string | undefined>): Promise<Run> {
  const lines: string[] = [];
  const applyVenue = vi.fn(async () => VENUE_RESULT);
  const store = {
    venue: suite.db,
    node: suite.db,
    close: async () => {},
  } as unknown as VenueDatabase;
  const deps: CliDeps = {
    io: {
      stdout: (line) => void lines.push(line),
      stderr: (line) => void lines.push(line),
      prompt: async () => "",
      promptSecret: async () => "",
      clearScreen: () => {},
    },
    env: { WAITRON_ADMIN_PIN: "4321", WAITRON_ADMIN_PASSWORD: "dashPass123", ...env },
    openVenue: async () => store,
    applyVenue: applyVenue as unknown as CliDeps["applyVenue"],
    modules: MODULES,
    readEnvironment: readDeploymentEnvironment,
    readDeploymentTable: deploymentTableExists,
    stampEnvironment: stampDeployment,
    readTenants: readTenantIdentities,
  };
  return { code: await runCli(VENUE_ARGS, deps), lines, applyVenue };
}

describe("venue, stamping a real venue database", () => {
  it("stamps an unstamped directory with what WAITRON_ENV resolved to", async () => {
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
    const { code, applyVenue } = await run({});
    expect(code).toBe(0);
    // Unset means preproduction — the one irreversible default (CLAUDE.md §5).
    expect(await readDeploymentEnvironment(suite.db)).toBe("preproduction");
    expect(applyVenue).toHaveBeenCalledTimes(1);
  });

  it("stamps production only when production is typed out", async () => {
    const { code } = await run({ WAITRON_ENV: "production" });
    expect(code).toBe(0);
    expect(await readDeploymentEnvironment(suite.db)).toBe("production");
  });

  it("leaves a directory already stamped for the same environment alone, and applies", async () => {
    await stampDeployment(suite.db, "production");
    const { code, applyVenue } = await run({ WAITRON_ENV: "production" });
    expect(code).toBe(0);
    expect(await readDeploymentEnvironment(suite.db)).toBe("production");
    expect(applyVenue).toHaveBeenCalledTimes(1);
  });

  it("REFUSES a directory stamped for the other environment, applying nothing", async () => {
    // The live-box case: a production box provisioned by a script whose WAITRON_ENV is unset. The
    // stamp must not move, and no venue may be minted under the disagreement.
    await stampDeployment(suite.db, "production");
    const { code, lines, applyVenue } = await run({});
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain(
      'deployment.already_stamped {"stamped":"production","requested":"preproduction"}',
    );
    expect(await readDeploymentEnvironment(suite.db)).toBe("production");
    expect(applyVenue).not.toHaveBeenCalled();
  });

  it("refuses the other direction too — a preproduction directory asked for production", async () => {
    await stampDeployment(suite.db, "preproduction");
    const { code, lines, applyVenue } = await run({ WAITRON_ENV: "production" });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain(
      'deployment.already_stamped {"stamped":"preproduction","requested":"production"}',
    );
    expect(await readDeploymentEnvironment(suite.db)).toBe("preproduction");
    expect(applyVenue).not.toHaveBeenCalled();
  });

  it("WAITRON_ENV=dev stamps preproduction, so a dev box provisions without changing it", async () => {
    const { code } = await run({ WAITRON_ENV: "dev" });
    expect(code).toBe(0);
    expect(await readDeploymentEnvironment(suite.db)).toBe("preproduction");
  });
});
