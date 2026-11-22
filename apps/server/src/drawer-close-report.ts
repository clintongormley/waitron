import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  devices,
  drawerEntries,
  isReceiptPrinter,
  persons,
  printers,
  type Transaction,
} from "@waitron/db";
import {
  addDecimal,
  centsToDecimal,
  rawCentsToDecimal,
  subtractDecimal,
  type Decimal,
} from "@waitron/shared";

const recount = alias(drawerEntries, "recount");
const newerRecount = alias(drawerEntries, "newer_recount");
const finish = alias(drawerEntries, "finish");
const firstPerson = alias(persons, "first_person");
const recountPerson = alias(persons, "recount_person");
const finishPerson = alias(persons, "finish_person");
const reportDate = sql<string>`coalesce(${finish.recordedAt}, ${drawerEntries.recordedAt})`;

type Entry = typeof drawerEntries.$inferSelect;
type Filter = { startAt: string; endAt: string } | { finishId: string };

function count(row: Entry, person: string) {
  const counted = centsToDecimal(row.amount);
  const expected = row.facts!.expected as Decimal;
  return {
    person,
    at: row.recordedAt,
    expected,
    counted,
    difference: subtractDecimal(counted, expected),
    cashMoved: row.facts!.cashMovedWhileCounting === true,
  };
}

async function readRows(tx: Transaction, nodeIds: readonly string[], filter: Filter) {
  const related = (
    entry: typeof recount | typeof newerRecount | typeof finish,
    kind: "recount" | "finish",
  ) =>
    and(
      eq(entry.firstCountId, drawerEntries.id),
      eq(entry.printerId, drawerEntries.printerId),
      eq(entry.kind, kind),
      inArray(entry.nodeId, nodeIds),
    );
  const selection =
    "finishId" in filter
      ? eq(finish.id, filter.finishId)
      : or(
          isNull(finish.id),
          and(gte(finish.recordedAt, filter.startAt), lt(finish.recordedAt, filter.endAt)),
        );
  return tx
    .select({
      first: drawerEntries,
      firstName: firstPerson.displayName,
      recount,
      recountName: recountPerson.displayName,
      finish,
      finishName: finishPerson.displayName,
      drawerName: printers.name,
      deleted: sql<boolean>`${printers.deletedAt} is not null`.mapWith(Boolean),
      assigned: sql<boolean>`exists (
        select 1 from ${devices}
        where ${devices.cashDrawerPrinterId} = ${printers.id} and ${devices.active} = 1
      )`.mapWith(Boolean),
    })
    .from(drawerEntries)
    .innerJoin(printers, and(eq(printers.id, drawerEntries.printerId), isReceiptPrinter()))
    .innerJoin(firstPerson, eq(firstPerson.id, drawerEntries.personId))
    .leftJoin(recount, related(recount, "recount"))
    .leftJoin(
      newerRecount,
      and(related(newerRecount, "recount"), gt(newerRecount.sequence, recount.sequence)),
    )
    .leftJoin(recountPerson, eq(recountPerson.id, recount.personId))
    .leftJoin(finish, related(finish, "finish"))
    .leftJoin(finishPerson, eq(finishPerson.id, finish.personId))
    .where(
      and(
        eq(drawerEntries.kind, "count"),
        inArray(drawerEntries.nodeId, nodeIds),
        selection,
        isNull(newerRecount.id),
      ),
    )
    .orderBy(desc(reportDate), desc(drawerEntries.sequence), asc(drawerEntries.id));
}

function history(row: Awaited<ReturnType<typeof readRows>>[number]) {
  const first = count(row.first, row.firstName);
  const recounted = row.recount === null ? null : count(row.recount, row.recountName!);
  const finished = row.finish;
  const bankWithdrawal = finished === null ? null : centsToDecimal(finished.amount);
  const amountLeft = finished?.facts?.amountLeft as Decimal | undefined;
  return {
    id: row.first.id,
    drawerId: row.first.printerId,
    drawerName: row.drawerName,
    assigned: row.assigned,
    deleted: row.deleted,
    first,
    recount: recounted,
    finished:
      finished === null
        ? null
        : {
            id: finished.id,
            person: row.finishName!,
            at: finished.recordedAt,
            bankWithdrawal: bankWithdrawal!,
            amountLeft: amountLeft!,
            difference: finished.facts!.difference as Decimal,
            cashAfterCount: subtractDecimal(
              addDecimal(bankWithdrawal!, amountLeft!),
              (recounted ?? first).counted,
            ),
          },
  };
}

export async function listDrawerCloses(
  tx: Transaction,
  nodeIds: readonly string[],
  selection: Extract<Filter, { startAt: string }>,
) {
  return (await readRows(tx, nodeIds, selection)).map(history);
}

export async function readDrawerCloseForPrint(
  tx: Transaction,
  nodeIds: readonly string[],
  finishId: string,
) {
  const [row] = await readRows(tx, nodeIds, { finishId });
  if (row === undefined) return null;

  const onDrawer = and(
    eq(drawerEntries.printerId, row.first.printerId),
    inArray(drawerEntries.nodeId, nodeIds),
  );
  const [previous] = await tx
    .select({ at: drawerEntries.recordedAt, sequence: drawerEntries.sequence })
    .from(drawerEntries)
    .where(
      and(
        onDrawer,
        eq(drawerEntries.kind, "finish"),
        lt(drawerEntries.sequence, row.first.sequence),
      ),
    )
    .orderBy(desc(drawerEntries.sequence))
    .limit(1);

  const amounts = await tx
    .select({
      kind: drawerEntries.kind,
      amount: sql<string>`cast(sum(${drawerEntries.amount}) as text)`,
      firstAt: sql<string>`min(${drawerEntries.recordedAt})`,
    })
    .from(drawerEntries)
    .where(
      and(
        onDrawer,
        gt(drawerEntries.sequence, previous?.sequence ?? 0),
        lt(drawerEntries.sequence, row.finish!.sequence),
        inArray(drawerEntries.kind, [
          "cash_payment",
          "cash_refund",
          "cash_in",
          "cash_out",
          "card_payment",
        ]),
      ),
    )
    .groupBy(drawerEntries.kind);
  const total = (kind: Entry["kind"]) =>
    rawCentsToDecimal(amounts.find((movement) => movement.kind === kind)?.amount ?? "0");
  const close = history(row);
  return {
    drawerName: close.drawerName,
    from:
      previous?.at ??
      [row.first.recordedAt, ...amounts.map((movement) => movement.firstAt)].sort()[0]!,
    finished: close.finished!,
    count: close.recount ?? close.first,
    cashSales: total("cash_payment"),
    cashRefunds: total("cash_refund"),
    cashIn: total("cash_in"),
    cashOut: total("cash_out"),
    cardPayments: total("card_payment"),
  };
}

export type DrawerCloseForPrint = NonNullable<Awaited<ReturnType<typeof readDrawerCloseForPrint>>>;
