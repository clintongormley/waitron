import { compareDecimal, decimal } from "@waitron/shared";
import type {
  BackupPaymentMatch,
  BackupPaymentUnmatched,
  RefundAuditRow,
  RefundEvidence,
  ReconcilePeriod,
} from "@waitron/payments";
export interface RefundAuditRun {
  periodFrom: string;
  periodTo: string;
  generation: number;
  summary: {
    refundEvidence?: RefundEvidence;
    backupMatches?: BackupPaymentMatch[];
    backupUnmatched?: BackupPaymentUnmatched[];
  } | null;
}
export interface RefundAuditItem {
  charge?: { amount: string; settledAt: string };
  reason: string;
  processorRef: string | null;
  providerRefundRef: string | null;
  paymentRef: string | null;
  workingOrderId: string | null;
  externalMachine: string | null;
  externalRef: string | null;
  providerAmount: string | null;
  localAmount: string | null;
  providerAt: string | null;
  localAt: string | null;
}
export function refundAudit(
  period: ReconcilePeriod,
  runs: readonly RefundAuditRun[],
  rows: readonly RefundAuditRow[],
) {
  const result = {
    complete: true,
    checkedAt: [] as string[],
    matches: [] as RefundAuditItem[],
    agreements: [] as RefundAuditItem[],
    exceptions: [] as RefundAuditItem[],
    outside: [] as RefundAuditItem[],
  };
  const from = period.from.toISOString(),
    to = period.to.toISOString();
  const inside = (at: string | null) => at !== null && at >= from && at < to;
  const latest = new Map<string, RefundAuditRun>();
  for (const run of runs)
    if (!latest.has(run.periodFrom) || run.generation > latest.get(run.periodFrom)!.generation)
      latest.set(run.periodFrom, run);
  const selected = [...latest.values()].sort((a, b) => a.periodFrom.localeCompare(b.periodFrom));
  let covered = from;
  const parents = new Map<
    string,
    { parent: RefundEvidence["parents"][number]; checkedAt: string }
  >();
  const links = new Map<string, Set<string>>();
  const unidentified: NonNullable<RefundEvidence["parents"][number]["unidentified"]>[] = [];
  for (const run of selected) {
    const evidence = run.summary?.refundEvidence;
    if (run.periodFrom < to && run.periodTo > from) {
      if (
        run.periodFrom > covered ||
        evidence === undefined ||
        (!evidence.complete && !evidence.parents.some((parent) => parent.issue !== undefined))
      )
        result.complete = false;
      if (evidence && run.periodTo > covered) covered = run.periodTo;
      if (evidence) result.checkedAt.push(evidence.checkedAt);
    }
    for (const match of run.summary?.backupMatches ?? []) {
      const ids = links.get(match.paymentRef) ?? new Set<string>();
      for (const id of match.references) ids.add(id);
      links.set(match.paymentRef, ids);
    }
    for (const parent of evidence?.parents ?? []) {
      if (parent.unidentified) {
        if (
          parent.unidentified.at === null ||
          (parent.unidentified.at >= run.periodFrom && parent.unidentified.at < run.periodTo)
        )
          unidentified.push(parent.unidentified);
        continue;
      }
      const prior = parents.get(parent.processorRef);
      const observedAt = [
        ...new Set([...(prior?.parent.observedAt ?? []), ...(parent.observedAt ?? [])]),
      ];
      const value =
        prior === undefined || evidence!.checkedAt >= prior.checkedAt
          ? { parent, checkedAt: evidence!.checkedAt }
          : prior;
      parents.set(parent.processorRef, { ...value, parent: { ...value.parent, observedAt } });
    }
  }
  result.complete &&= covered >= to;
  const blank = (
    processorRef: string | null,
    row?: RefundAuditRow,
    local?: RefundAuditRow["refunds"][number],
    event?: RefundEvidence["parents"][number]["events"][number],
  ): RefundAuditItem => ({
    reason: "",
    ...(() => {
      const charge = selected
        .flatMap((run) => run.summary?.backupUnmatched ?? [])
        .find((charge) => processorRef !== null && charge.references.includes(processorRef));
      return charge === undefined
        ? {}
        : { charge: { amount: charge.amount, settledAt: charge.settledAt } };
    })(),
    processorRef,
    providerRefundRef: event?.id ?? local?.providerRefundRef ?? null,
    paymentRef: row?.paymentRef ?? null,
    workingOrderId: row?.workingOrderId ?? null,
    externalMachine: row?.externalMachine ?? null,
    externalRef: row?.externalRef ?? null,
    providerAmount: event?.amount ?? null,
    localAmount: local?.amount ?? null,
    providerAt: event?.at ?? null,
    localAt: local?.createdAt ?? null,
  });
  for (const row of unidentified)
    if (row.at === null || inside(row.at)) {
      result.complete = false;
      result.exceptions.push({
        ...blank(null),
        reason: "missing_reference",
        providerAmount: row.amount,
        providerAt: row.at,
      });
    }
  const locals = new Map<string, RefundAuditRow[]>();
  for (const row of rows) {
    const linked = links.get(row.paymentRef);
    const id =
      row.provider === "sumup"
        ? row.externalRef
        : row.externalProvider === "connected_account" && linked?.size === 1
          ? [...linked][0]!
          : null;
    if (id === null || (row.provider === "manual" && !parents.has(id))) {
      for (const local of row.refunds)
        if (inside(local.createdAt))
          result.outside.push({ ...blank(null, row, local), reason: "outside" });
      continue;
    }
    locals.set(id, [...(locals.get(id) ?? []), row]);
  }
  for (const id of new Set([...parents.keys(), ...locals.keys()])) {
    const stored = parents.get(id);
    const parent = stored?.parent;
    const own = locals.get(id) ?? [];
    const claims = own.flatMap((row) => row.refunds.map((local) => ({ row, local })));
    const used = new Set<(typeof claims)[number]>();
    const ambiguous = new Set<(typeof claims)[number]>();
    const events = parent?.events ?? [];
    if (parent === undefined && claims.some((claim) => inside(claim.local.createdAt)))
      result.complete = false;
    for (const event of events) {
      const exact = claims.filter((claim) => claim.local.providerRefundRef === event.id);
      const amount = claims.filter(
        (claim) =>
          claim.local.providerRefundRef === null &&
          compareDecimal(claim.local.amount, decimal(event.amount)) === 0,
      );
      const choices = exact.length ? exact : amount;
      const choice = choices[0];
      const unique =
        choices.length === 1 &&
        (exact.length === 1 ||
          events.filter(
            (other) =>
              compareDecimal(decimal(other.amount), decimal(event.amount)) === 0 &&
              !claims.some((claim) => claim.local.providerRefundRef === other.id),
          ).length === 1);
      if (choice && unique) {
        used.add(choice);
        const item = blank(id, choice.row, choice.local, event);
        if (compareDecimal(choice.local.amount, decimal(event.amount)) !== 0) {
          if (inside(event.at) || inside(choice.local.createdAt))
            result.exceptions.push({ ...item, reason: "amount" });
        } else if (inside(event.at))
          (exact.length && choice.row.provider === "sumup"
            ? result.matches
            : result.agreements
          ).push({
            ...item,
            reason:
              exact.length && choice.row.provider === "sumup" ? "confirmed" : "amount_agreement",
          });
      } else if (choices.length) {
        for (const claim of choices) {
          used.add(claim);
          ambiguous.add(claim);
        }
        if (inside(event.at))
          result.exceptions.push({ ...blank(id, own[0], undefined, event), reason: "ambiguous" });
      } else if (inside(event.at)) {
        const voided = own.find((row) => row.state === "voided");
        result.exceptions.push({
          ...blank(id, voided ?? own[0], undefined, event),
          reason: voided ? "void" : "missing_local",
        });
      }
    }
    for (const claim of ambiguous)
      if (inside(claim.local.createdAt))
        result.exceptions.push({ ...blank(id, claim.row, claim.local), reason: "ambiguous" });
    if (events.length === 0 && parent?.issue === undefined)
      for (const row of own)
        if (row.state === "voided" && inside(row.stateUpdatedAt))
          result.exceptions.push({ ...blank(id, row), reason: parent ? "void" : "not_checked" });
    for (const claim of claims)
      if (!used.has(claim) && inside(claim.local.createdAt))
        result.exceptions.push({
          ...blank(id, claim.row, claim.local),
          reason: parent === undefined ? "not_checked" : (parent.issue ?? "missing_provider"),
        });
    const knownDates = [
      ...(parent?.observedAt ?? []),
      ...claims.map((claim) => claim.local.createdAt),
      ...own.filter((row) => row.state === "voided").map((row) => row.stateUpdatedAt),
    ];
    if (parent?.issue !== undefined && (!knownDates.length || knownDates.some(inside))) {
      result.complete = false;
      if (!claims.some((claim) => inside(claim.local.createdAt)))
        result.exceptions.push({
          ...blank(id, own[0]),
          reason: parent.issue,
          providerAt: parent.observedAt?.find(inside) ?? null,
        });
    }
    if (stored && claims.some((claim) => inside(claim.local.createdAt)))
      result.checkedAt.push(stored.checkedAt);
  }
  result.checkedAt = [...new Set(result.checkedAt)];
  return result;
}
