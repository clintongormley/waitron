import { eq, inArray } from "drizzle-orm";
import {
  parties,
  products,
  workingOrderLines,
  workingOrders,
  type AllergenMap,
  type Transaction,
} from "@waitron/db";
import {
  effectiveProductColumns,
  parentJoin,
  parentProducts,
  staffPresentationName,
} from "@waitron/catalogue";
import type {
  AllergyDish,
  AllergySendTarget,
  PartyAllergyRead,
  AllergyLineRef,
  AllergyPatch,
  AllergyChangeSet,
  AllergyCommand,
  PartyAllergySnapshot,
} from "@waitron/module";
import {
  AppError,
  isUuid,
  compareDecimal,
  decimal,
  QUANTITY_SCALE,
  toScale,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { VENUE_SERVICE } from "./modules.js";
import { readDrafts } from "./order-drafts.js";
import { readCurrentOrders, requireGroup, type CurrentOrderRow } from "./order-groups.js";
import { fingerprint, partyFamily, partyZone } from "./parties.js";
import { extraQuantityFor } from "./working-order.js";
import "./errors.js";

function invalid(field: string): never {
  throw new AppError("allergy.invalid", { field });
}

export async function survivingParty(tx: Transaction, partyId: string): Promise<string> {
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(partyId)) invalid("partyId");
    seen.add(partyId);
    const [party] = await tx.select().from(parties).where(eq(parties.id, partyId));
    if (party === undefined) invalid("partyId");
    if (party.mergedIntoPartyId === null) return partyId;
    partyId = party.mergedIntoPartyId;
  }
}

async function productNutrition(tx: Transaction, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, AllergenMap | null>();
  const rows = await tx
    .select({ id: products.id, allergens: effectiveProductColumns.allergens })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(products.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row.allergens as AllergenMap | null]));
}

function active(row: CurrentOrderRow): boolean {
  return compareDecimal(decimal(row.quantity), decimal(row.cancelledQuantity ?? "0")) > 0;
}

async function readAllergyState(tx: Transaction, cfg: TillConfig, requestedPartyId: string) {
  const partyId = await survivingParty(tx, requestedPartyId);
  const family = await partyFamily(tx, partyId);
  const current = await readCurrentOrders(tx, partyId);
  const rows = [...current.groups.flatMap((group) => group.rows), ...current.ungrouped];
  const drafts = [];
  for (const id of family) drafts.push(...(await readDrafts(tx, cfg, id)));
  const stored = await tx
    .select({ line: workingOrderLines })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(inArray(workingOrders.partyId, family));
  const storedById = new Map(stored.map(({ line }) => [line.id, line]));
  const nutrition = await productNutrition(tx, [
    ...stored.flatMap(({ line }) => (line.productId === null ? [] : [line.productId])),
    ...drafts.flatMap((draft) =>
      draft.lines.flatMap((line) =>
        line.sourceLineId === null
          ? line.extras.flatMap((list) => list.picks.map((pick) => pick.productId))
          : [],
      ),
    ),
  ]);
  const allergens = (lineId: string): AllergenMap | null => {
    const id = storedById.get(lineId)?.productId;
    return id == null ? null : (nutrition.get(id) ?? null);
  };
  const dishes: AllergyDish[] = rows.map((row) => ({
    line: { kind: "working", id: row.lineId },
    billId: row.workingOrderId,
    name: row.name,
    quantity: row.quantity,
    allergens: allergens(row.lineId),
    extras: row.extras.map((extra) => ({
      name: extra.name,
      quantity: extra.quantity,
      allergens: allergens(extra.lineId),
    })),
    sentAt: storedById.get(row.lineId)!.sentAt,
    offeredBefore: true,
  }));
  const freshIds = drafts.flatMap((draft) =>
    draft.lines.flatMap((line) => (line.sourceLineId === null ? [line.menuItemId] : [])),
  );
  const zoneId = await partyZone(tx, cfg, partyId);
  const offers = new Map(
    zoneId === null || freshIds.length === 0
      ? []
      : (
          await VENUE_SERVICE.listZoneOffers(tx, cfg, zoneId, {
            menuItemIds: [...new Set(freshIds)],
            withDefault: false,
          })
        ).offers.map((offer) => [offer.id, offer]),
  );
  for (const draft of drafts) {
    for (const line of draft.lines) {
      if (line.sourceLineId !== null) {
        const { source } = line;
        dishes.push({
          line: { kind: "working", id: line.sourceLineId },
          billId: draft.billId,
          name: source.line.name,
          quantity: line.quantity,
          allergens: allergens(line.sourceLineId),
          extras: source.extras.map((extra) => ({
            name: extra.name,
            quantity: extra.quantity,
            allergens: allergens(extra.id),
          })),
          sentAt: source.line.sentAt,
          offeredBefore: true,
        });
        continue;
      }
      const offer = offers.get(line.menuItemId);
      const variant =
        line.variantId === null ? undefined : offer?.variants.find((v) => v.id === line.variantId);
      dishes.push({
        line: { kind: "draft", id: line.id },
        billId: draft.billId,
        name: staffPresentationName({
          name: offer?.name ?? "",
          variantName: variant?.name ?? null,
        }),
        quantity: line.quantity,
        allergens:
          line.variantId === null ? (offer?.allergens ?? null) : (variant?.allergens ?? null),
        extras: line.extras.flatMap((selection) => {
          const list = offer?.offeredModifiers.find(
            (m) => m.kind === "extras" && m.id === selection.listId,
          );
          return selection.picks.map((pick) => {
            const item =
              list?.kind === "extras"
                ? list.items.find((i) => i.productId === pick.productId)
                : undefined;
            return {
              name: item?.name ?? "",
              quantity: toScale(
                extraQuantityFor(
                  pick.quantity,
                  decimal(line.quantity),
                  decimal(item?.portion ?? "1"),
                ),
                QUANTITY_SCALE,
              ),
              allergens: nutrition.get(pick.productId) ?? null,
            };
          });
        }),
        sentAt: null,
        offeredBefore: false,
      });
    }
  }
  const view: PartyAllergyRead = {
    partyId,
    snapshot: await VENUE_SERVICE.readPartyAllergy(tx, partyId),
    dishes,
  };
  return { view, current, rows, drafts, storedById, family };
}

export async function readPartyAllergyView(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
): Promise<PartyAllergyRead> {
  return (await readAllergyState(tx, cfg, partyId)).view;
}

export async function readAllergySendView(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  target: AllergySendTarget,
): Promise<PartyAllergyRead> {
  const { view, current, rows, drafts, storedById, family } = await readAllergyState(
    tx,
    cfg,
    partyId,
  );
  let chosen: Set<string>;
  if (target.kind === "draft") {
    const draft = drafts.find((d) => d.id === target.draftId);
    if (
      draft === undefined ||
      target.lineIds.length === 0 ||
      new Set(target.lineIds).size !== target.lineIds.length
    )
      invalid("lineIds");
    chosen = new Set(
      target.lineIds.map((id) => {
        const line = draft.lines.find((l) => l.id === id);
        if (line === undefined) invalid("lineIds");
        return line.sourceLineId === null ? `draft:${line.id}` : `working:${line.sourceLineId}`;
      }),
    );
  } else if (target.kind === "group") {
    const state = await requireGroup(tx, view.partyId, target.groupId);
    chosen = new Set(
      state === "held"
        ? current.groups
            .find((g) => g.id === target.groupId)!
            .rows.filter(active)
            .map((r) => `working:${r.lineId}`)
        : [],
    );
  } else if (target.kind === "held-line") {
    const group = current.groups.find((g) => g.rows.some((r) => r.lineId === target.lineId));
    if (group === undefined) throw new AppError("group.not_found", { lineId: target.lineId });
    if (group.state !== "held") throw new AppError("group.not_held", { groupId: group.id });
    chosen = new Set(
      group.rows
        .filter((r) => r.lineId === target.lineId && active(r))
        .map((r) => `working:${r.lineId}`),
    );
  } else {
    const [bill] = await tx
      .select()
      .from(workingOrders)
      .where(eq(workingOrders.id, target.orderId));
    if (bill?.partyId == null || !family.includes(bill.partyId) || bill.status === "abandoned")
      invalid("orderId");
    if (target.kind === "course") {
      const groups = current.groups.filter(
        (g) =>
          g.state === "held" &&
          g.rows.some((r) => r.workingOrderId === target.orderId && r.courseId === target.courseId),
      );
      chosen = new Set([
        ...groups.flatMap((g) => g.rows.filter(active).map((r) => `working:${r.lineId}`)),
        ...current.ungrouped
          .filter(
            (r) =>
              r.workingOrderId === target.orderId &&
              r.courseId === target.courseId &&
              !r.released &&
              active(r),
          )
          .map((r) => `working:${r.lineId}`),
      ]);
    } else {
      for (const n of target.lineNos) {
        if (!Number.isSafeInteger(n) || n < 1) invalid("lineNos");
        const named = [...storedById.values()].find(
          (l) => l.workingOrderId === target.orderId && l.lineNo === n,
        );
        if (named === undefined) continue;
        if (named.parentLineId !== null) invalid("lineNos");
        const held = current.groups.find(
          (g) => g.state === "held" && g.rows.some((r) => r.lineId === named.id),
        );
        if (held !== undefined)
          throw new AppError("group.line_held", { tabId: target.orderId, lineNo: n });
        if (!rows.some((r) => r.lineId === named.id)) invalid("lineNos");
      }
      chosen = new Set(
        rows
          .filter(
            (r) =>
              r.workingOrderId === target.orderId &&
              !r.released &&
              active(r) &&
              (target.lineNos.length === 0 || target.lineNos.includes(r.lineNo)) &&
              !current.groups.some(
                (g) => g.state === "held" && g.rows.some((i) => i.lineId === r.lineId),
              ),
          )
          .map((r) => `working:${r.lineId}`),
      );
    }
  }
  return {
    ...view,
    dishes: view.dishes.filter(
      (d) => d.line.kind !== "submitted" && chosen.has(`${d.line.kind}:${d.line.id}`),
    ),
  };
}

export interface ResolvedAllergyTarget {
  ref: AllergyLineRef;
  draftLineId: string | null;
  workingLineId: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refKey(value: unknown, field: string): string {
  if (!record(value)) invalid(field);
  if (value.kind === "draft" || value.kind === "working") {
    if (typeof value.id !== "string" || !isUuid(value.id)) invalid(field);
    return `${value.kind}:${value.id.toLowerCase()}`;
  }
  if (
    value.kind === "submitted" &&
    Number.isSafeInteger(value.groupIndex) &&
    Number.isSafeInteger(value.lineIndex) &&
    (value.groupIndex as number) >= 0 &&
    (value.lineIndex as number) >= 0
  )
    return `submitted:${value.groupIndex as number}:${value.lineIndex as number}`;
  return invalid(field);
}

export function normaliseAllergyPatch(patch: AllergyPatch): AllergyPatch {
  if (!record(patch)) invalid("allergy");
  if (!Array.isArray(patch.ticks)) invalid("ticks");
  if (patch.party !== undefined && (!record(patch.party) || !Array.isArray(patch.party.guests)))
    invalid("party");
  return {
    ...patch,
    ...(patch.party === undefined
      ? {}
      : {
          party: {
            ...patch.party,
            guests: patch.party.guests.map((guest, index) => {
              if (!record(guest)) invalid(`guests.${index}`);
              if (guest.id !== undefined && (typeof guest.id !== "string" || !isUuid(guest.id)))
                invalid(`guests.${index}.id`);
              return {
                ...guest,
                ...(guest.id === undefined ? {} : { id: guest.id.toLowerCase() }),
              };
            }),
          },
        }),
    ticks: patch.ticks.map((tick, index) => {
      if (!record(tick)) invalid(`ticks.${index}.line`);
      refKey(tick.line, `ticks.${index}.line`);
      return {
        ...tick,
        line:
          tick.line.kind === "submitted"
            ? tick.line
            : { ...tick.line, id: tick.line.id.toLowerCase() },
      };
    }),
  };
}

export function allergyTargets(view: PartyAllergyRead): ResolvedAllergyTarget[] {
  return view.dishes.flatMap((dish) =>
    dish.line.kind === "submitted"
      ? []
      : [
          {
            ref: dish.line,
            draftLineId: dish.line.kind === "draft" ? dish.line.id : null,
            workingLineId: dish.line.kind === "working" ? dish.line.id : null,
          },
        ],
  );
}

export async function applyPartyAllergyPatch(
  tx: Transaction,
  partyId: string,
  patch: AllergyPatch,
  operatorId: string,
  allowedTargets: readonly ResolvedAllergyTarget[],
): Promise<AllergyChangeSet> {
  if (!record(patch)) invalid("allergy");
  if (!Array.isArray(patch.ticks)) invalid("ticks");
  const before = await VENUE_SERVICE.readPartyAllergy(tx, partyId);
  if (patch.party !== undefined)
    await VENUE_SERVICE.writePartyAllergy(tx, partyId, patch.party, operatorId);
  const edited = await VENUE_SERVICE.readPartyAllergy(tx, partyId);
  const targets = new Map(
    allowedTargets.map((target) => {
      if ((target.draftLineId === null) === (target.workingLineId === null)) invalid("line");
      return [refKey(target.ref, "line"), target] as const;
    }),
  );
  const seen = new Set<string>();
  const ticks = patch.ticks.map((tick: unknown, index) => {
    const field = (name: string) => `ticks.${index}.${name}`;
    if (!record(tick)) invalid(field("line"));
    const target = targets.get(refKey(tick.line, field("line")));
    if (target === undefined) invalid(field("line"));
    const storedKey =
      target.draftLineId === null
        ? `working:${target.workingLineId!}`
        : `draft:${target.draftLineId}`;
    if (seen.has(storedKey)) invalid(field("line"));
    seen.add(storedKey);
    const guestIndex = tick.guestIndex;
    if (
      guestIndex !== null &&
      (typeof guestIndex !== "number" ||
        !Number.isSafeInteger(guestIndex) ||
        guestIndex < 0 ||
        guestIndex >= edited.guests.length)
    )
      invalid(field("guestIndex"));
    return {
      draftLineId: target.draftLineId,
      workingLineId: target.workingLineId,
      guestId: guestIndex === null ? null : edited.guests[guestIndex as number]!.id,
    };
  });
  await VENUE_SERVICE.setAllergyLineTicks(
    tx,
    partyId,
    ticks.filter((tick) => tick.draftLineId !== null),
  );
  await VENUE_SERVICE.setAllergyLineTicks(
    tx,
    partyId,
    ticks.filter((tick) => tick.workingLineId !== null),
  );
  const after = await VENUE_SERVICE.readPartyAllergy(tx, partyId);
  const assignments = (snapshot: PartyAllergySnapshot) =>
    new Map(
      snapshot.ticks.flatMap((tick) => {
        if (tick.workingLineId === null) return [];
        const guest = snapshot.guests.find((g) => g.id === tick.guestId)!;
        return [
          [
            tick.workingLineId,
            fingerprint({
              guest: {
                id: guest.id,
                who: guest.who,
                allergens: guest.allergens,
                note: guest.note,
              },
            }),
          ] as const,
        ];
      }),
    );
  const oldAssignments = assignments(before);
  const newAssignments = assignments(after);
  const workingLineIds = [...new Set([...oldAssignments.keys(), ...newAssignments.keys()])]
    .filter((id) => oldAssignments.get(id) !== newAssignments.get(id))
    .sort();
  return { partyId, before, after, workingLineIds };
}

export async function assertPartyAllergyAnswered(tx: Transaction, partyId: string): Promise<void> {
  const snapshot = await VENUE_SERVICE.readPartyAllergy(tx, partyId);
  if (snapshot.answer === null) throw new AppError("allergy.unanswered", { partyId });
}

export async function prepareAllergyRelease(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  target: AllergySendTarget,
  allergy: AllergyCommand["allergy"],
  personId: string | null,
): Promise<void> {
  const view = await readAllergySendView(tx, cfg, partyId, target);
  if (view.dishes.length === 0) return;
  if (allergy !== undefined) {
    if (personId === null) invalid("allergy");
    await applyPartyAllergyPatch(tx, view.partyId, allergy, personId, allergyTargets(view));
  }
  await assertPartyAllergyAnswered(tx, view.partyId);
}
