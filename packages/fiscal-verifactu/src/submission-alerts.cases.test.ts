import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
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
