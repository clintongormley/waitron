import "./errors.js";
import { AppError, compareDecimal, decimal } from "@waitron/shared";
import type { SettlementRecord, SettlementReportSource } from "@waitron/payments";
import type { SumUpClient, SumUpHistoryItem, SumUpTransaction } from "./client.js";
import { fromMajorUnits } from "./client.js";

type AuditCandidate = {
  state: string;
  paymentRef: string;
  externalRef: string | null;
  workingOrderId: string;
};
const incomplete = () => new AppError("payment.audit_incomplete", { providerId: "sumup" });
const completed = (status: string | undefined) => status === "SUCCESSFUL" || status === "REFUNDED";

function recordOf(t: SumUpTransaction): SettlementRecord {
  if (
    typeof t.id !== "string" ||
    t.id === "" ||
    !completed(t.status) ||
    t.currency !== "EUR" ||
    compareDecimal(t.amount, decimal("0")) <= 0 ||
    typeof t.timestamp !== "string" ||
    !Number.isFinite(Date.parse(t.timestamp))
  )
    throw incomplete();
  return { references: [t.id], amount: t.amount, settledAt: new Date(t.timestamp) };
}

function historyRecord(t: SumUpHistoryItem): SettlementRecord {
  if (typeof t.amount !== "number" || !Number.isFinite(t.amount) || t.type !== "PAYMENT")
    throw incomplete();
  return recordOf({
    id: t.transaction_id!,
    status: t.status!,
    amount: fromMajorUnits(t.amount),
    ...(t.currency === undefined ? {} : { currency: t.currency }),
    ...(t.timestamp === undefined ? {} : { timestamp: t.timestamp }),
  });
}

export function sumupSettlementReport(
  client: SumUpClient,
  candidates: readonly AuditCandidate[] = [],
): SettlementReportSource & { unreadableUnlinked: number } {
  const source = {
    unreadableUnlinked: 0,
    async fetch(
      window: Parameters<SettlementReportSource["fetch"]>[0],
      localReferences: readonly string[] = [],
    ) {
      source.unreadableUnlinked = 0;
      const known = new Set(localReferences);
      const records = new Map<string, SettlementRecord>();
      const pages = new Set<string>();
      let query = new URLSearchParams({
        limit: "100",
        order: "ascending",
        oldest_time: window.from.toISOString(),
        newest_time: window.to.toISOString(),
      }).toString();
      while (true) {
        const canonical = new URLSearchParams(query);
        canonical.sort();
        if (pages.has(canonical.toString())) throw incomplete();
        pages.add(canonical.toString());
        const page = await client.historyPage(query);
        if (
          !page ||
          !Array.isArray(page.items) ||
          (page.links !== undefined && !Array.isArray(page.links))
        )
          throw incomplete();
        const links = page.links ?? [];
        for (const t of page.items) {
          if (!t || typeof t !== "object") {
            source.unreadableUnlinked++;
            continue;
          }
          if (t.type === "REFUND" || !completed(t.status)) continue;
          try {
            const record = historyRecord(t);
            if (record.settledAt < window.from || record.settledAt >= window.to) continue;
            const id = record.references[0]!;
            const prior = records.get(id);
            if (
              known.has(id) &&
              prior !== undefined &&
              (prior.amount !== record.amount ||
                prior.settledAt.getTime() !== record.settledAt.getTime())
            )
              throw incomplete();
            records.set(id, record);
          } catch (error) {
            if (known.has(t.transaction_id!)) throw error;
            source.unreadableUnlinked++;
          }
        }
        if (
          links.some(
            (link) => !link || typeof link.rel !== "string" || typeof link.href !== "string",
          )
        )
          throw incomplete();
        const next = links.filter((link) => link.rel === "next");
        if (next.length === 0) break;
        if (next.length !== 1 || !next[0]!.href || /[\/#\s]/.test(next[0]!.href))
          throw incomplete();
        query = next[0]!.href.replace(/^\?/, "");
      }
      for (const id of known) {
        if (records.has(id)) continue;
        const t = await client.findTransaction({ id });
        if (t === null) continue;
        if (t.id !== id) throw incomplete();
        if (t.status === "PENDING" || t.status === "CANCELLED" || t.status === "FAILED") continue;
        records.set(id, recordOf(t));
      }
      for (const row of candidates) {
        if (row.state !== "failed") continue;
        const t = await client.findTransaction(
          row.externalRef === null
            ? { foreignTransactionId: row.paymentRef }
            : { clientTransactionId: row.externalRef },
        );
        if (t === null || !completed(t.status)) continue;
        const record = recordOf(t);
        if (t.foreignTransactionId !== undefined && t.foreignTransactionId !== row.paymentRef)
          throw incomplete();
        const prior = records.get(t.id);
        if (prior?.hint !== undefined && prior.hint.paymentRef !== row.paymentRef) {
          delete prior.hint;
          continue;
        }
        records.set(t.id, {
          ...record,
          hint: { workingOrderId: row.workingOrderId, paymentRef: row.paymentRef },
        });
      }
      return [...records.values()];
    },
  };
  return source;
}
