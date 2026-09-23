import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDrainResult } from "@waitron/fiscal";
import { enabledModules } from "@waitron/module";
import { venueFiscalSelection, type VenueRequest } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { fiscalReadinessDatabaseKey, submitFiscalReadiness } from "./fiscal-readiness-runner.js";
import type { FiscalReadinessInput } from "./fiscal-readiness.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const venue: VenueRequest = {
  country: "GB",
  taxId: "123456789",
  legalName: "Readiness Ltd",
  location: {
    name: "Prepared",
    fiscalTerritory: "GB-vat",
    invoiceLocales: ["en-GB"],
    operationDescription: "Restaurant",
    addressLine1: "1 High Street",
    addressLine2: null,
    postalCode: "SW1A 1AA",
    city: "London",
    province: "London",
    timeZone: "Europe/London",
    dayCutover: "06:00",
  },
  tillName: "Till",
  seriesCode: "F",
  rectificativeSeriesCode: "R",
  admin: { displayName: "Admin", email: "admin@example.test", pinHash: "pin", passwordHash: "pw" },
};

describe("fiscal readiness submission runner", () => {
  it("uses every activation-bound input when selecting the retained test database", () => {
    const input: FiscalReadinessInput = {
      requirement: "accepted-test-submission",
      fiscalModule: "verifactu",
      country: "ES",
      taxId: "B12345678",
      legalName: "Ready SL",
      fiscalTerritory: "ES-common",
      submissionTarget: "https://preproduction.example.test/soap",
      certificateFingerprint: "cert-one",
      certificateKind: "sello",
      moduleVersions: { core: 1 },
      applicationVersion: "1.0.0",
    };
    const original = fiscalReadinessDatabaseKey(input);
    expect(fiscalReadinessDatabaseKey({ ...input, legalName: "Changed SL" })).not.toBe(original);
    expect(fiscalReadinessDatabaseKey({ ...input, moduleVersions: { core: 2 } })).not.toBe(
      original,
    );
    expect(fiscalReadinessDatabaseKey({ ...input, applicationVersion: "1.0.1" })).not.toBe(
      original,
    );
    expect(
      fiscalReadinessDatabaseKey({
        ...input,
        submissionTarget: "https://other-preproduction.example.test/soap",
      }),
    ).not.toBe(original);
  });

  it("records the sample in an isolated retained database before asking the fiscal slot to drain", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-runner-"));
    dirs.push(stateDir);
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const modules = enabledModules(ALL_MODULES, selected.config);
    const drain = vi.fn().mockResolvedValue({ ...emptyDrainResult(), recordsAccepted: 1 });
    const contribution = {
      ...selected.contribution!,
      activationReadiness: "accepted-test-submission" as const,
      drain,
    };
    await expect(
      submitFiscalReadiness({
        stateDir,
        modules,
        venue,
        contribution,
        secret: undefined,
        ring: {} as never,
        readinessInput: {
          requirement: "accepted-test-submission",
          fiscalModule: contribution.id,
          country: venue.country,
          taxId: venue.taxId,
          legalName: venue.legalName,
          fiscalTerritory: venue.location.fiscalTerritory,
          submissionTarget: contribution.activationReadinessTarget?.(undefined) ?? null,
          certificateFingerprint: null,
          certificateKind: null,
          moduleVersions: { core: 1 },
          applicationVersion: "0.0.0",
        },
        now: () => new Date("2026-09-09T12:00:00.000Z"),
      }),
    ).resolves.toBe("accepted");
    expect(drain).toHaveBeenCalledOnce();
    expect(drain.mock.calls[0]![0]).toMatchObject({
      environment: "preproduction",
      skipRetryMs: 0,
    });
  });

  it("surfaces a local setup failure instead of reporting an uncertain authority response", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-runner-local-error-"));
    dirs.push(stateDir);
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const modules = enabledModules(ALL_MODULES, selected.config);
    const contribution = {
      ...selected.contribution!,
      activationReadiness: "accepted-test-submission" as const,
      makeBackend: () => {
        throw new Error("local backend misconfigured");
      },
    };

    await expect(
      submitFiscalReadiness({
        stateDir,
        modules,
        venue,
        contribution,
        secret: undefined,
        ring: {} as never,
        readinessInput: {
          requirement: "accepted-test-submission",
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
        },
      }),
    ).rejects.toThrow("local backend misconfigured");
  });
  /**
   * The retained sample database holds a REAL preproduction sale on a REAL chain, so the tables the
   * modules declare append-only have to refuse a rewrite here exactly as they do on the box
   * (CLAUDE.md §5). This runner migrates with `runMigrations` set by set rather than through
   * `applyMigrations`, which is where the product installs the triggers — so nothing else in the
   * tree covers this path.
   *
   * Read through a raw `node:sqlite` connection rather than the runner's own handle, which it
   * closes: the triggers belong to the FILE, so reopening it is what proves they were persisted and
   * not merely installed on a session.
   */
  it("leaves the retained sample database refusing to rewrite the sale it recorded", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-runner-append-only-"));
    dirs.push(stateDir);
    const selected = venueFiscalSelection(ALL_MODULES, venue.location.fiscalTerritory);
    const modules = enabledModules(ALL_MODULES, selected.config);
    const contribution = {
      ...selected.contribution!,
      activationReadiness: "accepted-test-submission" as const,
      drain: vi.fn().mockResolvedValue({ ...emptyDrainResult(), recordsAccepted: 1 }),
    };
    const readinessInput: FiscalReadinessInput = {
      requirement: "accepted-test-submission",
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

    await submitFiscalReadiness({
      stateDir,
      modules,
      venue,
      contribution,
      secret: undefined,
      ring: {} as never,
      readinessInput,
      now: () => new Date("2026-09-09T12:00:00.000Z"),
    });

    const connection = new DatabaseSync(
      join(
        stateDir,
        `fiscal-readiness-db-${fiscalReadinessDatabaseKey(readinessInput)}`,
        "venue.db",
      ),
    );
    try {
      // The row first: a `FOR EACH ROW` trigger on an EMPTY table refuses nothing, so without this
      // the case would pass with no trigger installed at all.
      expect(connection.prepare("select count(*) as n from sales").get()?.n).toBe(1);
      // `locale` is written back as it stands, not changed: `sales_locale_member_ck` ties it to a
      // member of `invoice_locales`, so any other value is refused by the CHECK before a trigger is
      // reached (measured — `'xx-XX'` gives `CHECK constraint failed: sales_locale_member_ck`).
      // `BEFORE UPDATE` fires on the statement whatever the value, which the control below says:
      // with the install deleted this same statement succeeds and nothing throws.
      expect(() => connection.exec("update sales set locale = 'en-GB'")).toThrow(
        /sales is append-only/,
      );
    } finally {
      connection.close();
    }
  });
});
