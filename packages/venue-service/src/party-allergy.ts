import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  newId,
  nowIso,
  parties,
  orderDraftLines,
  orderDrafts,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { validateAllergens } from "@waitron/catalogue";
import type { PartyAllergySnapshot } from "@waitron/module";
import { AppError, isUuid } from "@waitron/shared";
import { allergyLineTicks, partyAllergy, partyAllergyGuests } from "./schema/party-allergy.js";
import "./errors.js";

function invalid(field: string): never {
  throw new AppError("allergy.invalid", { field });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function printable(value: unknown, field: string, limit: number, required: boolean): string | null {
  if ((value === undefined || value === null) && !required) return null;
  if (typeof value !== "string") invalid(field);
  // eslint-disable-next-line no-control-regex -- allergy instructions reach kitchen printers
  const text = value.replace(/[\x00-\x1f\x7f-\x9f]+/g, " ").trim();
  if ((required && text.length === 0) || text.length > limit) invalid(field);
  return text || null;
}

export async function partiesWithAllergicGuests(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (partyIds.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ partyId: partyAllergyGuests.partyId })
    .from(partyAllergyGuests)
    .where(inArray(partyAllergyGuests.partyId, partyIds));
  return new Set(rows.map((row) => row.partyId));
}

export async function readPartyAllergy(
  tx: Transaction,
  partyId: string,
): Promise<PartyAllergySnapshot> {
  const [party] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party === undefined) invalid("partyId");
  const [answer] = await tx.select().from(partyAllergy).where(eq(partyAllergy.partyId, partyId));
  const guests = await tx
    .select()
    .from(partyAllergyGuests)
    .where(eq(partyAllergyGuests.partyId, partyId))
    .orderBy(asc(partyAllergyGuests.position), asc(partyAllergyGuests.id));
  const ticks =
    guests.length === 0
      ? []
      : await tx
          .select({
            guestId: allergyLineTicks.guestId,
            draftLineId: allergyLineTicks.draftLineId,
            workingLineId: allergyLineTicks.workingLineId,
          })
          .from(allergyLineTicks)
          .where(
            inArray(
              allergyLineTicks.guestId,
              guests.map((g) => g.id),
            ),
          )
          .orderBy(asc(allergyLineTicks.id));
  return {
    answer: answer?.answer ?? null,
    guests,
    ticks,
    changedBy: answer?.changedBy ?? null,
    changedAt: answer?.changedAt ?? null,
    revision: party.revision,
  };
}

export async function savePartyAllergy(
  tx: Transaction,
  partyId: string,
  expectedRevision: number,
  input: unknown,
  operatorId: string,
): Promise<PartyAllergySnapshot> {
  const [party] = await tx.select().from(parties).where(eq(parties.id, partyId));
  if (party === undefined || party.state !== "open") invalid("partyId");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) invalid("revision");
  if (party.revision !== expectedRevision)
    throw new AppError("allergy.out_of_date", { revision: party.revision });
  if (!record(input) || (input.answer !== "none" && input.answer !== "allergies"))
    invalid("answer");
  if (!Array.isArray(input.guests) || (input.answer === "none" && input.guests.length !== 0))
    invalid("guests");
  const current = await tx
    .select()
    .from(partyAllergyGuests)
    .where(eq(partyAllergyGuests.partyId, partyId));
  const known = new Set(current.map((g) => g.id));
  const seen = new Set<string>();
  const guests = input.guests.map((entry: unknown, position) => {
    const field = (name: string) => `guests.${position}.${name}`;
    if (!record(entry)) invalid(field("who"));
    const guestId = entry.id === undefined ? newId() : entry.id;
    if (
      typeof guestId !== "string" ||
      (entry.id !== undefined && !known.has(guestId)) ||
      seen.has(guestId)
    )
      invalid(field("id"));
    seen.add(guestId);
    const who = printable(entry.who, field("who"), 40, true)!;
    if (!record(entry.allergens) || Object.keys(entry.allergens).length === 0)
      invalid(field("allergens"));
    let allergens;
    try {
      allergens = validateAllergens(entry.allergens)!;
    } catch (error) {
      if (!(error instanceof AppError) || !error.code.startsWith("allergen.")) throw error;
      throw new AppError("allergy.invalid", { field: field("allergens") }, { reason: error.code });
    }
    const note = printable(entry.note, field("note"), 2000, false);
    return { id: guestId, partyId, position, who, allergens, note };
  });
  await tx
    .insert(partyAllergy)
    .values({ partyId, answer: input.answer, changedBy: operatorId, changedAt: nowIso() })
    .onConflictDoUpdate({
      target: partyAllergy.partyId,
      set: { answer: input.answer, changedBy: operatorId, changedAt: nowIso() },
    });
  for (const old of current)
    if (!seen.has(old.id))
      await tx.delete(partyAllergyGuests).where(eq(partyAllergyGuests.id, old.id));
  for (const guest of guests) {
    if (known.has(guest.id))
      await tx.update(partyAllergyGuests).set(guest).where(eq(partyAllergyGuests.id, guest.id));
    else await tx.insert(partyAllergyGuests).values(guest);
  }
  await tx
    .update(parties)
    .set({ revision: party.revision + 1 })
    .where(eq(parties.id, partyId));
  return readPartyAllergy(tx, partyId);
}

export async function setAllergyLineTicks(
  tx: Transaction,
  partyId: string,
  input: unknown,
): Promise<void> {
  if (!Array.isArray(input)) invalid("ticks");
  const [party] = await tx
    .select({ state: parties.state })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party === undefined || party.state !== "open") invalid("partyId");
  const guests = await tx
    .select({ id: partyAllergyGuests.id })
    .from(partyAllergyGuests)
    .where(eq(partyAllergyGuests.partyId, partyId));
  const known = new Set(guests.map((g) => g.id));
  const seen = new Set<string>();
  const checked = [];
  for (const [i, entry] of input.entries()) {
    const field = (name: string) => `ticks.${i}.${name}`;
    if (!record(entry)) invalid(field("line"));
    const draftLineId = entry.draftLineId ?? null;
    const workingLineId = entry.workingLineId ?? null;
    if ((draftLineId === null) === (workingLineId === null)) invalid(field("line"));
    const lineId = draftLineId ?? workingLineId;
    if (typeof lineId !== "string" || !isUuid(lineId) || seen.has(lineId)) invalid(field("line"));
    seen.add(lineId);
    if (entry.guestId !== null && (typeof entry.guestId !== "string" || !known.has(entry.guestId)))
      invalid(field("guestId"));
    if (draftLineId !== null) {
      const [line] = await tx
        .select({ id: orderDraftLines.id })
        .from(orderDraftLines)
        .innerJoin(orderDrafts, eq(orderDrafts.id, orderDraftLines.draftId))
        .where(
          and(
            eq(orderDraftLines.id, lineId),
            eq(orderDrafts.partyId, partyId),
            eq(orderDrafts.state, "open"),
          ),
        );
      if (line === undefined) invalid(field("line"));
    } else {
      const [line] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
        .where(
          and(
            eq(workingOrderLines.id, lineId),
            inArray(
              workingOrders.partyId,
              sql`(
              with recursive family(id) as (
                select ${partyId}
                union select p.id from parties p join family f on p.merged_into_party_id = f.id
              ) select id from family
            )`,
            ),
            isNull(workingOrderLines.parentLineId),
          ),
        );
      if (line === undefined) invalid(field("line"));
    }
    checked.push({
      guestId: entry.guestId as string | null,
      draftLineId: draftLineId as string | null,
      workingLineId: workingLineId as string | null,
    });
  }
  for (const tick of checked) {
    const target =
      tick.draftLineId === null
        ? eq(allergyLineTicks.workingLineId, tick.workingLineId!)
        : eq(allergyLineTicks.draftLineId, tick.draftLineId);
    await tx.delete(allergyLineTicks).where(target);
    if (tick.guestId !== null)
      await tx.insert(allergyLineTicks).values({ ...tick, guestId: tick.guestId });
  }
}

export async function moveAllergyDraftTicks(
  tx: Transaction,
  partyId: string,
  lines: readonly { draftLineId: string; workingLineId: string }[],
): Promise<void> {
  for (const line of lines) {
    const [tick] = await tx
      .select({ id: allergyLineTicks.id })
      .from(allergyLineTicks)
      .innerJoin(partyAllergyGuests, eq(partyAllergyGuests.id, allergyLineTicks.guestId))
      .where(
        and(
          eq(allergyLineTicks.draftLineId, line.draftLineId),
          eq(partyAllergyGuests.partyId, partyId),
        ),
      );
    if (tick !== undefined)
      await tx
        .update(allergyLineTicks)
        .set({ draftLineId: null, workingLineId: line.workingLineId })
        .where(eq(allergyLineTicks.id, tick.id));
  }
}

export async function mergePartyAllergies(
  tx: Transaction,
  from: string,
  into: string,
  operatorId: string,
): Promise<void> {
  if (from === into) return;
  const source = await readPartyAllergy(tx, from);
  const target = await readPartyAllergy(tx, into);
  const answer =
    source.answer === "allergies" || target.answer === "allergies"
      ? "allergies"
      : source.answer === null || target.answer === null
        ? null
        : "none";
  if (answer === null) {
    await tx.delete(partyAllergy).where(inArray(partyAllergy.partyId, [from, into]));
    return;
  }
  await tx
    .insert(partyAllergy)
    .values({ partyId: into, answer, changedBy: operatorId, changedAt: nowIso() })
    .onConflictDoUpdate({
      target: partyAllergy.partyId,
      set: { answer, changedBy: operatorId, changedAt: nowIso() },
    });
  for (const [i, guest] of source.guests.entries())
    await tx
      .update(partyAllergyGuests)
      .set({ partyId: into, position: target.guests.length + i })
      .where(eq(partyAllergyGuests.id, guest.id));
  await tx.delete(partyAllergy).where(eq(partyAllergy.partyId, from));
}

export async function splitPartyAllergies(
  tx: Transaction,
  from: string,
  into: string,
  billId: string | null,
  operatorId: string,
): Promise<void> {
  const source = await readPartyAllergy(tx, from);
  if (source.answer === null) return;
  await tx
    .insert(partyAllergy)
    .values({ partyId: into, answer: source.answer, changedBy: operatorId, changedAt: nowIso() });
  await copyGuestsAndBillTicks(tx, source.guests, into, billId, 0);
}

async function copyGuestsAndBillTicks(
  tx: Transaction,
  guests: PartyAllergySnapshot["guests"],
  into: string,
  billId: string | null,
  offset: number,
): Promise<void> {
  const moving =
    billId === null
      ? []
      : await tx
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, billId));
  const drafts =
    billId === null
      ? []
      : await tx
          .select({ id: orderDraftLines.id })
          .from(orderDraftLines)
          .innerJoin(orderDrafts, eq(orderDrafts.id, orderDraftLines.draftId))
          .where(and(eq(orderDrafts.billId, billId), eq(orderDrafts.state, "open")));
  for (const [position, guest] of guests.entries()) {
    const id = newId();
    await tx
      .insert(partyAllergyGuests)
      .values({ ...guest, id, partyId: into, position: offset + position });
    if (moving.length > 0 || drafts.length > 0)
      await tx
        .update(allergyLineTicks)
        .set({ guestId: id })
        .where(
          and(
            eq(allergyLineTicks.guestId, guest.id),
            or(
              inArray(
                allergyLineTicks.workingLineId,
                moving.map((line) => line.id),
              ),
              inArray(
                allergyLineTicks.draftLineId,
                drafts.map((line) => line.id),
              ),
            ),
          ),
        );
  }
}

export async function moveBillAllergies(
  tx: Transaction,
  from: string,
  into: string,
  billId: string,
  operatorId: string,
): Promise<void> {
  if (from === into) return;
  const source = await readPartyAllergy(tx, from);
  if (source.answer !== "allergies") return;
  const target = await readPartyAllergy(tx, into);
  await tx
    .insert(partyAllergy)
    .values({ partyId: into, answer: "allergies", changedBy: operatorId, changedAt: nowIso() })
    .onConflictDoUpdate({
      target: partyAllergy.partyId,
      set: { answer: "allergies", changedBy: operatorId, changedAt: nowIso() },
    });
  // The source keeps its guests; both tick kinds follow only the bill that leaves.
  await copyGuestsAndBillTicks(
    tx,
    source.guests,
    into,
    billId,
    (target.guests.at(-1)?.position ?? -1) + 1,
  );
}
