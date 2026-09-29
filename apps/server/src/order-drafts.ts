import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  kitchenCourses,
  newId,
  nowIso,
  orderDraftEvents,
  orderDraftLines,
  orderDrafts,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { readExtraSelections, readOptionSelections } from "@waitron/catalogue";
import { persons } from "@waitron/identity";
import type { ZoneMenuOffer } from "@waitron/module";
import {
  AppError,
  isUuid,
  normaliseDraftLines,
  stringToThousandths,
  thousandthsToDecimal,
} from "@waitron/shared";
import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { VENUE_SERVICE } from "./modules.js";
import { placeGroups } from "./order-groups.js";
import type { GroupLine, GroupRelease, SubmittedGroups, PartyCommandArgs } from "./order-groups.js";
import type { TillConfig } from "./till-config.js";
import { checkAndBumpParty, partyZone, requireOpenParty, runServiceCommand } from "./parties.js";
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
  partyId: string;
  ownerId: string;
  ownerName: string;
  revision: number;
  lines: DraftLine[];
  /** The owner before the draft's latest `taken_over` event; null when it was never taken over. */
  takenOverFrom: { personId: string; name: string } | null;
}

export { normaliseDraftLines };

/** A line as the till saves it: without the id a save gives it or the flag a read works out. */
export type DraftLineInput = Omit<DraftLine, "id" | "unavailable">;

export interface SaveDraftInput {
  /** Null asks for the operator's new draft on the party. */
  draftId: string | null;
  revision: number;
  /** Screened by the save before it reads or writes anything. */
  lines: unknown;
}

/** One unsent draft on a party, as the floor shows it: `lineCount` counts rows, not units. */
export interface UnsentDraft {
  ownerName: string;
  lineCount: number;
}

/**
 * Every open draft on the party, whoever owns it, each line marked by {@link unavailable} against
 * the zone's live offers. The mark is worked out on each read and never stored.
 */
export async function readDrafts(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
): Promise<Draft[]> {
  return readOpenDrafts(tx, cfg, partyId);
}

/**
 * Replace the lines of the operator's draft with `input.lines`, added together by
 * {@link normaliseDraftLines}, or start the operator's draft on the party when `draftId` is null. A
 * save to an existing draft moves its revision on; no save moves the party's, and none sends
 * anything to the kitchen.
 */
export async function saveDraft(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  operatorId: string,
  input: SaveDraftInput,
): Promise<Draft> {
  const lines = parseDraftLines(input.lines);
  await requireOpenParty(tx, partyId);
  await requireCourses(tx, cfg, lines);
  let draftId: string;
  if (input.draftId === null) {
    const [held] = await openDraftsOn(tx, partyId, operatorId);
    if (held !== undefined) {
      throw new AppError("draft.out_of_date", { draftId: held.id, revision: held.revision });
    }
    draftId = newId();
    await tx.insert(orderDrafts).values({ id: draftId, partyId, ownerId: operatorId });
    await recordDraftEvents(tx, {
      draftId,
      kind: "created",
      fromPerson: null,
      toPerson: operatorId,
      actorId: operatorId,
      detail: {},
    });
  } else {
    const draft = await requireDraft(tx, foldIfUuid(input.draftId), partyId);
    await requireOwnDraftAt(tx, draft, operatorId, input.revision);
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
  return readOpenDraft(tx, cfg, partyId, draftId);
}

/**
 * Make the operator the owner of another person's open draft. Where the operator already has an
 * open draft on the party, the taken lines are added to it, as a save adds lines, and the taken
 * draft is discarded, so no one holds two; the operator's draft is returned. Taking over one's own
 * draft changes nothing and returns it as it is. A draft of another party is not found.
 */
export async function takeOverDraft(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  draftId: string,
  operatorId: string,
  revision: number,
): Promise<Draft> {
  const draft = await requireDraft(tx, foldIfUuid(draftId), partyId);
  await requireOpenParty(tx, partyId);
  if (draft.ownerId === operatorId) return readOpenDraft(tx, cfg, partyId, draft.id);
  requireDraftRevision(draft, revision);
  const [own] = await openDraftsOn(tx, partyId, operatorId);
  await tx
    .update(orderDrafts)
    .set({
      ownerId: operatorId,
      revision: draft.revision + 1,
      updatedAt: nowIso(),
      ...(own === undefined ? {} : { state: "discarded" as const }),
    })
    .where(eq(orderDrafts.id, draft.id));
  await recordDraftEvents(tx, {
    draftId: draft.id,
    kind: "taken_over",
    fromPerson: draft.ownerId,
    toPerson: operatorId,
    actorId: operatorId,
    detail: {},
  });
  if (own === undefined) return readOpenDraft(tx, cfg, partyId, draft.id);
  await addDiscardedDraft(tx, draft.id, own, operatorId, operatorId);
  return readOpenDraft(tx, cfg, partyId, own.id);
}

/**
 * A merge's drafts (D2): each open draft on `fromPartyId` moves to `intoPartyId`, unless its owner
 * already has an open draft there; then its lines are added to that draft, as a takeover into the
 * taker's own draft adds them, and it is discarded. Every draft this touches has its revision moved
 * on. A merge naming no operator records the owner as the one who discarded.
 */
export async function moveDraftsToParty(
  tx: Transaction,
  fromPartyId: string,
  intoPartyId: string,
  operatorId: string | undefined,
): Promise<void> {
  const moving = await openDraftsOn(tx, fromPartyId);
  if (moving.length === 0) return;
  const held = new Map(
    (await openDraftsOn(tx, intoPartyId)).map((draft) => [draft.ownerId, draft] as const),
  );
  const moved = moving.filter((draft) => !held.has(draft.ownerId));
  const absorbed = moving.filter((draft) => held.has(draft.ownerId));
  if (moved.length > 0) {
    await tx
      .update(orderDrafts)
      .set({
        partyId: intoPartyId,
        revision: sql`${orderDrafts.revision} + 1`,
        updatedAt: nowIso(),
      })
      .where(
        inArray(
          orderDrafts.id,
          moved.map((draft) => draft.id),
        ),
      );
  }
  await discardDrafts(
    tx,
    absorbed.map((draft) => draft.id),
  );
  for (const draft of absorbed) {
    const actorId = operatorId ?? draft.ownerId;
    await addDiscardedDraft(tx, draft.id, held.get(draft.ownerId)!, draft.ownerId, actorId);
  }
}

/** Finishing a table: every open draft on the party is discarded with an event, its lines kept. */
export async function discardPartyDrafts(
  tx: Transaction,
  partyId: string,
  operatorId: string,
): Promise<void> {
  const open = await openDraftsOn(tx, partyId);
  if (open.length === 0) return;
  await discardDrafts(
    tx,
    open.map((draft) => draft.id),
  );
  await recordDraftEvents(
    tx,
    ...open.map((draft) => ({
      draftId: draft.id,
      kind: "discarded" as const,
      fromPerson: draft.ownerId,
      toPerson: draft.ownerId,
      actorId: operatorId,
      detail: {},
    })),
  );
}

export interface SubmitDraftInput extends PartyCommandArgs {
  draftRevision: number;
  /** Lines of the draft's current revision, each named once across the groups. */
  groups: { lineIds: string[]; release: GroupRelease }[];
  /** As `submitGroups` takes it: add the one held group's lines to this held group. */
  joinGroupId?: string;
  /** As `submitGroups` takes it: the bill of the party the lines go on. */
  billId?: string;
}

/** The groups placed, and the operator's draft as it is left: null once every line was sent. */
export type SubmittedDraft = SubmittedGroups & { draft: Draft | null };

/**
 * Send the named lines of the operator's own draft as groups, through {@link placeGroups}, so each
 * line is credited to the operator and each group submitted by them. The sent lines leave the
 * draft and the rest keep their positions; the draft is `submitted` once it has no line left. A
 * retry under the same submission id answers the first result (D8), from the record of `partyId`,
 * where a draft of another party is not found.
 */
export async function submitDraft(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  draftId: string,
  input: SubmitDraftInput,
): Promise<SubmittedDraft> {
  const { operatorId } = input;
  const id = foldIfUuid(draftId);
  const groups = input.groups.map(({ lineIds, release }) => ({
    lineIds: lineIds.map(foldIfUuid),
    release,
  }));
  const joinGroupId = input.joinGroupId === undefined ? undefined : foldIfUuid(input.joinGroupId);
  return runServiceCommand(
    tx,
    { kind: "visit", partyId },
    input.submissionId,
    "draft.submit",
    { partyId, draftId: id, operatorId, groups, joinGroupId, billId: input.billId },
    async () => {
      const draft = await requireDraft(tx, id, partyId);
      await requireOwnDraftAt(tx, draft, operatorId, input.draftRevision);
      await checkAndBumpParty(tx, partyId, input.expectedPartyRevision, "open");
      const lines = (await storedLines(tx, [id])).map(({ line }) => line);
      const known = new Set(lines.map((line) => line.id));
      const named = new Set<string>();
      for (const lineId of groups.flatMap((group) => group.lineIds)) {
        if (!known.has(lineId) || named.has(lineId)) throw invalid("groups");
        named.add(lineId);
      }
      const placed = await placeGroups(tx, cfg, partyId, {
        groups: groups.map(({ lineIds, release }) => {
          const inGroup = new Set(lineIds);
          return { release, lines: lines.filter((line) => inGroup.has(line.id)).map(groupLine) };
        }),
        joinGroupId,
        operatorId,
        billId: input.billId,
        revisionMoved: true,
      });
      const emptied = named.size === lines.length;
      await tx.delete(orderDraftLines).where(inArray(orderDraftLines.id, [...named]));
      await tx
        .update(orderDrafts)
        .set({
          revision: draft.revision + 1,
          updatedAt: nowIso(),
          ...(emptied ? { state: "submitted" as const } : {}),
        })
        .where(eq(orderDrafts.id, id));
      await recordDraftEvents(tx, {
        draftId: id,
        kind: "submitted",
        fromPerson: operatorId,
        toPerson: operatorId,
        actorId: operatorId,
        detail: { groupIds: placed.groups.map((group) => group.id) },
      });
      return { ...placed, draft: emptied ? null : await readOpenDraft(tx, cfg, partyId, id) };
    },
  );
}

/** Each party's open drafts holding at least one line, oldest first, in one query. */
export async function readUnsentDrafts(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, UnsentDraft[]>> {
  const unsent = new Map<string, UnsentDraft[]>(partyIds.map((id) => [id, []]));
  if (partyIds.length === 0) return unsent;
  const rows = await tx
    .select({
      partyId: orderDrafts.partyId,
      ownerName: persons.displayName,
      lineCount: sql<number>`cast(count(${orderDraftLines.id}) as int)`,
    })
    .from(orderDrafts)
    .innerJoin(orderDraftLines, eq(orderDraftLines.draftId, orderDrafts.id))
    .leftJoin(persons, eq(persons.id, orderDrafts.ownerId))
    .where(and(inArray(orderDrafts.partyId, [...partyIds]), eq(orderDrafts.state, "open")))
    .groupBy(orderDrafts.id)
    .orderBy(asc(orderDrafts.createdAt), asc(orderDrafts.id));
  for (const row of rows) {
    unsent.get(row.partyId)!.push({ ownerName: row.ownerName ?? "", lineCount: row.lineCount });
  }
  return unsent;
}

const QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A UUID in lower case, the spelling the stored ids and the merge key compare in. */
function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw invalid(field);
  return value.toLowerCase();
}

/** An id a line may leave out: absent or null is none. */
function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return uuid(value, field);
}

/** An id that is no UUID names nothing, so it is kept as sent and then refused or not found. */
function foldIfUuid(id: string): string {
  return isUuid(id) ? id.toLowerCase() : id;
}

/** A draft line as pricing takes a basket line, with each null field left out. */
function groupLine(line: DraftLine): GroupLine {
  return {
    menuItemId: line.menuItemId,
    quantity: line.quantity,
    options: line.options,
    extras: line.extras,
    ...(line.variantId === null ? {} : { variantId: line.variantId }),
    ...(line.menuVersionId === null ? {} : { menuVersionId: line.menuVersionId }),
    ...(line.courseId === null ? {} : { courseId: line.courseId }),
    ...(line.note === null ? {} : { note: line.note }),
  };
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
      options: entry.options === undefined ? [] : readOptionSelections(entry.options),
      extras: entry.extras === undefined ? [] : readExtraSelections(entry.extras),
      note: screenNote(note),
      quantity,
      courseId: optionalId(entry.courseId, field("courseId")),
      noMerge: noMerge ?? false,
    };
  });
}

/**
 * A named course must be one of this location's, as `requireCourse` (kitchen.ts) asks. An inactive
 * one is kept: every save replaces all the lines, so refusing it would leave a line saved before
 * the course was switched off unsavable; submission refuses it.
 */
async function requireCourses(
  tx: Transaction,
  cfg: TillConfig,
  lines: readonly DraftLineInput[],
): Promise<void> {
  const named = [
    ...new Set(lines.flatMap((line) => (line.courseId === null ? [] : [line.courseId]))),
  ];
  if (named.length === 0) return;
  const found = new Set(
    (
      await tx
        .select({ id: kitchenCourses.id })
        .from(kitchenCourses)
        .where(
          and(inArray(kitchenCourses.id, named), eq(kitchenCourses.locationId, cfg.locationId)),
        )
    ).map((row) => row.id),
  );
  const missing = named.find((courseId) => !found.has(courseId));
  if (missing !== undefined) throw new AppError("course.not_found", { courseId: missing });
}

async function requireDraft(tx: Transaction, draftId: string, partyId: string) {
  const [draft] = await tx
    .select({
      id: orderDrafts.id,
      partyId: orderDrafts.partyId,
      ownerId: orderDrafts.ownerId,
      revision: orderDrafts.revision,
      state: orderDrafts.state,
      createdAt: orderDrafts.createdAt,
    })
    .from(orderDrafts)
    .where(eq(orderDrafts.id, draftId));
  if (draft === undefined || draft.state === "discarded" || draft.partyId !== partyId) {
    throw new AppError("draft.not_found", { draftId });
  }
  if (draft.state === "submitted") throw new AppError("draft.already_submitted", { draftId });
  return draft;
}

/** Refuse a draft another person now owns, then one that has moved on since `revision`. */
async function requireOwnDraftAt(
  tx: Transaction,
  draft: { id: string; ownerId: string; revision: number },
  operatorId: string,
  revision: number,
): Promise<void> {
  if (draft.ownerId !== operatorId) {
    throw new AppError("draft.taken_over", {
      draftId: draft.id,
      ownerId: draft.ownerId,
      ownerName: await personName(tx, draft.ownerId),
    });
  }
  requireDraftRevision(draft, revision);
}

function requireDraftRevision(draft: { id: string; revision: number }, revision: number): void {
  if (draft.revision !== revision) {
    throw new AppError("draft.out_of_date", { draftId: draft.id, revision: draft.revision });
  }
}

/** The party's open drafts; with `ownerId`, only that person's, of which there is at most one. */
async function openDraftsOn(tx: Transaction, partyId: string, ownerId?: string) {
  return tx
    .select({ id: orderDrafts.id, ownerId: orderDrafts.ownerId, revision: orderDrafts.revision })
    .from(orderDrafts)
    .where(
      and(
        eq(orderDrafts.partyId, partyId),
        eq(orderDrafts.state, "open"),
        ownerId === undefined ? undefined : eq(orderDrafts.ownerId, ownerId),
      ),
    );
}

/** Mark the drafts discarded, each with its revision moved on. */
async function discardDrafts(tx: Transaction, draftIds: readonly string[]): Promise<void> {
  if (draftIds.length === 0) return;
  await tx
    .update(orderDrafts)
    .set({ state: "discarded", revision: sql`${orderDrafts.revision} + 1`, updatedAt: nowIso() })
    .where(inArray(orderDrafts.id, [...draftIds]));
}

/**
 * Discarding `fromDraftId` into `into`, which its owner holds: the event, then `into`'s lines
 * followed by the discarded draft's, added together and numbered from one, and `into`'s revision
 * moved on. The caller has already marked `fromDraftId` discarded.
 */
async function addDiscardedDraft(
  tx: Transaction,
  fromDraftId: string,
  into: { id: string; revision: number },
  ownerId: string,
  actorId: string,
): Promise<void> {
  await recordDraftEvents(tx, {
    draftId: fromDraftId,
    kind: "discarded",
    fromPerson: ownerId,
    toPerson: ownerId,
    actorId,
    detail: { intoDraftId: into.id },
  });
  const stored = await storedLines(tx, [into.id, fromDraftId]);
  const combined = [
    ...stored.filter(({ draftId }) => draftId === into.id),
    ...stored.filter(({ draftId }) => draftId === fromDraftId),
  ].map(({ line }) => line);
  await replaceLines(tx, [into.id, fromDraftId], into.id, normaliseDraftLines(combined));
  await tx
    .update(orderDrafts)
    .set({ revision: into.revision + 1, updatedAt: nowIso() })
    .where(eq(orderDrafts.id, into.id));
}

async function personName(tx: Transaction, personId: string): Promise<string> {
  const [person] = await tx
    .select({ displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, personId));
  return person?.displayName ?? "";
}

type DraftEvent = typeof orderDraftEvents.$inferInsert;

async function recordDraftEvents(tx: Transaction, ...events: DraftEvent[]): Promise<void> {
  await tx.insert(orderDraftEvents).values(events);
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

/** One open draft of the party, which the caller knows is there. */
async function readOpenDraft(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  draftId: string,
): Promise<Draft> {
  return (await readOpenDrafts(tx, cfg, partyId, draftId))[0]!;
}

async function readOpenDrafts(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  draftId?: string,
): Promise<Draft[]> {
  const drafts = await tx
    .select({
      id: orderDrafts.id,
      partyId: orderDrafts.partyId,
      ownerId: orderDrafts.ownerId,
      ownerName: persons.displayName,
      revision: orderDrafts.revision,
    })
    .from(orderDrafts)
    .leftJoin(persons, eq(persons.id, orderDrafts.ownerId))
    .where(
      and(
        eq(orderDrafts.partyId, partyId),
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
    partyId,
    lines.map(({ line }) => line.menuItemId),
  );
  const takenFrom = await takenOverFrom(
    tx,
    drafts.map((draft) => draft.id),
  );
  return drafts.map((draft) => ({
    ...draft,
    ownerName: draft.ownerName ?? "",
    takenOverFrom: takenFrom.get(draft.id) ?? null,
    lines: lines
      .filter((stored) => stored.draftId === draft.id)
      .map(({ line }) => ({
        ...line,
        unavailable: unavailable(line, offers.get(line.menuItemId)),
      })),
  }));
}

/**
 * Each draft's owner before its latest `taken_over` event, named as the floor names an owner. The
 * latest is the last by `rowid`, not `created_at`, which a clock stepped back can put out of order:
 * SQLite gives a new row one more than the table's largest `rowid`, and this table is append-only.
 * `VACUUM` and `VACUUM INTO` kept that order when measured (node:sqlite, Node v26.7.0, 2026-09-28).
 */
async function takenOverFrom(
  tx: Transaction,
  draftIds: readonly string[],
): Promise<Map<string, { personId: string; name: string }>> {
  const rows = await tx
    .select({
      draftId: orderDraftEvents.draftId,
      personId: orderDraftEvents.fromPerson,
      name: persons.displayName,
    })
    .from(orderDraftEvents)
    .leftJoin(persons, eq(persons.id, orderDraftEvents.fromPerson))
    .where(
      and(
        inArray(orderDraftEvents.draftId, [...draftIds]),
        eq(orderDraftEvents.kind, "taken_over"),
      ),
    )
    .orderBy(sql`${orderDraftEvents}.rowid`);
  return new Map(
    rows.map((row) => [row.draftId, { personId: row.personId!, name: row.name ?? "" }] as const),
  );
}

/** The live offers for the menu items in the zone of {@link partyZone}; none when there is no zone. */
async function offersFor(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  menuItemIds: readonly string[],
): Promise<Map<string, ZoneMenuOffer>> {
  if (menuItemIds.length === 0) return new Map();
  const zoneId = await partyZone(tx, cfg, partyId);
  if (zoneId === null) return new Map();
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
