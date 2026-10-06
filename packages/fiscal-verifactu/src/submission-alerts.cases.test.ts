import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import {
  appendCancellation,
  appendPendingAlta,
  collideAtAeat,
  seedPendingEnvios,
  type SeededDrain,
} from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
import { openFilingCase, recordCaseEvent } from "./filing-cases.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const NOW = new Date("2026-07-21T12:00:00.000Z");
const EARLIER = new Date("2026-07-21T09:00:00.000Z");
const LATER = new Date("2026-07-21T10:00:00.000Z");
const PERSON = "33333333-3333-4333-8333-333333333333";
const EVIDENCE = { codigo: 1100, mensaje: "Campo obligatorio ausente", csv: "CSV-1" };

const openCasesAlert = () =>
  withTransaction(suite.db, async (tx) =>
    (await fiscalSubmissionSource.read({ tx, now: NOW })).filter(
      (alert) => alert.code === "fiscal.filing_cases_open",
    ),
  );

describe("fiscalSubmissionSource — open filing cases", () => {
  it("raises nothing while no case is open", async () => {
    await seedPendingEnvios(suite.db, { count: 1 });
    expect(await openCasesAlert()).toEqual([]);
  });

  it("errors with the count of open cases, since the oldest one opened, leaving resolved cases out", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const [resolvedOne, oldestOpen, newerOpen] = seeded.registroIds;
    await withTransaction(suite.db, async (tx) => {
      const resolved = await openFilingCase(tx, {
        registroId: resolvedOne!,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: new Date("2026-07-21T08:00:00.000Z"),
      });
      await recordCaseEvent(tx, {
        caseId: resolved.id,
        actionKey: "resolve",
        kind: "resolved",
        personId: PERSON,
        action: "Corrected with a new record",
        now: EARLIER,
      });
      await openFilingCase(tx, {
        registroId: oldestOpen!,
        cause: "fiscal.huella_divergente",
        evidence: EVIDENCE,
        now: EARLIER,
      });
      await openFilingCase(tx, {
        registroId: newerOpen!,
        cause: "fiscal.registro_rechazado",
        evidence: EVIDENCE,
        now: LATER,
      });
    });

    expect(await openCasesAlert()).toEqual([
      {
        key: "fiscal.filing_cases_open",
        code: "fiscal.filing_cases_open",
        params: { count: 2 },
        severity: "error",
        since: EARLIER.toISOString(),
      },
    ]);
  });

  it("counts a case with only notes as open", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await withTransaction(suite.db, async (tx) => {
      const opened = await openFilingCase(tx, {
        registroId: seeded.registroIds[0]!,
        cause: "fiscal.duplicado_anulado",
        evidence: EVIDENCE,
        now: LATER,
      });
      await recordCaseEvent(tx, {
        caseId: opened.id,
        actionKey: "note",
        kind: "note",
        personId: PERSON,
        action: "Asked the adviser",
        now: LATER,
      });
    });

    expect((await openCasesAlert()).map((alert) => alert.params)).toEqual([{ count: 1 }]);
  });
});

describe("fiscalSubmissionSource — a chain held after refusals with one code", () => {
  const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
  const at = (minutes: number) => new Date(SERVER_NOW.getTime() + minutes * 60_000);

  const fakeAeat = () => createFakeAeat({ serverNow: SERVER_NOW, tiempoEsperaInicial: 5 });
  type Aeat = ReturnType<typeof fakeAeat>;

  const runDrain = (aeat: Aeat, now: Date) =>
    drain(
      {
        db: suite.db,
        resolveClient: staticResolver(aeat.client()),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
      },
      now,
    );

  const refusalAlerts = () =>
    withTransaction(suite.db, async (tx) =>
      (await fiscalSubmissionSource.read({ tx, now: NOW })).filter(
        (alert) => alert.code === "fiscal.refusals_repeated",
      ),
    );

  async function estadoOf(registroId: string): Promise<string> {
    const { rows } = await suite.db.execute<{ estado: string }>(
      sql`select estado from envios where registro_id = ${registroId}`,
    );
    return rows[0]!.estado;
  }

  async function caseOpenedAt(registroId: string): Promise<string> {
    const { rows } = await suite.db.execute<{ opened_at: string }>(
      sql`select opened_at from filing_cases where registro_id = ${registroId}`,
    );
    return new Date(rows[0]!.opened_at).toISOString();
  }

  /** Appends one record per entry to `seeded`'s chain and files them in one envío at `now`: a
   * number is the code AEAT refuses that record with, `null` lets it be accepted. */
  async function fileOnChain(
    aeat: Aeat,
    seeded: SeededDrain,
    from: number,
    codes: (number | null)[],
    now: Date,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const [index, code] of codes.entries()) {
      const appended = await appendPendingAlta(suite.db, seeded, from + index);
      if (code !== null) aeat.reject(appended.facturaKey, code, `Rechazo ${code}`);
      ids.push(appended.registroId);
    }
    await runDrain(aeat, now);
    return ids;
  }

  /** An accept, a refusal with code 1200, then four refusals with code 1100 split over two
   * envíos, so neither envío's claim is held. */
  async function runOfFour(aeat: Aeat) {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await fileOnChain(aeat, seeded, 2, [1200, 1100, 1100], at(1));
    const [, lastRefusal] = await fileOnChain(aeat, seeded, 5, [1100, 1100], at(2));
    return { seeded, lastRefusal: lastRefusal! };
  }

  it("raises one error for the held chain, naming the code and the whole run, since the run's last refusal", async () => {
    const aeat = fakeAeat();
    const { seeded, lastRefusal } = await runOfFour(aeat);
    const held = await appendPendingAlta(suite.db, seeded, 7);
    await runDrain(aeat, at(3));
    expect(await estadoOf(held.registroId)).toBe("detenido");

    expect(await refusalAlerts()).toEqual([
      {
        key: `fiscal.refusals_repeated:${seeded.sifId}`,
        code: "fiscal.refusals_repeated",
        params: { codigo: "1100", count: 4 },
        severity: "error",
        since: await caseOpenedAt(lastRefusal),
      },
    ]);
    expect(await caseOpenedAt(lastRefusal)).toBe(at(2).toISOString());
  });

  it("raises one alert for a chain with two held records", async () => {
    const aeat = fakeAeat();
    const { seeded } = await runOfFour(aeat);
    const fifth = await appendPendingAlta(suite.db, seeded, 7);
    const sixth = await appendPendingAlta(suite.db, seeded, 8);
    await runDrain(aeat, at(3));
    expect([await estadoOf(fifth.registroId), await estadoOf(sixth.registroId)]).toEqual([
      "detenido",
      "detenido",
    ]);

    expect((await refusalAlerts()).map((alert) => alert.params)).toEqual([
      { codigo: "1100", count: 4 },
    ]);
  });

  it("ends the counted run at an accepted record even when it carries the run's code", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await fileOnChain(aeat, seeded, 2, [1100, 1100, 1100], at(1));
    // No accept the drain writes keeps a code; set one directly.
    await suite.db.execute(sql`
      update envios set codigo_error = '1100' where registro_id = ${seeded.registroIds[0]!}
    `);
    expect(await estadoOf(seeded.registroIds[0]!)).toBe("aceptado");
    const held = await appendPendingAlta(suite.db, seeded, 5);
    await runDrain(aeat, at(2));
    expect(await estadoOf(held.registroId)).toBe("detenido");

    expect((await refusalAlerts()).map((alert) => alert.params)).toEqual([
      { codigo: "1100", count: 3 },
    ]);
  });

  it("raises nothing for a run at the limit while no record is held yet", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await fileOnChain(aeat, seeded, 2, [1100, 1100, 1100], at(1));

    expect(await refusalAlerts()).toEqual([]);
  });

  it("raises nothing for a record held behind a run shorter than the limit", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [, refused] = await fileOnChain(aeat, seeded, 2, [1100, 1100], at(1));
    // A cancellation of a refused record is held, with no case of its own.
    const cancellation = await appendCancellation(suite.db, seeded, refused!, 4);
    await runDrain(aeat, at(2));
    expect(await estadoOf(cancellation)).toBe("detenido");

    expect(await refusalAlerts()).toEqual([]);
  });

  it("raises nothing when the chain's earliest held record is a conflict's, which has its own case", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    for (const secuencia of [2, 3, 4]) {
      const appended = await appendPendingAlta(suite.db, seeded, secuencia);
      aeat.reject(appended.facturaKey, 1100, "Rechazo 1100");
    }
    const conflicting = await appendPendingAlta(suite.db, seeded, 5);
    await collideAtAeat(suite.db, aeat, seeded, conflicting.registroId);
    await runDrain(aeat, at(1));
    const later = await appendPendingAlta(suite.db, seeded, 6);
    await runDrain(aeat, at(2));
    expect(await estadoOf(conflicting.registroId)).toBe("detenido");
    expect(await estadoOf(later.registroId)).toBe("detenido");

    expect(await refusalAlerts()).toEqual([]);
  });

  it("raises nothing for a record held behind a conflict, even after refusals in the conflict's own envío", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const conflicting = await appendPendingAlta(suite.db, seeded, 2);
    await collideAtAeat(suite.db, aeat, seeded, conflicting.registroId);
    const refused = await fileOnChain(aeat, seeded, 3, [1100, 1100, 1100], at(1));
    const later = await appendPendingAlta(suite.db, seeded, 6);
    await runDrain(aeat, at(2));
    expect(
      await Promise.all([conflicting.registroId, ...refused, later.registroId].map(estadoOf)),
    ).toEqual(["detenido", "rechazado", "rechazado", "rechazado", "detenido"]);

    expect(await refusalAlerts()).toEqual([]);
  });

  it("raises one alert per held chain", async () => {
    const aeat = fakeAeat();
    const first = await seedPendingEnvios(suite.db, { count: 1 });
    const second = await seedPendingEnvios(suite.db, {
      count: 1,
      identity: { locationId: first.locationId, nodeId: first.nodeId, nif: first.nif },
    });
    await fileOnChain(aeat, first, 2, [1100, 1100, 1100], at(1));
    await fileOnChain(aeat, second, 20_000, [1200, 1200, 1200], at(2));
    await appendPendingAlta(suite.db, first, 5);
    await appendPendingAlta(suite.db, second, 20_003);
    await runDrain(aeat, at(3));

    const alerts = await refusalAlerts();
    expect(alerts.map((alert) => [alert.key, alert.params])).toEqual(
      expect.arrayContaining([
        [`fiscal.refusals_repeated:${first.sifId}`, { codigo: "1100", count: 3 }],
        [`fiscal.refusals_repeated:${second.sifId}`, { codigo: "1200", count: 3 }],
      ]),
    );
    expect(alerts).toHaveLength(2);
  });
});
