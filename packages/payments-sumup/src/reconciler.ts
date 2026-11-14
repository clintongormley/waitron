import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import {
  claimAbandonedCapture,
  getPaymentByRef,
  listAbandonedRefundOutcomes,
  listReconcilable,
  recordRefund,
  existingReferences,
  listAuditCandidates,
  listBackupPayments,
  listRefundAuditRows,
  listPaymentAuditRuns,
  reconcilePayments,
} from "@waitron/payments";
import type {
  BackupPaymentMatch,
  BackupPaymentUnmatched,
  HeldAlertSink,
  IncidentSink,
  PaymentReconciler,
  ReconcilePeriod,
  ReconcileMoneyGates,
  SettlementRecord,
} from "@waitron/payments";
import { SumUpCloudProvider } from "./provider.js";
import { DOCUMENTED_REFUND_REFUSALS } from "./client.js";
import type { SumUpClient, SumUpTransaction } from "./client.js";
import { sumupSettlementReport } from "./report-source.js";

export class SumUpReconciler implements PaymentReconciler {
  readonly provider = "sumup";
  constructor(
    private readonly deps: {
      db: Database;
      resolveClient: () => Promise<SumUpClient>;
      incidents: IncidentSink;
      heldAlerts: HeldAlertSink;
      reconcileMoney?: ReconcileMoneyGates;
    },
  ) {}
  async reconcile(period: ReconcilePeriod, now: Date) {
    const client = await this.deps.resolveClient();
    const evidence = async (paymentRef: string, ref: string, amount: string) => {
      try {
        const t = await client.findTransaction({ id: ref });
        if (
          !t ||
          t.id !== ref ||
          t.foreignTransactionId !== paymentRef ||
          t.currency !== "EUR" ||
          compareDecimal(t.amount, decimal(amount)) !== 0 ||
          !t.timestamp ||
          !Number.isFinite(Date.parse(t.timestamp)) ||
          t.refundEvents === undefined ||
          t.refundEvents.some((event) => !event.id || !Number.isFinite(Date.parse(event.timestamp)))
        )
          return undefined;
        const classified = SumUpCloudProvider.classify(t, now);
        return classified.kind === "captured"
          ? { transaction: t, refunds: classified.refunds }
          : undefined;
      } catch {
        return undefined;
      }
    };
    const paused = () => this.deps.reconcileMoney?.paused() ?? Promise.resolve(false);
    const admit = (tx: Transaction) => this.deps.reconcileMoney?.admit(tx) ?? Promise.resolve(true);
    const confirm = async (
      paymentRef: string,
      ref: string,
      amount: string,
      supplied?: NonNullable<Awaited<ReturnType<typeof evidence>>>,
    ) => {
      if (await paused()) return false;
      const proof = supplied ?? (await evidence(paymentRef, ref, amount));
      if (
        !proof ||
        compareDecimal(sumDecimals(proof.refunds.map((row) => row.amount)), decimal(amount)) !==
          0 ||
        (await paused())
      )
        return false;
      return withTransaction(this.deps.db, async (tx) => {
        if (!(await admit(tx))) return false;
        const key = { provider: this.provider, paymentRef };
        const row = await getPaymentByRef(tx, key);
        if (row?.state === "refunded") return true;
        if (row?.state !== "captured" && row?.state !== "partially_refunded") return false;
        const prior =
          (await listRefundAuditRows(tx, this.provider, period, [ref])).find(
            (entry) => entry.paymentRef === paymentRef,
          )?.refunds ?? [];
        if (
          prior.some(
            (row) =>
              !row.providerRefundRef ||
              !proof.refunds.some(
                (event) =>
                  event.id === row.providerRefundRef &&
                  compareDecimal(event.amount, row.amount) === 0,
              ),
          )
        )
          return false;
        const recorded = new Set(prior.map((row) => row.providerRefundRef));
        for (const refund of proof.refunds) {
          if (recorded.has(refund.id)) continue;
          await recordRefund(tx, {
            ...key,
            amount: refund.amount,
            providerRefundRef: refund.id,
            at: new Date(refund.timestamp),
          });
        }
        return true;
      });
    };
    // Markers survive period changes and failed history reads; this path only looks up refunds.
    const marked = await withTransaction(this.deps.db, (tx) =>
      listAbandonedRefundOutcomes(tx, this.provider),
    );
    for (const row of marked)
      if (row.outcome === "unconfirmed" && row.externalRef !== null)
        await confirm(row.paymentRef, row.externalRef, row.amount);
    const prepared = new Map<string, { record: SettlementRecord; transaction: SumUpTransaction }>();
    const pad = (ms: number) => ({
      from: new Date(period.from.getTime() - ms),
      to: new Date(period.to.getTime() + ms),
    });
    const { candidates, nearbyCandidates, manual, refundRows, backupRefundRefs, captured } =
      await withTransaction(this.deps.db, async (tx) => {
        const refundRows = await listRefundAuditRows(tx, this.provider, period);
        const manualRefs = new Set(
          refundRows
            .filter(
              (row) => row.provider === "manual" && row.externalProvider === "connected_account",
            )
            .map((row) => row.paymentRef),
        );
        const prior = await listPaymentAuditRuns(
          tx,
          this.provider,
          refundRows.flatMap((row) =>
            manualRefs.has(row.paymentRef) && row.settledAt !== null
              ? [-300_000, 0, 300_000].map(
                  (offset) =>
                    `${new Date(Date.parse(row.settledAt!) + offset).toISOString().slice(0, 10)}T00:00:00.000Z`,
                )
              : [],
          ),
        );
        const links = new Map<string, Set<string>>();
        for (const run of prior)
          for (const match of (run.summary?.backupMatches ?? []) as BackupPaymentMatch[])
            if (manualRefs.has(match.paymentRef))
              links.set(
                match.paymentRef,
                new Set([...(links.get(match.paymentRef) ?? []), ...match.references]),
              );
        return {
          captured: (await listReconcilable(tx, this.provider, period)).filter(
            (row) => row.workingOrderStatus === "abandoned" && row.reconcileRemediatedAt === null,
          ),
          candidates: await listAuditCandidates(tx, this.provider, period),
          nearbyCandidates: await listAuditCandidates(tx, this.provider, pad(600_000)),
          manual: await listBackupPayments(tx, pad(600_000)),
          refundRows,
          backupRefundRefs: [...links.values()].flatMap((refs) =>
            refs.size === 1 ? [...refs] : [],
          ),
        };
      });
    const source = sumupSettlementReport(client, nearbyCandidates);
    const originalCandidates = new Set(candidates.map((row) => row.paymentRef));
    const thisDb = this.deps.db;
    let retryOrphans = false;
    const prepareEvidence = async (records: SettlementRecord[]) => {
      const barred = await paused();
      for (const record of records) {
        const paymentRef =
          record.hint?.paymentRef ??
          captured.find(
            (row) => row.externalRef !== null && record.references.includes(row.externalRef),
          )?.paymentRef;
        if (!paymentRef) continue;
        if (barred) {
          retryOrphans = true;
          continue;
        }
        const proof = await evidence(paymentRef, record.references[0]!, record.amount);
        if (!proof && originalCandidates.has(paymentRef)) retryOrphans = true;
        if (
          proof &&
          (proof.transaction.refundEvents!.length === 0 ||
            compareDecimal(sumDecimals(proof.refunds.map((row) => row.amount)), record.amount) ===
              0)
        )
          prepared.set(paymentRef, { record, transaction: proof.transaction });
      }
    };
    const backupMatches: BackupPaymentMatch[] = [];
    const backupUnmatched: BackupPaymentUnmatched[] = [];
    const report = {
      async fetch(window: ReconcilePeriod, localReferences: readonly string[] = []) {
        const records = await source.fetch(
          {
            from: new Date(window.from.getTime() - 600_000),
            to: new Date(window.to.getTime() + 600_000),
          },
          localReferences,
        );
        const existing = await withTransaction(thisDb, (tx) =>
          existingReferences(
            tx,
            "sumup",
            records.flatMap((row) => row.references),
          ),
        );
        const outside = records.filter(
          (row) => row.hint === undefined && !row.references.some((ref) => existing.has(ref)),
        );
        const choices = outside.map((charge) =>
          manual.filter(
            (row) =>
              compareDecimal(row.amount, charge.amount) === 0 &&
              Math.abs(Date.parse(row.settledAt!) - charge.settledAt.getTime()) <= 300_000,
          ),
        );
        const matchedManual = new Set<(typeof manual)[number]>();
        const matched = new Set<(typeof records)[number]>();
        for (const [index, charge] of outside.entries()) {
          const options = choices[index]!;
          const row = options[0];
          const unique =
            options.length === 1 && choices.filter((rows) => rows.includes(row!)).length === 1;
          if (unique) matchedManual.add(row!);
          if (charge.settledAt < window.from || charge.settledAt >= window.to) continue;
          const common = {
            references: charge.references,
            amount: charge.amount,
            settledAt: charge.settledAt.toISOString(),
          };
          if (unique) {
            backupMatches.push({
              ...common,
              paymentRef: row!.paymentRef,
              workingOrderId: row!.workingOrderId,
              externalMachine: row!.externalMachine,
              externalRef: row!.externalRef,
            });
            matched.add(charge);
          } else
            backupUnmatched.push({
              ...common,
              kind: "charge",
              reason: options.length ? "ambiguous" : "unmatched",
            });
        }
        for (const row of manual) {
          if (
            matchedManual.has(row) ||
            row.settledAt! < window.from.toISOString() ||
            row.settledAt! >= window.to.toISOString()
          )
            continue;
          backupUnmatched.push({
            ...row,
            settledAt: row.settledAt!,
            references: [],
            kind: "recorded",
            reason: choices.some((rows) => rows.includes(row)) ? "ambiguous" : "unmatched",
          });
        }
        const selected = records.filter(
          (row) =>
            !matched.has(row) &&
            ((row.settledAt >= window.from && row.settledAt < window.to) ||
              row.references.some((ref) => localReferences.includes(ref)) ||
              (row.hint !== undefined && originalCandidates.has(row.hint.paymentRef))),
        );
        await prepareEvidence(selected);
        return selected;
      },
    };
    const result = await reconcilePayments(
      {
        ...this.deps,
        provider: this.provider,
        report,
        prepareOrphans: async (tx) => {
          if (prepared.size === 0) return [];
          if (!(await admit(tx))) {
            retryOrphans = true;
            return [];
          }
          const claimed = [];
          for (const [paymentRef, { record, transaction }] of prepared) {
            const row = await claimAbandonedCapture(tx, {
              provider: this.provider,
              paymentRef,
              amount: record.amount,
              externalRef: transaction.id,
              settledAt: record.settledAt,
              at: now,
            });
            if (row) claimed.push(row);
          }
          return claimed;
        },
        reverse: async (paymentRef) => {
          const { record, transaction } = prepared.get(paymentRef)!;
          const proof = await evidence(paymentRef, transaction.id, record.amount);
          if (
            proof &&
            compareDecimal(sumDecimals(proof.refunds.map((row) => row.amount)), record.amount) === 0
          )
            return (await confirm(paymentRef, transaction.id, record.amount, proof))
              ? undefined
              : "unconfirmed";
          if (!proof || proof.transaction.refundEvents!.length !== 0 || (await paused()))
            return "unconfirmed";
          if (!(await withTransaction(this.deps.db, admit))) return "unconfirmed";
          let answer;
          try {
            answer = await client.sendRefund({
              transactionId: transaction.id,
              amount: record.amount,
            });
          } catch {
            return "unconfirmed";
          }
          if (DOCUMENTED_REFUND_REFUSALS.has(answer.httpStatus))
            throw new Error(`SumUp refused refund: HTTP ${answer.httpStatus}`);
          return "unconfirmed";
        },
        settlementLagMs: 0,
      },
      period,
      now,
    );
    let unreadableUnlinked = source.unreadableUnlinked;
    if (unreadableUnlinked > 0) {
      const originalDay = sumupSettlementReport(client);
      await originalDay.fetch(period);
      unreadableUnlinked = originalDay.unreadableUnlinked;
    }
    const refundEvidence = await source.fetchRefundEvidence(
      [
        ...backupRefundRefs,
        ...backupMatches
          .filter((match) =>
            refundRows.some(
              (row) => row.provider === "manual" && row.paymentRef === match.paymentRef,
            ),
          )
          .flatMap((match) => match.references),
        ...refundRows.flatMap((row) =>
          row.provider === this.provider && row.externalRef !== null ? [row.externalRef] : [],
        ),
      ],
      now,
    );
    return {
      ...result,
      refundEvidence,
      backupMatches,
      backupUnmatched,
      unlinkedCharges:
        unreadableUnlinked +
        result.missingLocal.filter((row) => row.workingOrderId === null).length,
      ...(source.retryRefunds ||
      retryOrphans ||
      candidates.some((row) => row.state === "attempting")
        ? { resweepAfter: new Date(now.getTime() + 86_400_000) }
        : {}),
    };
  }
}
