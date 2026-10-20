import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openVenueDatabase } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { registroSif } from "@waitron/fiscal-verifactu";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { locationId, nodeId } from "@waitron/shared";
import { mintBreakGlassSecret } from "../src/break-glass.js";
import { writeAllocationInput } from "../src/testing/allocation-input.js";
import { registerTill } from "./register-till.js";
import { provisionTestVenue, type TestVenue } from "./testing/venue.js";

describe("historical register-till against a real venue directory", () => {
  let workDir: string;
  let venueDir: string;
  let venue: TestVenue;
  let secret: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-register-till-"));
    // Reachable two ways: named by WAITRON_VENUE_DIR, and derived from WAITRON_STATE_DIR.
    venueDir = join(workDir, "venue");
    await applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));
    venue = await provisionTestVenue(venueDir, "50000000K");
    const store = await openVenueDatabase(venueDir);
    try {
      secret = await mintBreakGlassSecret(store.venue, venue.nodeId);
    } finally {
      await store.close();
    }
  }, 180_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  async function sifHistory(): Promise<{ numeroInstalacion: string; live: boolean }[]> {
    const store = await openVenueDatabase(venueDir);
    try {
      const rows = await store.venue
        .select({
          numeroInstalacion: registroSif.numeroInstalacion,
          revocadoEn: registroSif.revocadoEn,
        })
        .from(registroSif)
        .where(eq(registroSif.nodeId, venue.nodeId))
        .orderBy(registroSif.registradoEn);
      return rows.map((r) => ({
        numeroInstalacion: r.numeroInstalacion,
        live: r.revocadoEn === null,
      }));
    } finally {
      await store.close();
    }
  }

  async function recoveryEnv(identity: string) {
    const fixture = allocationFixture({
      node: { nodeId: nodeId(venue.nodeId), locationId: locationId(venue.locationId) },
      taxpayerNif: "50000000K",
      identity,
      recoveryKey: true,
      bases: [
        { code: "A", purpose: "standard" },
        { code: "FF", purpose: "full" },
        { code: "R", purpose: "rectificative" },
      ],
    });
    const environment = await writeAllocationInput(workDir, fixture, "re-register");
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    return { ...environment, WAITRON_NODE_RECOVERY_KEY: secret };
  }

  it("provisioning already left exactly one live SIF, so a second one can only come from here", async () => {
    // The control: without it the assertions below would pass on a directory never opened.
    expect(await sifHistory()).toEqual([{ numeroInstalacion: "S000001", live: true }]);
  });

  it("re-registers the node in the directory WAITRON_VENUE_DIR names", async () => {
    const seeded = await registerTill(venue.nodeId, {
      ...(await recoveryEnv("P000042")),
      WAITRON_VENUE_DIR: venueDir,
    });
    expect(seeded.map((s) => s.module)).toContain("fiscal-verifactu");
    // The previous identity is retired, not edited: old registros keep pointing at it (CLAUDE.md §5).
    expect(await sifHistory()).toEqual([
      { numeroInstalacion: "S000001", live: false },
      { numeroInstalacion: "P000042", live: true },
    ]);
  });

  it("finds the same directory from WAITRON_STATE_DIR alone", async () => {
    const seeded = await registerTill(venue.nodeId, {
      ...(await recoveryEnv("P000043")),
      WAITRON_STATE_DIR: workDir,
    });
    expect(seeded.map((s) => s.module)).toContain("fiscal-verifactu");
    expect(await sifHistory()).toEqual([
      { numeroInstalacion: "S000001", live: false },
      { numeroInstalacion: "P000042", live: false },
      { numeroInstalacion: "P000043", live: true },
    ]);
  });

  it("refuses a node the venue does not hold, by its domain code", async () => {
    await expect(
      registerTill("00000000-0000-4000-8000-000000000000", { WAITRON_VENUE_DIR: venueDir }),
    ).rejects.toMatchObject({ code: "node.not_found" });
    const history = await sifHistory();
    expect(history).toHaveLength(3);
    expect(history.at(-1)).toEqual({ numeroInstalacion: "P000043", live: true });
  });

  it("leaves exactly one live SIF after every re-registration", async () => {
    const store = await openVenueDatabase(venueDir);
    try {
      const live = await store.venue
        .select({ id: registroSif.id })
        .from(registroSif)
        .where(and(eq(registroSif.nodeId, venue.nodeId), isNull(registroSif.revocadoEn)));
      expect(live).toHaveLength(1);
    } finally {
      await store.close();
    }
  });
});

vi.mock("../src/modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules.js")>();
  const { FISCAL_OPERATIONS: historicalFiscalOperations } =
    await import("@waitron/fiscal-verifactu/src/allocation-configuration.js");
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu"
        ? { ...module, operations: historicalFiscalOperations }
        : module,
    ),
  };
});
