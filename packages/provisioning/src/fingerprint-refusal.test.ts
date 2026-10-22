import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { enabledModules } from "@waitron/module";
import { venueFiscalSelection, type VenueRequest } from "./index.js";
import { fiscalReadinessDatabaseKey, submitFiscalReadiness } from "./fiscal-readiness-runner.js";

vi.mock("@waitron/verifactu", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/verifactu")>();
  return {
    ...real,
    buildAltaRecord: (...args: Parameters<typeof real.buildAltaRecord>) => {
      const record = real.buildAltaRecord(...args);
      record.Huella = (record.Huella[0] === "A" ? "B" : "A") + record.Huella.slice(1);
      return record;
    },
  };
});

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

it("a readiness fingerprint refusal persists its incident and never drains", async () => {
  directory = await mkdtemp(join(tmpdir(), "a1003-readiness-"));
  const venue: VenueRequest = {
    country: "ES",
    taxId: "50000000R",
    legalName: "Readiness Ltd",
    location: {
      name: "Main",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant",
      addressLine1: "1 Market Street",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
    },
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Admin",
      email: "admin@example.test",
      pinHash: "pin",
      passwordHash: "password",
    },
  };
  const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
  const modules = enabledModules(ALL_MODULES, selected.config);
  const drain = vi.fn(() => {
    throw new Error("a refused readiness sample must not drain");
  });
  const contribution = { ...selected.contribution!, provisioningSecret: undefined, drain };
  const readinessInput = {
    requirement: "accepted-test-submission" as const,
    fiscalModule: contribution.id,
    country: venue.country,
    taxId: venue.taxId,
    legalName: venue.legalName,
    fiscalTerritory: venue.location.fiscalTerritory,
    submissionTarget: null,
    certificateFingerprint: null,
    certificateKind: null,
    moduleVersions: { core: 1 },
    applicationVersion: "0.0.0",
  };
  await expect(
    submitFiscalReadiness({
      stateDir: directory,
      modules,
      venue,
      contribution,
      secret: undefined,
      ring: {} as never,
      readinessInput,
      clock: () => ({
        now: () => ({
          instant: new Date("2026-03-01T12:00:00Z"),
          offsetMinutes: 60,
          confident: true,
          confidence: "anchored",
          anchorAgeSeconds: 0,
        }),
        anchor: () => {
          throw new Error("unused");
        },
        currentAnchor: () => null,
      }),
      now: () => new Date("2026-03-01T12:00:00Z"),
    }),
  ).rejects.toMatchObject({ code: "fiscal.fingerprint_mismatch", params: {} });
  expect(drain).not.toHaveBeenCalled();
  const db = new DatabaseSync(
    join(
      directory,
      `fiscal-readiness-db-${fiscalReadinessDatabaseKey(readinessInput)}`,
      "venue.db",
    ),
    { readOnly: true },
  );
  try {
    expect(db.prepare("select code, sale_id, source from incidents").all()).toEqual([
      { code: "fiscal.fingerprint_mismatch", sale_id: null, source: "readiness_test" },
    ]);
    for (const table of ["sales", "registros_facturacion", "envios"]) {
      if (!/^[a-z_]+$/.test(table)) throw new Error("invalid snapshot identifier");
      expect(db.prepare(`select count(*) as count from "${table}"`).get()).toEqual({ count: 0 });
    }
    expect(db.prepare("select distinct next_number from invoice_series").all()).toEqual([
      { next_number: 1 },
    ]);
  } finally {
    db.close();
  }
});
