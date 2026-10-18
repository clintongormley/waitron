import { and, eq, sql } from "drizzle-orm";
import {
  locationBusinessDaySettings,
  locationDayCutoverChanges,
  type Transaction,
} from "@waitron/db";
import { readLocationClock, validateBusinessDay } from "@waitron/reporting";
import {
  AppError,
  businessDayAt,
  businessDayBoundaryAt,
  businessDayBounds,
  cutoverForBusinessDay,
  locationId,
  type BusinessDayClock,
} from "@waitron/shared";
import { localTimeOccurrences } from "@waitron/venue-service";
import { clockTransitionAt, planBusinessDayStart } from "./business-day-changeover.js";
import type {
  BusinessDayClockModel,
  BusinessDayStartInput,
  BusinessDayStartPreview,
  VenueDetailsModel,
} from "./venue-detail-types.js";
import { readVenueDetails } from "./venue-details.js";
import { VENUE_SERVICE } from "./modules.js";
import "./errors.js";

type Scope = { locationId: string };
function invalid(field: string, reason: string): never {
  throw new AppError("venue.business_day_invalid", { field, reason });
}
function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function bodyObject(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) invalid("body", "type");
  const body = input as Record<string, unknown>;
  for (const key of Object.keys(body)) if (!allowed.includes(key)) invalid("body", "unknown_field");
  return body;
}
function revisionOf(body: Record<string, unknown>): number {
  const revision = body.expectedClockRevision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)
    invalid("expectedClockRevision", "type");
  return revision;
}
function proposalOf(input: unknown): BusinessDayStartInput {
  const body = bodyObject(input, ["effectiveBusinessDay", "dayCutover", "expectedClockRevision"]);
  const expectedClockRevision = revisionOf(body);
  if (typeof body.effectiveBusinessDay !== "string") invalid("effectiveBusinessDay", "type");
  try {
    validateBusinessDay(body.effectiveBusinessDay);
  } catch {
    invalid("effectiveBusinessDay", "date");
  }
  return {
    expectedClockRevision,
    effectiveBusinessDay: body.effectiveBusinessDay,
    dayCutover: cutoverOf(body),
  };
}
function cutoverOf(body: Record<string, unknown>): string {
  if (
    typeof body.dayCutover !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(body.dayCutover)
  )
    invalid("dayCutover", "cutover");
  return body.dayCutover.slice(0, 5);
}
function startOf(input: unknown): { expectedClockRevision: number; dayCutover: string } {
  const body = bodyObject(input, ["dayCutover", "expectedClockRevision"]);
  return { expectedClockRevision: revisionOf(body), dayCutover: cutoverOf(body) };
}
export async function readBusinessDayClockModel(
  tx: Transaction,
  cfg: Scope,
  at: Date,
): Promise<BusinessDayClockModel> {
  const clock = await readLocationClock(tx, cfg.locationId);
  const [settings] = await tx
    .select()
    .from(locationBusinessDaySettings)
    .where(eq(locationBusinessDaySettings.locationId, cfg.locationId));
  const base = { clock, revision: settings?.revision ?? 0 };
  let currentBusinessDay: string;
  try {
    currentBusinessDay = businessDayAt(clock, at);
  } catch {
    return { ...base, currentBusinessDay: null, pending: null };
  }
  const pending = clock.cutoverChanges.find(
    (change) => businessDayBoundaryAt(clock, change.effectiveBusinessDay) > at.toISOString(),
  );
  if (pending === undefined) return { ...base, currentBusinessDay, pending: null };
  const startsAt = businessDayBoundaryAt(clock, pending.effectiveBusinessDay);
  return { ...base, currentBusinessDay, pending: { ...pending, startsAt } };
}
function assertRevision(model: BusinessDayClockModel, revision: number): void {
  if (revision !== model.revision) throw new AppError("venue.business_day_changed", {});
  if (model.currentBusinessDay === null) invalid("dayCutover", "clock_unreadable");
}
function assertEditable(model: BusinessDayClockModel, at: Date): void {
  if (model.pending === null) return;
  const locksAt = businessDayBoundaryAt(
    model.clock,
    addDays(model.pending.effectiveBusinessDay, -1),
  );
  if (at.toISOString() >= locksAt)
    throw new AppError("venue.business_day_locked", { reason: "transition_started" });
}
function assertFutureDate(model: BusinessDayClockModel, proposal: BusinessDayStartInput): void {
  const first = addDays(model.currentBusinessDay!, 2);
  const last = addDays(model.currentBusinessDay!, 366);
  if (proposal.effectiveBusinessDay < first || proposal.effectiveBusinessDay > last)
    invalid("effectiveBusinessDay", "future_date");
}
function candidateFor(
  model: BusinessDayClockModel,
  proposal: BusinessDayStartInput,
): BusinessDayClock {
  assertFutureDate(model, proposal);
  const kept = model.clock.cutoverChanges.filter(
    (change) => change.effectiveBusinessDay !== model.pending?.effectiveBusinessDay,
  );
  const before = { ...model.clock, cutoverChanges: kept };
  const candidate = {
    ...before,
    cutoverChanges: [
      ...kept,
      { effectiveBusinessDay: proposal.effectiveBusinessDay, dayCutover: proposal.dayCutover },
    ],
  };
  for (let delta = -1; delta <= 1; delta++) {
    const day = addDays(proposal.effectiveBusinessDay, delta);
    for (const clock of [
      before,
      { ...before, dayCutover: proposal.dayCutover, cutoverChanges: [] },
    ]) {
      if (localTimeOccurrences(day, cutoverForBusinessDay(clock, day), clock.timeZone).length !== 1)
        invalid("effectiveBusinessDay", "clock_transition");
    }
    try {
      businessDayBounds(candidate, day);
    } catch {
      invalid("effectiveBusinessDay", "clock_transition");
    }
  }
  return candidate;
}
async function protectHistory(
  tx: Transaction,
  cfg: Scope,
  before: BusinessDayClock,
  candidate: BusinessDayClock,
  effectiveDay: string,
): Promise<void> {
  const previous = addDays(effectiveDay, -1);
  const oldBoundary = businessDayBoundaryAt(before, effectiveDay);
  const newBoundary = businessDayBoundaryAt(candidate, effectiveDay);
  const earliest = oldBoundary < newBoundary ? oldBoundary : newBoundary;
  const { rows } = await tx.execute<{ closed: number; future: number }>(sql`
    select exists(select 1 from daily_closes c join nodes n on n.id = c.node_id where n.location_id = ${cfg.locationId} and c.business_day >= ${previous}) as closed,
      exists(select 1 from (
        select s.issued_at as at from sales s join nodes n on n.id = s.node_id where n.location_id = ${cfg.locationId}
        union all select v.voided_at from sale_voids v join sales s on s.id = v.sale_id join nodes n on n.id = s.node_id where n.location_id = ${cfg.locationId}
        union all select t.settled_at from tenders t join sales s on s.id = t.sale_id join nodes n on n.id = s.node_id where n.location_id = ${cfg.locationId}
        union all select p.received_at from bill_payments p join working_orders w on w.id = p.working_order_id where w.location_id = ${cfg.locationId}
        union all select r.completed_at from bill_payment_refunds r join bill_payments p on p.id = r.bill_payment_id join working_orders w on w.id = p.working_order_id where w.location_id = ${cfg.locationId} and r.state = 'completed'
        union all select w.opened_at from working_orders w where w.location_id = ${cfg.locationId}
        union all select k.created_at from kitchen_notices k join working_orders w on w.id = k.working_order_id where w.location_id = ${cfg.locationId}
      ) where at >= ${earliest}) as future`);
  if (rows[0]!.closed) throw new AppError("venue.business_day_locked", { reason: "daily_close" });
  if (rows[0]!.future)
    throw new AppError("venue.business_day_locked", { reason: "future_history" });
}
function view(clock: BusinessDayClock, businessDay: string) {
  return {
    businessDay,
    dayCutover: cutoverForBusinessDay(clock, businessDay),
    ...businessDayBounds(clock, businessDay),
  };
}
export async function previewBusinessDayStart(
  tx: Transaction,
  cfg: Scope,
  input: unknown,
  at: Date,
): Promise<BusinessDayStartPreview> {
  const start = startOf(input);
  const model = await readBusinessDayClockModel(tx, cfg, at);
  assertRevision(model, start.expectedClockRevision);
  if (clockTransitionAt(model.clock, start.dayCutover, at) !== null)
    invalid("dayCutover", "clock_transition");
  const plan = planBusinessDayStart(model.clock, start.dayCutover, at);
  const effectiveDay = plan.effectiveBusinessDay;
  await protectHistory(tx, cfg, plan.before, plan.candidate, effectiveDay);
  let conflicts: BusinessDayStartPreview["conflicts"] = [];
  let conflictCount = 0;
  try {
    // Measured from the start in force, not from a waiting change this Save replaces.
    await VENUE_SERVICE.assertBusinessDayClockChange(
      tx,
      { locationId: locationId(cfg.locationId) },
      plan.before,
      plan.candidate,
      effectiveDay,
    );
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "venue.business_day_hours_conflict")
      throw error;
    ({ conflicts, conflictCount } = error.params);
  }
  return {
    revision: model.revision,
    previousDay: view(plan.candidate, addDays(effectiveDay, -1)),
    effectiveDay: view(plan.candidate, effectiveDay),
    conflicts,
    conflictCount,
    backupDeadlines: { archive: null, cloud: null },
  };
}
async function bumpRevision(tx: Transaction, cfg: Scope, revision: number): Promise<void> {
  await tx
    .insert(locationBusinessDaySettings)
    .values({ locationId: cfg.locationId, revision: revision + 1 })
    .onConflictDoUpdate({
      target: locationBusinessDaySettings.locationId,
      set: { revision: revision + 1 },
    });
}
function pendingScope(cfg: Scope, effectiveBusinessDay: string) {
  return and(
    eq(locationDayCutoverChanges.locationId, cfg.locationId),
    eq(locationDayCutoverChanges.effectiveBusinessDay, effectiveBusinessDay),
  );
}
export async function writeBusinessDayStart(
  tx: Transaction,
  cfg: Scope,
  input: unknown,
  at: Date,
): Promise<{ changed: boolean; model: VenueDetailsModel }> {
  const proposal = proposalOf(input);
  const model = await readBusinessDayClockModel(tx, cfg, at);
  assertRevision(model, proposal.expectedClockRevision);
  assertEditable(model, at);
  assertFutureDate(model, proposal);
  const activeCutover = cutoverForBusinessDay(model.clock, model.currentBusinessDay!);
  if (proposal.dayCutover === activeCutover) {
    if (model.pending !== null)
      throw new AppError("venue.business_day_locked", { reason: "cancel_required" });
    return { changed: false, model: await readVenueDetails(tx, cfg, at) };
  }
  if (
    model.pending?.effectiveBusinessDay === proposal.effectiveBusinessDay &&
    model.pending.dayCutover === proposal.dayCutover
  )
    return { changed: false, model: await readVenueDetails(tx, cfg, at) };
  const candidate = candidateFor(model, proposal);
  if (model.pending !== null)
    await protectHistory(tx, cfg, model.clock, candidate, model.pending.effectiveBusinessDay);
  await protectHistory(tx, cfg, model.clock, candidate, proposal.effectiveBusinessDay);
  await VENUE_SERVICE.assertBusinessDayClockChange(
    tx,
    { locationId: locationId(cfg.locationId) },
    model.clock,
    candidate,
    proposal.effectiveBusinessDay,
  );
  if (model.pending !== null)
    await tx
      .delete(locationDayCutoverChanges)
      .where(pendingScope(cfg, model.pending.effectiveBusinessDay));
  await tx.insert(locationDayCutoverChanges).values({
    locationId: cfg.locationId,
    effectiveBusinessDay: proposal.effectiveBusinessDay,
    dayCutover: `${proposal.dayCutover}:00`,
  });
  await bumpRevision(tx, cfg, model.revision);
  return { changed: true, model: await readVenueDetails(tx, cfg, at) };
}
export async function cancelBusinessDayStart(
  tx: Transaction,
  cfg: Scope,
  input: unknown,
  at: Date,
): Promise<{ changed: boolean; model: VenueDetailsModel }> {
  const revision = revisionOf(bodyObject(input, ["expectedClockRevision"]));
  const model = await readBusinessDayClockModel(tx, cfg, at);
  assertRevision(model, revision);
  if (model.pending === null) return { changed: false, model: await readVenueDetails(tx, cfg, at) };
  assertEditable(model, at);
  const candidate = {
    ...model.clock,
    cutoverChanges: model.clock.cutoverChanges.filter(
      (change) => change.effectiveBusinessDay !== model.pending!.effectiveBusinessDay,
    ),
  };
  await protectHistory(tx, cfg, model.clock, candidate, model.pending.effectiveBusinessDay);
  await tx
    .delete(locationDayCutoverChanges)
    .where(pendingScope(cfg, model.pending.effectiveBusinessDay));
  await bumpRevision(tx, cfg, model.revision);
  return { changed: true, model: await readVenueDetails(tx, cfg, at) };
}
