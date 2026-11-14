import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  insertInChunks,
  printAgents,
  printJobs,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { createPrinter } from "./printers.js";
import { claimPrintJobs, reportPrintJob } from "./runtime.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const dialect = new SQLiteSyncDialect();

async function fixture() {
  await seedVenue(suite.db, {
    name: "Print history",
    invoiceLocales: ["en-GB"],
    operationDescription: "Sale on premises",
  });
  return withTransaction(suite.db, async (tx) => {
    const [agent] = await tx
      .insert(printAgents)
      .values({ name: "Agent", tokenHash: "fixture" })
      .returning();
    const printer = await createPrinter(tx, {
      name: "Kitchen",
      transport: "network_tcp",
      host: "printer.test",
    });
    await insertInChunks(
      tx,
      printJobs,
      Array.from({ length: 256 }, () => ({
        id: randomUUID(),
        printerId: printer.id,
        payload: Buffer.alloc(20_000),
        status: "done" as const,
        createdAt: "2025-01-01T00:00:00.000Z",
      })),
    );
    return { agentId: agent!.id, printerId: printer.id };
  });
}

async function measuredClaim(
  tx: Transaction,
  agentId: string,
  printerId: string | undefined,
  invoice = false,
) {
  const statements = vi.spyOn(tx, "execute");
  const candidates = new Set<string>();
  const settlementCandidates = new Set<string>();
  const prepare = DatabaseSync.prototype.prepare;
  const observer = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    text,
  ) {
    if (text.trimStart().startsWith("update print_jobs as j")) {
      this.function("observe_settlement_kind", (id, kind) => {
        settlementCandidates.add(String(id));
        return kind;
      });
      return prepare.call(
        this,
        text.replaceAll("pending.kind", "observe_settlement_kind(pending.id, pending.kind)"),
      );
    }
    if (!text.trimStart().startsWith('update "print_jobs"')) return prepare.call(this, text);
    this.function("observe_claim_kind", (id, kind) => {
      candidates.add(String(id));
      return kind;
    });
    return prepare.call(this, text.replaceAll("j.kind", "observe_claim_kind(j.id, j.kind)"));
  });
  let jobs;
  const calls: Parameters<Transaction["execute"]>[0][] = [];
  try {
    jobs = await claimPrintJobs(tx, agentId, {
      visibleKeys: [],
      printerId,
      ...(invoice
        ? {
            invoiceReceiptsAt: "2026-11-06T12:00:00.000Z",
            invoiceReceiptsAheadAt: "2026-11-06T12:01:00.000Z",
          }
        : {}),
    });
  } finally {
    calls.push(...statements.mock.calls.map(([query]) => query));
    observer.mockRestore();
    statements.mockRestore();
  }
  const claims = calls
    .filter((query) => typeof query !== "string")
    .filter((query) => dialect.sqlToQuery(query.getSQL()).sql.includes('update "print_jobs"'));
  expect(claims).toHaveLength(1);
  const settlements = calls
    .filter((query) => typeof query !== "string")
    .filter((query) =>
      dialect.sqlToQuery(query.getSQL()).sql.trimStart().startsWith("update print_jobs as j"),
    );
  expect(settlements).toHaveLength(1);
  const settlementPlan = tx.execute<{ detail: string }>(
    sql`explain query plan ${settlements[0]!}`,
  ).rows;
  const query = claims[0]!;
  const plan = tx.execute<{ detail: string }>(sql`explain query plan ${query}`).rows;
  return {
    jobs,
    candidates,
    settlementCandidates,
    settlementPlan: settlementPlan.map((row) => row.detail),
    plan: plan.map((row) => row.detail),
  };
}

describe("print claims with delivered history", () => {
  it.each(
    [
      { specific: false, statistics: false },
      { specific: true, statistics: false },
      { specific: false, statistics: true },
      { specific: true, statistics: true },
    ].flatMap((variant) => [
      { ...variant, invoice: false },
      { ...variant, invoice: true },
    ]),
  )(
    "bounds empty pulls by printer and status ($specific, statistics: $statistics, invoice: $invoice)",
    async ({ specific, statistics, invoice }) => {
      const { agentId, printerId } = await fixture();
      await withTransaction(suite.db, async (tx) => {
        const other = await createPrinter(tx, {
          name: "Other",
          transport: "network_tcp",
          host: "other-printer.test",
        });
        const otherJobId = randomUUID();
        if (specific)
          await tx.insert(printJobs).values({
            id: otherJobId,
            printerId: other.id,
            payload: Buffer.from([1]),
            status: "queued",
            createdAt: "2025-01-01T00:00:00.000Z",
          });
        if (statistics) tx.execute(sql`analyze`);
        const result = await measuredClaim(tx, agentId, specific ? printerId : undefined, invoice);
        expect(result.jobs).toEqual([]);
        expect([...result.candidates]).toEqual([]);
        expect([...result.settlementCandidates]).toEqual(specific ? [otherJobId] : []);
        expect(result.settlementPlan.join("\n")).toMatch(
          /SEARCH pending USING INDEX print_jobs_pull_idx \(printer_id=\? AND status=\?\)/,
        );
        expect(result.settlementPlan.join("\n")).not.toMatch(/SCAN (?:j|pending)\b/);
        expect(result.plan.join("\n")).toMatch(
          /SEARCH (?:j|pending) USING INDEX print_jobs_pull_idx \(printer_id=\? AND status=\?\)/,
        );
        expect(result.plan.join("\n")).not.toMatch(/SCAN (?:j|pending|f)\b/);
      });
    },
  );

  it("keeps failed-printer priority, same-time insertion order and expired document recovery", async () => {
    const { agentId, printerId } = await fixture();
    await withTransaction(suite.db, async (tx) => {
      const other = await createPrinter(tx, {
        name: "Pass",
        transport: "network_tcp",
        host: "other-printer.test",
      });
      const ids = Array.from({ length: 7 }, () => randomUUID());
      const [retry, behindRetry, otherQueued, stale, firstTie, secondTie, drawer] = ids;
      await insertInChunks(
        tx,
        printJobs,
        ids.map((id, i) => ({
          id,
          printerId: i === 2 ? other.id : printerId,
          payload: Buffer.from([i]),
          kind: i === 6 ? ("drawer" as const) : ("document" as const),
          status:
            i === 0
              ? ("failed" as const)
              : i === 3 || i === 6
                ? ("printing" as const)
                : ("queued" as const),
          attempts: i === 0 ? 1 : 0,
          claimedAt: i === 3 || i === 6 ? "2025-01-01T00:00:00.000Z" : null,
          createdAt: `2025-01-01T00:00:0${Math.min(i, 4)}.000Z`,
        })),
      );
      const claimed = [];
      for (let i = 0; i < 6; i++) {
        const result = await measuredClaim(tx, agentId, undefined);
        expect(result.jobs).toHaveLength(1);
        const job = result.jobs[0]!;
        claimed.push(job.id);
        expect(
          await reportPrintJob(tx, { agentId, jobId: job.id, outcome: { status: "done" } }),
        ).toEqual({ updated: true });
      }
      expect(claimed).toEqual([otherQueued, retry, behindRetry, stale, firstTie, secondTie]);
      expect(await claimPrintJobs(tx, agentId, { visibleKeys: [] })).toEqual([]);
      const [uncertainDrawer] = await tx.select().from(printJobs).where(eq(printJobs.id, drawer!));
      expect(uncertainDrawer).toMatchObject({
        status: "failed",
        lastError: "print_job.drawer_outcome_unknown",
        attempts: 0,
        claimedAt: "2025-01-01T00:00:00.000Z",
        claimedBy: null,
      });
    });
  });
});
