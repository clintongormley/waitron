import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_ALERTS } from "@waitron/fiscal-verifactu";
import { seedWaitingRecords, stopRecord } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import type { Logger } from "@waitron/server-kit";
import { createAlertRegistry, readOpenAlerts } from "./alerts.js";
import { ALL_ALERT_CLAIMS } from "./modules.js";
import { alertSourcesFor, type FiscalDrainPolicy } from "./onboarding-policy.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// A day after the seeded records were generated, well past the four-hour warning.
const NOW = new Date("2026-07-21T19:20:30Z");
const noopLog: Logger = () => {};

const DEMO: FiscalDrainPolicy = {
  environment: "production",
  onboardingIntent: "demo",
  fiscalTestSubmissions: false,
};
const PRODUCTION: FiscalDrainPolicy = {
  environment: "production",
  onboardingIntent: "live",
  fiscalTestSubmissions: false,
};

/** Fiscal alert codes shown to a `fiscal.view` holder, the registry built as boot builds it. */
async function fiscalCodes(policy: FiscalDrainPolicy): Promise<string[]> {
  const registry = createAlertRegistry({
    claims: ALL_ALERT_CLAIMS,
    sources: alertSourcesFor(FISCAL_ALERTS.sources ?? [], policy),
  });
  const alerts = await withTransaction(suite.db, (tx) =>
    readOpenAlerts(tx, { registry, now: NOW, log: noopLog }, new Set(["fiscal.view"])),
  );
  return alerts.map((alert) => alert.code).sort();
}

/** One record waiting to be sent and one whose sending stopped. */
async function waitingAndStopped(): Promise<void> {
  const { recordIds } = await seedWaitingRecords(suite.db, { count: 2 });
  await stopRecord(suite.db, recordIds[1]!);
}

describe("the fiscal alerts of a box by whether its policy sends records", () => {
  it("leaves out the delayed alert, and keeps the stopped one, on a Demo box", async () => {
    await waitingAndStopped();
    expect(await fiscalCodes(DEMO)).toEqual(["fiscal.submission_stopped"]);
  });

  it("shows both on a production box", async () => {
    await waitingAndStopped();
    expect(await fiscalCodes(PRODUCTION)).toEqual([
      "fiscal.submission_delayed",
      "fiscal.submission_stopped",
    ]);
  });
});
