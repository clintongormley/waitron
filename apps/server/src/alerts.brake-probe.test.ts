import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { DEFAULT_SKIP_RETRY_MS, FISCAL_ALERTS, drain } from "@waitron/fiscal-verifactu";
import type { DrainDeps } from "@waitron/fiscal-verifactu";
import {
  appendPendingAlta,
  seedPendingEnvios,
} from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import type { Logger } from "@waitron/server-kit";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";
import { createAlertRegistry, readOpenAlerts } from "./alerts.js";
import { ALL_ALERT_CLAIMS } from "./modules.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
const T0 = new Date("2026-07-21T00:01:00Z");
const T = new Date("2026-07-21T00:02:00Z");
const PROBE_AT = new Date("2026-07-21T01:02:00Z");
const RUN_CODE = 1100;

const noopLog: Logger = () => {};
const registry = createAlertRegistry({
  claims: ALL_ALERT_CLAIMS,
  sources: FISCAL_ALERTS.sources ?? [],
});

const deps = (client: VerifactuClient): DrainDeps => ({
  db: suite.db,
  resolveClient: () => Promise.resolve(client),
  skipRetryMs: DEFAULT_SKIP_RETRY_MS,
  environment: "production",
});

/** Every open alert a session holding `fiscal.view` is shown: incidents and ongoing checks. */
async function openAlerts(now: Date) {
  return withTransaction(suite.db, (tx) =>
    readOpenAlerts(tx, { registry, now, log: noopLog }, new Set(["fiscal.view"])),
  );
}

/** Three same-code refusals through the fake AEAT, then a record held behind them, which the
 * probe at `PROBE_AT` sends and AEAT refuses with `probeCode`. */
async function refusedProbe(probeCode: number) {
  const aeat = createFakeAeat({ serverNow: SERVER_NOW, tiempoEsperaInicial: 5 });
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  for (const key of seeded.facturaKeys) aeat.reject(key, RUN_CODE, `Rechazo ${RUN_CODE}`);
  await drain(deps(aeat.client()), T0);
  const held = await appendPendingAlta(suite.db, seeded, 4);
  await appendPendingAlta(suite.db, seeded, 5);
  await drain(deps(aeat.client()), T);
  aeat.reject(held.facturaKey, probeCode, `Rechazo ${probeCode}`);
  const before = await openAlerts(PROBE_AT);
  const probe = await drain(deps(aeat.client()), PROBE_AT);
  expect(probe.recordsSubmitted).toBe(1);
  const after = await openAlerts(PROBE_AT);
  return { sifId: seeded.sifId, before, after };
}

describe("the dashboard's open alerts across an hourly probe of a chain stopped by the same-code brake", () => {
  it("show no new key when the probe is refused with the run's code", async () => {
    const { sifId, before, after } = await refusedProbe(RUN_CODE);

    expect(before.map((a) => a.key)).toContain(`fiscal.refusals_repeated:${sifId}`);
    expect(after.map((a) => a.key).sort()).toEqual(before.map((a) => a.key).sort());
  });

  it("show the refusal's incident as a new key when the probe is refused with another code", async () => {
    const { before, after } = await refusedProbe(1200);

    const seen = new Set(before.map((a) => a.key));
    const added = after.filter((a) => !seen.has(a.key));
    // The released record waits again, so the delay check reports it too.
    expect(added.map((a) => [a.key.startsWith("incident:"), a.code])).toEqual([
      [true, "fiscal.registro_rechazado"],
      [false, "fiscal.submission_delayed"],
    ]);
  });
});
