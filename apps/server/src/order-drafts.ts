import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  kitchenCourses,
  newId,
  nowIso,
  orderDraftEvents,
  orderDraftLines,
  orderDrafts,
  visits,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import type { ZoneMenuOffer } from "@waitron/module";
import {
  addDecimal,
  AppError,
  decimal,
  isUuid,
  normaliseUuid,
  QUANTITY_SCALE,
  stringToThousandths,
  thousandthsToDecimal,
  toScale,
} from "@waitron/shared";
import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import { visitTab } from "./order-groups.js";
import type { TillConfig } from "./till-config.js";
import { screenNote } from "./working-order.js";
import "./errors.js";

export interface DraftLine {
  id: string;
  menuItemId: string;
  variantId: string | null;
  menuVersionId: string | null;
  options: OptionSelection[];
  extras: ExtraSelection[];
  note: string | null;
  quantity: string;
  courseId: string | null;
  noMerge: boolean;
  unavailable: boolean;
}

export interface Draft {
  id: string;
  visitId: string;
  ownerId: string;
  ownerName: string;
  revision: number;
  lines: DraftLine[];
}

/**
 * Adds each line into the first earlier line that orders the same thing (plan D10), which keeps its
 * id and position. Options compare as a set and extras picks as a multiset, never by order.
 *
 * A fractional quantity never merges: 0.5 kg and 0.3 kg of fish are two portions the kitchen cooks
 * separately, and one 0.8 kg row would lose that.
 */
export function normaliseDraftLines(lines: DraftLine[]): DraftLine[] {
  const merged: DraftLine[] = [];
  const byKey = new Map<string, number>();
  for (const line of lines) {
    const key = mergeKey(line);
    const into = key === null ? undefined : byKey.get(key);
    if (into === undefined) {
      if (key !== null) byKey.set(key, merged.length);
      merged.push(line);
      continue;
    }
    const kept = merged[into]!;
    const total = addDecimal(decimal(kept.quantity), decimal(line.quantity));
    merged[into] = { ...kept, quantity: toScale(total, QUANTITY_SCALE) };
  }
  return merged;
}

/** Null for a line that never merges. */
function mergeKey(line: DraftLine): string | null {
  if (line.noMerge || stringToThousandths(line.quantity) % 1000 !== 0) return null;
  const options = [
    ...new Set(line.options.map(({ listId, labelId }) => JSON.stringify([listId, labelId]))),
  ].sort();
  const picks = new Map<string, number>();
  for (const { listId, picks: listPicks } of line.extras) {
    for (const { productId, quantity } of listPicks) {
      const pick = JSON.stringify([listId, productId]);
      picks.set(pick, (picks.get(pick) ?? 0) + quantity);
    }
  }
  const extras = [...picks].map((entry) => JSON.stringify(entry)).sort();
  return JSON.stringify([
    line.menuItemId,
    line.variantId,
    line.menuVersionId,
    line.courseId,
    line.note,
    options,
    extras,
  ]);
}

/** A line as the till saves it: without the id a save gives it or the flag a read works out. */
export type DraftLineInput = Omit<DraftLine, "id" | "unavailable">;

export interface SaveDraftInput {
  /** Null asks for the operator's new draft on the visit. */
  draftId: string | null;
  revision: number;
  lines: DraftLineInput[];
}

/** One unsent draft on a party, as the floor shows it: `lineCount` counts rows, not units. */
export interface UnsentDraft {
  ownerName: string;
  lineCount: number;
}

/**
 * Every open draft on the visit, whoever owns it, each line marked by {@link unavailable} against
 * the zone's live offers. The mark is worked out on each read and never stored.
 */
export async function readDrafts(
  tx: Transaction,
  cfg: TillConfig,
  visitId: string,
): Promise<Draft[]> {
  return readOpenDrafts(tx, cfg, visitId);
}

/**
 * Replace the lines of the operator's draft with `input.lines`, added together by
 * {@link normaliseDraftLines}, or start the operator's draft on the visit when `draftId` is null. A
 * save moves the draft's revision on, never the visit's, and sends nothing to the kitchen.
 */
export async function saveDraft(
  tx: Transaction,
  cfg: TillConfig,
  visitId: string,
  operatorId: string,
  input: SaveDraftInput,
): Promise<Draft> {
  const lines = parseDraftLines(input.lines);
  await requireOpenVisit(tx, visitId);
  await requireCourses(tx, lines);
  let draftId: string;
  if (input.draftId === null) {
    const [held] = await tx
      .select({ id: orderDrafts.id, revision: orderDrafts.revision })
      .from(orderDrafts)
      .where(
        and(
          eq(orderDrafts.visitId, visitId),
          eq(orderDrafts.ownerId, operatorId),
          eq(orderDrafts.state, "open"),
        ),
      );
    if (held !== undefined) {
      throw new AppError("draft.out_of_date", { draftId: held.id, revision: held.revision });
    }
    draftId = newId();
    await tx.insert(orderDrafts).values({ id: draftId, visitId, ownerId: operatorId });
    await recordDraftEvent(tx, draftId, "created", null, operatorId, operatorId);
  } else {
    const draft = await requireDraft(tx, draftIdOf(input.draftId), visitId);
    if (draft.ownerId !== operatorId) {
      throw new AppError("draft.taken_over", {
        draftId: draft.id,
        ownerId: draft.ownerId,
        ownerName: await personName(tx, draft.ownerId),
      });
    }
    if (draft.revision !== input.revision) {
      throw new AppError("draft.out_of_date", { draftId: draft.id, revision: draft.revision });
    }
    draftId = draft.id;
    await tx
      .update(orderDrafts)
      .set({ revision: draft.revision + 1, updatedAt: nowIso() })
      .where(eq(orderDrafts.id, draftId));
  }
  await replaceLines(
    tx,
    [draftId],
    draftId,
    normaliseDraftLines(lines.map((line) => ({ ...line, id: newId(), unavailable: false }))),
  );
  return (await readOpenDrafts(tx, cfg, visitId, draftId))[0]!;
}

/**
 * Make the operator the owner of another person's open draft. Where the operator already has an
 * open draft on the visit, the taken lines are added to the end of it and the taken draft is
 * discarded, so no one holds two; the operator's draft is returned. Taking over one's own draft
 * changes nothing and returns it as it is.
 */
export async function takeOverDraft(
  tx: Transaction,
  cfg: TillConfig,
  draftId: string,
  operatorId: string,
  revision: number,
): Promise<Draft> {
  const draft = await requireDraft(tx, draftIdOf(draftId));
  await requireOpenVisit(tx, draft.visitId);
  if (draft.ownerId === operatorId) {
    return (await readOpenDrafts(tx, cfg, draft.visitId, draft.id))[0]!;
  }
  if (draft.revision !== revision) {
    throw new AppError("draft.out_of_date", { draftId: draft.id, revision: draft.revision });
  }
  const [own] = await tx
    .select({ id: orderDrafts.id, revision: orderDrafts.revision })
    .from(orderDrafts)
    .where(
      and(
        eq(orderDrafts.visitId, draft.visitId),
        eq(orderDrafts.ownerId, operatorId),
        eq(orderDrafts.state, "open"),
      ),
    );
  await tx
    .update(orderDrafts)
    .set({
      ownerId: operatorId,
      revision: draft.revision + 1,
      updatedAt: nowIso(),
      ...(own === undefined ? {} : { state: "discarded" as const }),
    })
    .where(eq(orderDrafts.id, draft.id));
  await recordDraftEvent(tx, draft.id, "taken_over", draft.ownerId, operatorId, operatorId);
  if (own === undefined) {
    return (await readOpenDrafts(tx, cfg, draft.visitId, draft.id))[0]!;
  }
  await recordDraftEvent(tx, draft.id, "discarded", operatorId, operatorId, operatorId, {
    intoDraftId: own.id,
  });
  const combined = [
    ...(await storedLines(tx, [own.id])),
    ...(await storedLines(tx, [draft.id])),
  ].map(({ line }) => line);
  await replaceLines(tx, [own.id, draft.id], own.id, normaliseDraftLines(combined));
  await tx
    .update(orderDrafts)
    .set({ revision: own.revision + 1, updatedAt: nowIso() })
    .where(eq(orderDrafts.id, own.id));
  return (await readOpenDrafts(tx, cfg, draft.visitId, own.id))[0]!;
}

/** Each visit's open drafts holding at least one line, oldest first, in one query. */
export async function readUnsentDrafts(
  tx: Transaction,
  visitIds: readonly string[],
): Promise<Map<string, UnsentDraft[]>> {
  const unsent = new Map<string, UnsentDraft[]>(visitIds.map((id) => [id, []]));
  if (visitIds.length === 0) return unsent;
  const rows = await tx
    .select({
      visitId: orderDrafts.visitId,
      ownerName: persons.displayName,
      lineCount: sql<number>`cast(count(${orderDraftLines.id}) as int)`,
    })
    .from(orderDrafts)
    .innerJoin(orderDraftLines, eq(orderDraftLines.draftId, orderDrafts.id))
    .leftJoin(persons, eq(persons.id, orderDrafts.ownerId))
    .where(and(inArray(orderDrafts.visitId, [...visitIds]), eq(orderDrafts.state, "open")))
    .groupBy(orderDrafts.id)
    .orderBy(asc(orderDrafts.createdAt), asc(orderDrafts.id));
  for (const row of rows) {
    unsent.get(row.visitId)!.push({ ownerName: row.ownerName ?? "", lineCount: row.lineCount });
  }
  return unsent;
}

const QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/;

function invalid(field: string): AppError {
  return new AppError("management.request_invalid", { field });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A UUID in lower case, the spelling the stored ids and the merge key compare in. */
function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw invalid(field);
  return normaliseUuid(value, field);
}

/** An id a line may leave out: absent or null is none. */
function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return uuid(value, field);
}

/** A draft id that is no UUID names no draft, so it is kept as sent and then not found. */
function draftIdOf(draftId: string): string {
  return isUuid(draftId) ? normaliseUuid(draftId, "draftId") : draftId;
}

function parseOptions(value: unknown, field: string): OptionSelection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid(field);
  return value.map((entry: unknown) => {
    if (!isRecord(entry)) throw invalid(field);
    return { listId: uuid(entry.listId, field), labelId: uuid(entry.labelId, field) };
  });
}

/** A pick's quantity is a whole number from one, as the basket's extras validator requires. */
function parseExtras(value: unknown, field: string): ExtraSelection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid(field);
  return value.map((entry: unknown) => {
    if (!isRecord(entry)) throw invalid(field);
    const listId = uuid(entry.listId, field);
    const { picks } = entry;
    if (!Array.isArray(picks)) throw invalid(field);
    return {
      listId,
      picks: picks.map((pick: unknown) => {
        if (!isRecord(pick)) throw invalid(field);
        const { quantity } = pick;
        if (!Number.isSafeInteger(quantity) || (quantity as number) < 1) throw invalid(field);
        return { productId: uuid(pick.productId, field), quantity: quantity as number };
      }),
    };
  });
}

/**
 * Screen every line before anything is written. A quantity is a positive decimal of at most three
 * places, so the row holds exactly what was sent.
 */
function parseDraftLines(value: unknown): DraftLineInput[] {
  if (!Array.isArray(value)) throw invalid("lines");
  return value.map((entry: unknown, index): DraftLineInput => {
    const field = (name: string) => `lines.${index}.${name}`;
    if (!isRecord(entry)) throw invalid(`lines.${index}`);
    const { quantity, note, noMerge } = entry;
    const menuItemId = uuid(entry.menuItemId, field("menuItemId"));
    if (
      typeof quantity !== "string" ||
      !QUANTITY_PATTERN.test(quantity) ||
      stringToThousandths(quantity) === 0
    ) {
      throw invalid(field("quantity"));
    }
    if (note !== undefined && note !== null && typeof note !== "string") {
      throw invalid(field("note"));
    }
    if (noMerge !== undefined && typeof noMerge !== "boolean") throw invalid(field("noMerge"));
    return {
      menuItemId,
      variantId: optionalId(entry.variantId, field("variantId")),
      menuVersionId: optionalId(entry.menuVersionId, field("menuVersionId")),
      options: parseOptions(entry.options, field("options")),
      extras: parseExtras(entry.extras, field("extras")),
      note: screenNote(note),
      quantity,
      courseId: optionalId(entry.courseId, field("courseId")),
      noMerge: noMerge ?? false,
    };
  });
}

/** A named course must exist, or the line's key to `kitchen_courses` would refuse the insert. */
async function requireCourses(tx: Transaction, lines: readonly DraftLineInput[]): Promise<void> {
  const named = [
    ...new Set(lines.flatMap((line) => (line.courseId === null ? [] : [line.courseId]))),
  ];
  if (named.length === 0) return;
  const found = new Set(
    (
      await tx
        .select({ id: kitchenCourses.id })
        .from(kitchenCourses)
        .where(inArray(kitchenCourses.id, named))
    ).map((row) => row.id),
  );
  const missing = named.find((courseId) => !found.has(courseId));
  if (missing !== undefined) throw new AppError("course.not_found", { courseId: missing });
}

async function requireOpenVisit(tx: Transaction, visitId: string): Promise<void> {
  const [visit] = await tx
    .select({ state: visits.state })
    .from(visits)
    .where(eq(visits.id, visitId));
  if (visit?.state !== "open") throw new AppError("visit.not_open", { visitId });
}

/**
 * The draft, open or sent; a discarded one is gone. With `visitId`, a draft of another visit is
 * not found either.
 */
async function requireDraft(tx: Transaction, draftId: string, visitId?: string) {
  const [draft] = await tx
    .select({
      id: orderDrafts.id,
      visitId: orderDrafts.visitId,
      ownerId: orderDrafts.ownerId,
      revision: orderDrafts.revision,
      state: orderDrafts.state,
    })
    .from(orderDrafts)
    .where(eq(orderDrafts.id, draftId));
  if (
    draft === undefined ||
    draft.state === "discarded" ||
    (visitId !== undefined && draft.visitId !== visitId)
  ) {
    throw new AppError("draft.not_found", { draftId });
  }
  if (draft.state === "submitted") throw new AppError("draft.already_submitted", { draftId });
  return draft;
}

async function personName(tx: Transaction, personId: string): Promise<string> {
  const [person] = await tx
    .select({ displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, personId));
  return person?.displayName ?? "";
}

async function recordDraftEvent(
  tx: Transaction,
  draftId: string,
  kind: "created" | "taken_over" | "discarded",
  fromPerson: string | null,
  toPerson: string,
  actorId: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await tx
    .insert(orderDraftEvents)
    .values({ draftId, kind, fromPerson, toPerson, actorId, detail });
}

/**
 * The drafts' stored lines, in position order, each with its draft's id, and `unavailable` not yet
 * worked out.
 */
async function storedLines(
  tx: Transaction,
  draftIds: readonly string[],
): Promise<{ draftId: string; line: DraftLine }[]> {
  const rows = await tx
    .select()
    .from(orderDraftLines)
    .where(inArray(orderDraftLines.draftId, [...draftIds]))
    .orderBy(asc(orderDraftLines.position), asc(orderDraftLines.id));
  return rows.map((row) => ({
    draftId: row.draftId,
    line: {
      id: row.id,
      menuItemId: row.menuItemId,
      variantId: row.variantId,
      menuVersionId: row.menuVersionId,
      options: row.options,
      extras: row.extras,
      note: row.note,
      quantity: thousandthsToDecimal(row.quantity),
      courseId: row.courseId,
      noMerge: row.noMerge,
      unavailable: false,
    },
  }));
}

/** Delete every line of `fromDraftIds`, then write `lines` to `intoDraftId` numbered from one. */
async function replaceLines(
  tx: Transaction,
  fromDraftIds: readonly string[],
  intoDraftId: string,
  lines: readonly DraftLine[],
): Promise<void> {
  await tx.delete(orderDraftLines).where(inArray(orderDraftLines.draftId, [...fromDraftIds]));
  if (lines.length === 0) return;
  await tx.insert(orderDraftLines).values(
    lines.map((line, index) => ({
      id: line.id,
      draftId: intoDraftId,
      position: index + 1,
      menuItemId: line.menuItemId,
      variantId: line.variantId,
      menuVersionId: line.menuVersionId,
      options: line.options,
      extras: line.extras,
      note: line.note,
      quantity: stringToThousandths(line.quantity),
      courseId: line.courseId,
      noMerge: line.noMerge,
    })),
  );
}

async function readOpenDrafts(
  tx: Transaction,
  cfg: TillConfig,
  visitId: string,
  draftId?: string,
): Promise<Draft[]> {
  const drafts = await tx
    .select({
      id: orderDrafts.id,
      visitId: orderDrafts.visitId,
      ownerId: orderDrafts.ownerId,
      ownerName: persons.displayName,
      revision: orderDrafts.revision,
    })
    .from(orderDrafts)
    .leftJoin(persons, eq(persons.id, orderDrafts.ownerId))
    .where(
      and(
        eq(orderDrafts.visitId, visitId),
        eq(orderDrafts.state, "open"),
        draftId === undefined ? undefined : eq(orderDrafts.id, draftId),
      ),
    )
    .orderBy(asc(orderDrafts.createdAt), asc(orderDrafts.id));
  if (drafts.length === 0) return [];
  const lines = await storedLines(
    tx,
    drafts.map((draft) => draft.id),
  );
  const offers = await offersFor(
    tx,
    cfg,
    visitId,
    lines.map(({ line }) => line.menuItemId),
  );
  return drafts.map((draft) => ({
    ...draft,
    ownerName: draft.ownerName ?? "",
    lines: lines
      .filter((stored) => stored.draftId === draft.id)
      .map(({ line }) => ({
        ...line,
        unavailable: unavailable(line, offers.get(line.menuItemId)),
      })),
  }));
}

/** The zone's live offers for the menu items, from the source `priceOrderLines` refuses from. */
async function offersFor(
  tx: Transaction,
  cfg: TillConfig,
  visitId: string,
  menuItemIds: readonly string[],
): Promise<Map<string, ZoneMenuOffer>> {
  if (menuItemIds.length === 0) return new Map();
  const { zoneId } = await VENUE_SERVICE.getOrderContext(tx, cfg, await visitTab(tx, visitId));
  const { offers } = await VENUE_SERVICE.listZoneOffers(tx, cfg, zoneId, {
    menuItemIds: [...new Set(menuItemIds)],
  });
  return new Map(offers.map((offer) => [offer.id, offer]));
}

/**
 * True when the line's menu item has no offer; the dish cannot be sold; its variant is not offered
 * or cannot be sold; an extras pick is not an available item of that extras list on the offer; or
 * an option answer is not an available label of that options list on the offer. Each of those is
 * refused when the line is priced. An options list the line leaves unanswered is not checked.
 */
function unavailable(line: DraftLine, offer: ZoneMenuOffer | undefined): boolean {
  if (offer === undefined || !offer.available) return true;
  if (
    line.variantId !== null &&
    !offer.variants.find((variant) => variant.id === line.variantId)?.available
  ) {
    return true;
  }
  const offered = new Set(
    offer.offeredModifiers.flatMap((list) =>
      (list.kind === "extras"
        ? list.items.filter((item) => item.available).map((item) => item.productId)
        : list.labels.filter((label) => label.available).map((label) => label.id)
      ).map((id) => JSON.stringify([list.kind, list.id, id])),
    ),
  );
  return (
    line.extras.some(({ listId, picks }) =>
      picks.some(({ productId }) => !offered.has(JSON.stringify(["extras", listId, productId]))),
    ) ||
    line.options.some(
      ({ listId, labelId }) => !offered.has(JSON.stringify(["options", listId, labelId])),
    )
  );
}
