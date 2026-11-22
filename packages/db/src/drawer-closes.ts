import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  AppError,
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimalToCents,
  rawCentsToDecimal,
  subtractDecimal,
  type Decimal,
} from "@waitron/shared";
import type { Transaction } from "./client.js";
import { appendDrawerEntry } from "./drawer-entries.js";
import { drawerEntries } from "./schema/drawer-entries.js";
import "./errors.js";

type Entry = typeof drawerEntries.$inferSelect;
type DrawerActor = Pick<Entry, "printerId" | "nodeId" | "deviceId" | "personId" | "recordedAt">;
type CountInput = { counted: Decimal; startSequence: number };
type CountFacts = {
  expected: Decimal;
  startSequence: number;
  throughSequence: number;
  cashMovedWhileCounting: boolean;
};
type FinishFacts = {
  amountLeft: Decimal;
  difference: Decimal;
  throughSequence: number;
};

const zero = centsToDecimal(0);

async function readDrawer(tx: Transaction, printerId: string) {
  const onDrawer = eq(drawerEntries.printerId, printerId);
  const [previous] = await tx
    .select()
    .from(drawerEntries)
    .where(and(onDrawer, eq(drawerEntries.kind, "finish")))
    .orderBy(desc(drawerEntries.sequence))
    .limit(1);
  const openingCash = previous === undefined ? zero : (previous.facts as FinishFacts).amountLeft;
  const afterClose = previous?.sequence ?? 0;
  const [last] = await tx
    .select({ sequence: drawerEntries.sequence })
    .from(drawerEntries)
    .where(onDrawer)
    .orderBy(desc(drawerEntries.sequence))
    .limit(1);
  const [first, recount] = await tx
    .select()
    .from(drawerEntries)
    .where(
      and(
        onDrawer,
        gt(drawerEntries.sequence, afterClose),
        inArray(drawerEntries.kind, ["count", "recount"]),
      ),
    )
    .orderBy(desc(eq(drawerEntries.kind, "count")), desc(drawerEntries.sequence))
    .limit(2);
  return { printerId, openingCash, afterClose, sequence: last?.sequence ?? 0, first, recount };
}

type Drawer = Awaited<ReturnType<typeof readDrawer>>;

async function cashSince(tx: Transaction, printerId: string, sequence: number) {
  const [total] = await tx
    .select({
      amount: sql<string>`cast(coalesce(sum(${drawerEntries.amount}), 0) as text)`,
      last: sql<number | null>`max(${drawerEntries.sequence})`,
    })
    .from(drawerEntries)
    .where(
      and(
        eq(drawerEntries.printerId, printerId),
        gt(drawerEntries.sequence, sequence),
        inArray(drawerEntries.kind, ["cash_payment", "cash_refund", "cash_in", "cash_out"]),
      ),
    );
  return { amount: rawCentsToDecimal(total!.amount), last: total!.last ?? sequence };
}

export async function drawerNeedsClose(tx: Transaction, printerId: string): Promise<boolean> {
  const drawer = await readDrawer(tx, printerId);
  if (drawer.first !== undefined) return true;
  const cash = await cashSince(tx, printerId, drawer.afterClose);
  return compareDecimal(addDecimal(drawer.openingCash, cash.amount), zero) !== 0;
}

function savedCount(row: Entry) {
  const { expected, cashMovedWhileCounting, throughSequence } = row.facts as CountFacts;
  const counted = centsToDecimal(row.amount);
  return {
    id: row.id,
    personId: row.personId,
    recordedAt: row.recordedAt,
    counted,
    expected,
    difference: subtractDecimal(counted, expected),
    cashMovedWhileCounting,
    throughSequence,
  };
}

function savedFinish(row: Entry) {
  return {
    state: "finished" as const,
    id: row.id,
    firstCountId: row.firstCountId!,
    personId: row.personId,
    recordedAt: row.recordedAt,
    bankWithdrawal: centsToDecimal(row.amount),
    ...(row.facts as FinishFacts),
  };
}

async function pendingClose(
  tx: Transaction,
  drawer: Drawer,
  first: Entry,
  recount = drawer.recount,
) {
  const lastCount = recount ?? first;
  const moved = await cashSince(tx, drawer.printerId, lastCount.sequence);
  return {
    state: "counted" as const,
    openingCash: drawer.openingCash,
    first: savedCount(first),
    recount: recount === undefined ? null : savedCount(recount),
    available: addDecimal(centsToDecimal(lastCount.amount), moved.amount),
    confirmSequence: drawer.sequence,
  };
}

export async function readDrawerClose(tx: Transaction, printerId: string) {
  const drawer = await readDrawer(tx, printerId);
  return drawer.first === undefined
    ? { state: "new" as const, openingCash: drawer.openingCash, startSequence: drawer.sequence }
    : pendingClose(tx, drawer, drawer.first);
}

function checkStartSequence(drawer: Drawer, startSequence: number, earliest: number) {
  if (startSequence < earliest || startSequence > drawer.sequence)
    throw new AppError("drawer.close_changed", {});
}

async function writeCount(
  tx: Transaction,
  actor: DrawerActor,
  drawer: Drawer,
  input: CountInput,
  firstCountId: string | null,
) {
  const cash = await cashSince(tx, drawer.printerId, drawer.afterClose);
  const facts: CountFacts = {
    expected: addDecimal(drawer.openingCash, cash.amount),
    startSequence: input.startSequence,
    throughSequence: drawer.sequence,
    cashMovedWhileCounting: cash.last > input.startSequence,
  };
  return appendDrawerEntry(tx, {
    ...actor,
    kind: firstCountId === null ? "count" : "recount",
    amount: decimalToCents(input.counted),
    firstCountId,
    facts,
  });
}

export async function saveDrawerCount(tx: Transaction, actor: DrawerActor, input: CountInput) {
  const drawer = await readDrawer(tx, actor.printerId);
  checkStartSequence(drawer, input.startSequence, drawer.afterClose);
  if (drawer.first !== undefined) return pendingClose(tx, drawer, drawer.first);
  const first = await writeCount(tx, actor, drawer, input, null);
  return pendingClose(tx, { ...drawer, sequence: first.sequence }, first);
}

export async function recountDrawer(
  tx: Transaction,
  actor: DrawerActor,
  input: CountInput & { firstCountId: string },
) {
  const drawer = await readDrawer(tx, actor.printerId);
  const { first, recount } = drawer;
  if (first?.id !== input.firstCountId) throw new AppError("drawer.close_not_found", {});
  const pending = await pendingClose(tx, drawer, first);
  const facts = recount?.facts as CountFacts | undefined;
  if (
    recount !== undefined &&
    facts?.startSequence === input.startSequence &&
    recount.amount === decimalToCents(input.counted)
  ) {
    return pending;
  }
  if (
    compareDecimal(pending.available, zero) >= 0 &&
    (recount !== undefined || compareDecimal(pending.first.difference, zero) === 0)
  ) {
    throw new AppError("drawer.recount_unavailable", {});
  }
  checkStartSequence(drawer, input.startSequence, (recount ?? first).sequence);

  const saved = await writeCount(tx, actor, drawer, input, first.id);
  return pendingClose(tx, { ...drawer, sequence: saved.sequence }, first, saved);
}

export async function finishDrawerClose(
  tx: Transaction,
  actor: DrawerActor,
  input: { firstCountId: string; amountLeft: Decimal; confirmSequence: number },
  onFinished?: (close: ReturnType<typeof savedFinish>) => Promise<void>,
) {
  const drawer = await readDrawer(tx, actor.printerId);
  if (drawer.first?.id !== input.firstCountId) {
    const [finished] = await tx
      .select()
      .from(drawerEntries)
      .where(
        and(
          eq(drawerEntries.printerId, actor.printerId),
          eq(drawerEntries.firstCountId, input.firstCountId),
          eq(drawerEntries.kind, "finish"),
        ),
      );
    if (finished === undefined) throw new AppError("drawer.close_not_found", {});
    const saved = savedFinish(finished);
    if (
      saved.throughSequence !== input.confirmSequence ||
      compareDecimal(saved.amountLeft, input.amountLeft) !== 0
    )
      throw new AppError("drawer.close_changed", {});
    return saved;
  }
  if (input.confirmSequence !== drawer.sequence) throw new AppError("drawer.close_changed", {});
  const pending = await pendingClose(tx, drawer, drawer.first);
  const bank = subtractDecimal(pending.available, input.amountLeft);
  if (compareDecimal(input.amountLeft, zero) < 0 || compareDecimal(bank, zero) < 0) {
    throw new AppError("drawer.close_invalid_amount", { field: "amountLeft" });
  }
  const facts: FinishFacts = {
    amountLeft: centsToDecimal(decimalToCents(input.amountLeft)),
    difference: (pending.recount ?? pending.first).difference,
    throughSequence: drawer.sequence,
  };
  const finished = savedFinish(
    await appendDrawerEntry(tx, {
      ...actor,
      kind: "finish",
      firstCountId: drawer.first.id,
      amount: decimalToCents(bank),
      facts,
    }),
  );
  await onFinished?.(finished);
  return finished;
}
