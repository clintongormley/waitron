import "./errors.js";
import { AppError, compareDecimal, decimal } from "@waitron/shared";
import type { RefundEvidence, SettlementRecord, SettlementReportSource } from "@waitron/payments";
import type { SumUpClient, SumUpHistoryItem, SumUpTransaction } from "./client.js";
import { SumUpCloudProvider } from "./provider.js";
import { fromMajorUnits, refundOutcomeOf } from "./client.js";

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
) {
  const refundParents = new Map<string, string[]>();
  const unidentified: { amount: string | null; at: string | null }[] = [];
  const details = new Map<string, SumUpTransaction | null>();
  const lookup = async (id: string) => {
    if (!details.has(id)) details.set(id, await client.findTransaction({ id }));
    return details.get(id)!;
  };
  const source = {
    unreadableUnlinked: 0,
    retryRefunds: false,
    async fetchRefundEvidence(ids: readonly string[], now: Date): Promise<RefundEvidence> {
      const evidence: RefundEvidence = {
        complete: true,
        checkedAt: now.toISOString(),
        parents: [],
      };
      for (const id of new Set([...refundParents.keys(), ...ids])) {
        const parent: RefundEvidence["parents"][number] = {
          processorRef: id,
          events: [],
          ...(refundParents.get(id)?.length ? { observedAt: refundParents.get(id)! } : {}),
        };
        try {
          const t = id ? await lookup(id) : null;
          if (t?.timestamp && Number.isFinite(Date.parse(t.timestamp)))
            parent.capturedAt = new Date(t.timestamp).toISOString();
          if (!id) parent.issue = "missing_reference";
          else if (t === null) parent.issue = "not_found";
          else if (t.id !== id || t.currency !== "EUR") parent.issue = "invalid";
          else if (t.refundEvents === undefined) parent.issue = "missing_events";
          else {
            const unique = new Map(t.refundEvents.map((event) => [event.id, event]));
            const valid =
              !t.refundEvidenceInvalid &&
              t.refundEvents.every(
                (event) =>
                  typeof event.id === "string" &&
                  event.id !== "" &&
                  Number.isFinite(Date.parse(event.timestamp)) &&
                  compareDecimal(event.amount, decimal("0")) > 0 &&
                  refundOutcomeOf(event.status) === refundOutcomeOf(unique.get(event.id)!.status) &&
                  compareDecimal(event.amount, unique.get(event.id)!.amount) === 0 &&
                  Date.parse(event.timestamp) === Date.parse(unique.get(event.id)!.timestamp),
              );
            const classified = SumUpCloudProvider.classify(t, now);
            if (!valid) parent.issue = "invalid";
            else if (classified.kind !== "captured") {
              parent.issue = [...unique.values()].some((event) => event.status === "PENDING")
                ? "pending"
                : "invalid";
            } else
              parent.events = classified.refunds.map((event) => ({
                id: event.id,
                amount: event.amount,
                at: new Date(event.timestamp).toISOString(),
              }));
          }
        } catch {
          parent.issue = "read_failed";
        }
        if (parent.issue !== undefined) evidence.complete = false;
        if (parent.issue === "pending" || parent.issue === "read_failed")
          source.retryRefunds = true;
        evidence.parents.push(parent);
      }
      for (const row of unidentified)
        evidence.parents.push({
          processorRef: "",
          events: [],
          issue: "missing_reference",
          unidentified: row,
        });
      if (unidentified.length) evidence.complete = false;
      return evidence;
    },
    async fetch(
      window: Parameters<SettlementReportSource["fetch"]>[0],
      localReferences: readonly string[] = [],
    ) {
      source.unreadableUnlinked = 0;
      source.retryRefunds = false;
      refundParents.clear();
      unidentified.length = 0;
      details.clear();
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
          if (t.type === "REFUND") {
            const at =
              typeof t.timestamp === "string" && Number.isFinite(Date.parse(t.timestamp))
                ? new Date(t.timestamp).toISOString()
                : null;
            if (typeof t.transaction_id === "string" && t.transaction_id !== "") {
              const times = refundParents.get(t.transaction_id) ?? [];
              if (at !== null && !times.includes(at)) times.push(at);
              refundParents.set(t.transaction_id, times);
            } else
              unidentified.push({
                at,
                amount:
                  typeof t.amount === "number" && Number.isFinite(t.amount)
                    ? fromMajorUnits(t.amount)
                    : null,
              });
            continue;
          }
          if (t.status === "REFUNDED" && t.transaction_id && !refundParents.has(t.transaction_id))
            refundParents.set(t.transaction_id, []);
          if (!completed(t.status)) continue;
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
        if (next.length !== 1 || !next[0]!.href || /[/#\s]/.test(next[0]!.href)) throw incomplete();
        query = next[0]!.href.replace(/^\?/, "");
      }
      for (const id of known) {
        if (records.has(id)) continue;
        const t = await lookup(id);
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
