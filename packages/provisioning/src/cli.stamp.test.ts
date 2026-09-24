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
 * `venue` against a real migrated venue database and the REAL `stampDeployment`. `cli.test.ts`'s
 * `stampEnvironment` is a recorder, so this file is what shows what the stamp writes, leaves alone
 * and refuses (CLAUDE.md §5). `applyVenue` stays injected: the mint has its own suite
 * (`venue-apply.e2e.test.ts`).
 */
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const VENUE_RESULT = {
  locationId: "22222222-2222-2222-2222-222222222222",
  tillId: "33333333-3333-3333-3333-333333333333",
  nodeId: "44444444-4444-4444-4444-444444444444",
  seriesIds: [],
  seeded: [],
} as unknown as VenueResult;

/** No fiscal-slot member, so the territory's own field rules are skipped. */
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
    // A production box provisioned by a script whose WAITRON_ENV is unset.
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
