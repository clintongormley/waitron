import { and, eq, sql } from "drizzle-orm";
import {
  locationBusinessDaySettings,
  locationDayCutoverChanges,
  readVenueClock,
  venueLocationId,
  type Transaction,
} from "@waitron/db";
import { validateBusinessDay } from "@waitron/reporting";
import {
  AppError,
  businessDayAt,
  businessDayBoundaryAt,
  businessDayBounds,
  cutoverForBusinessDay,
  locationId,
  type BusinessDayClock,
} from "@waitron/shared";
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
  at: Date,
): Promise<BusinessDayClockModel> {
  const clock = await readVenueClock(tx);
  // Keyed by the venue's row id, so the table holds at most one row.
  const [settings] = await tx.select().from(locationBusinessDaySettings).limit(1);
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
function refuseClockTransition(clock: BusinessDayClock, dayCutover: string, at: Date): void {
  const transition = clockTransitionAt(clock, dayCutover, at);
  if (transition !== null)
    throw new AppError("venue.business_day_invalid", {
      field: "dayCutover",
      reason: "clock_transition",
      ...transition,
    });
}
function assertRevision(model: BusinessDayClockModel, revision: number): void {
  if (revision !== model.revision) throw new AppError("venue.business_day_changed", {});
  if (model.currentBusinessDay === null) invalid("dayCutover", "clock_unreadable");
}
async function protectHistory(
  tx: Transaction,
  before: BusinessDayClock,
  candidate: BusinessDayClock,
  effectiveDay: string,
): Promise<void> {
  const previous = addDays(effectiveDay, -1);
  const oldBoundary = businessDayBoundaryAt(before, effectiveDay);
  const newBoundary = businessDayBoundaryAt(candidate, effectiveDay);
  const earliest = oldBoundary < newBoundary ? oldBoundary : newBoundary;
  const { rows } = await tx.execute<{ closed: number; future: number }>(sql`
    select exists(select 1 from daily_closes c where c.business_day >= ${previous}) as closed,
      exists(select 1 from (
        select s.issued_at as at from sales s
        union all select v.voided_at from sale_voids v
        union all select t.settled_at from tenders t
        union all select p.received_at from bill_payments p
        union all select r.completed_at from bill_payment_refunds r where r.state = 'completed'
        union all select w.opened_at from working_orders w
        union all select k.created_at from kitchen_notices k
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
  input: unknown,
  at: Date,
): Promise<BusinessDayStartPreview> {
  const start = startOf(input);
  const model = await readBusinessDayClockModel(tx, at);
  assertRevision(model, start.expectedClockRevision);
  refuseClockTransition(model.clock, start.dayCutover, at);
  const plan = planBusinessDayStart(model.clock, start.dayCutover, at);
  const effectiveDay = plan.effectiveBusinessDay;
  await protectHistory(tx, model.clock, plan.candidate, effectiveDay);
  let conflicts: BusinessDayStartPreview["conflicts"] = [];
  let conflictCount = 0;
  try {
    // Measured from the start in force, not from a waiting change this Save replaces.
    await VENUE_SERVICE.assertBusinessDayClockChange(
      tx,
      { locationId: locationId(await venueLocationId(tx)) },
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
async function bumpRevision(tx: Transaction, venueId: string, revision: number): Promise<void> {
  await tx
    .insert(locationBusinessDaySettings)
    .values({ locationId: venueId, revision: revision + 1 })
    .onConflictDoUpdate({
      target: locationBusinessDaySettings.locationId,
      set: { revision: revision + 1 },
    });
}
function pendingScope(venueId: string, effectiveBusinessDay: string) {
  return and(
    eq(locationDayCutoverChanges.locationId, venueId),
    eq(locationDayCutoverChanges.effectiveBusinessDay, effectiveBusinessDay),
  );
}
export async function writeBusinessDayStart(
  tx: Transaction,
  input: unknown,
  at: Date,
): Promise<{ changed: boolean; model: VenueDetailsModel }> {
  const proposal = proposalOf(input);
  const model = await readBusinessDayClockModel(tx, at);
  assertRevision(model, proposal.expectedClockRevision);
  const unchanged = async () => ({
    changed: false,
    model: await readVenueDetails(tx, at, model),
  });
  if (
    model.pending === null &&
    proposal.dayCutover === cutoverForBusinessDay(model.clock, model.currentBusinessDay!)
  )
    return unchanged();
  const plan = planBusinessDayStart(model.clock, proposal.dayCutover, at);
  const effectiveDay = plan.effectiveBusinessDay;
  if (proposal.effectiveBusinessDay !== effectiveDay) invalid("dayCutover", "changeover_passed");
  if (sameChanges(plan.candidate, model.clock)) return unchanged();
  refuseClockTransition(model.clock, proposal.dayCutover, at);
  for (const removed of plan.removed)
    await protectHistory(tx, model.clock, plan.candidate, removed);
  await protectHistory(tx, model.clock, plan.candidate, effectiveDay);
  const venueId = await venueLocationId(tx);
  await VENUE_SERVICE.assertBusinessDayClockChange(
    tx,
    { locationId: locationId(venueId) },
    plan.before,
    plan.candidate,
    effectiveDay,
  );
  for (const removed of plan.removed)
    await tx.delete(locationDayCutoverChanges).where(pendingScope(venueId, removed));
  if (plan.candidate !== plan.before)
    await tx.insert(locationDayCutoverChanges).values({
      locationId: venueId,
      effectiveBusinessDay: effectiveDay,
      dayCutover: `${proposal.dayCutover}:00`,
    });
  await bumpRevision(tx, venueId, model.revision);
  return { changed: true, model: await readVenueDetails(tx, at) };
}
function sameChanges(left: BusinessDayClock, right: BusinessDayClock): boolean {
  const key = (clock: BusinessDayClock) =>
    clock.cutoverChanges
      .map((change) => `${change.effectiveBusinessDay} ${change.dayCutover}`)
      .sort()
      .join(",");
  return key(left) === key(right);
}
