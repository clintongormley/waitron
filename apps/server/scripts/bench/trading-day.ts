import { randomUUID } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { ticketItems, withTransaction, workingOrders } from "@waitron/db";
import { DEFAULT_SKIP_RETRY_MS, drain } from "@waitron/fiscal-verifactu";
import { quoteIdent } from "@waitron/provisioning";
import { computeDailyClose, recordDailyClose, resolveVenueClock } from "@waitron/reporting";
import { addDecimal, businessDayBounds, decimal } from "@waitron/shared";
import { createFakeAeat, type FakeAeat } from "@waitron/verifactu/testing";
import { runAttendancePass } from "../../src/attendance-loop.js";
import { readBillEditState, readPartyBillIds } from "../../src/bill-editing.js";
import { deploymentEnvironment } from "../../src/config.js";
import { partyFamily } from "../../src/parties.js";
import { SESSION_COOKIE } from "../../src/till-session.js";
import { currentBenchClock } from "./bench-clock.js";
import { seededRandom, type BenchTill, type BenchVenue } from "./bench-venue.js";
import { BENCH_PROFILE, paymentRoutesFor, type PaymentRoute } from "./profile.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const OPENING_FLOAT = "150.00";
const NO_ALLERGY = { party: { answer: "none", guests: [] }, ticks: [] };
const INVOICE_RECIPIENT = {
  taxId: "B12345674",
  legalName: "Bench Client SL",
  address: "2 Main Street, 28013 Madrid, Madrid",
  countryCode: "ES",
};
/** A held round is sent this long before it is due, while the round before it is still eaten. */
const HELD_AHEAD_MINUTES = 6;

export interface TradeDayOptions {
  /** Seat the day's bills evenly between these instants rather than over lunch and dinner. */
  seats?: { from: Date; to: Date };
  /** Called before each bill is seated, with its index in the day; a throw stops the day there. */
  beforeBill?: (index: number) => void | Promise<void>;
}

export interface BillResult {
  seatedAt: Date;
  finishedAt: Date;
  route: PaymentRoute;
}

export interface DayResult {
  day: string;
  bills: BillResult[];
  routes: Record<PaymentRoute, number>;
  requests: number;
  filed: { submitted: number; accepted: number; halted: number };
  attendancePasses: number;
}

/** A route that answered anything but success: the bench never expects one. */
export class BenchRefusal extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`bench: ${method} ${path} answered ${status}: ${body}`);
  }
}

interface PlannedBill {
  index: number;
  seatAt: number;
  guests: number;
  zone: BenchVenue["zones"][number];
  till: BenchTill;
  rounds: string[][];
  /** Per round: sent ahead and held, then fired when due. Never the first round. */
  held: boolean[];
  /** The guest asks for a full invoice before paying. */
  invoice: boolean;
  route: PaymentRoute;
}

interface LiveBill {
  plan: PlannedBill;
  tableId?: string;
  partyId?: string;
  tabId?: string;
  groupIds: string[];
  tickets: { id: string; stationId: string }[][];
  seatedAt?: Date;
}

type Step =
  | { kind: "seat" }
  | { kind: "allergy" }
  | { kind: "round"; round: number; release: "fire" | "hold" }
  | { kind: "fire"; round: number }
  | { kind: "invoice" }
  | { kind: "advance"; round: number; to: "preparing" | "ready" }
  | { kind: "served"; round: number }
  | { kind: "pay" }
  | { kind: "finish" }
  | { kind: "handOver" };

interface Event {
  at: number;
  bill: number;
  order: number;
  step: Step;
}

const fakes = new WeakMap<BenchVenue, FakeAeat>();

/**
 * Trades `bills` bills on business day `day` through the routes a till sends, then runs what boot
 * would run in the background overnight: filing to a fake AEAT, the attendance passes, and the
 * daily close. Every step is dated by the bench clock, which this moves forward.
 */
export async function tradeDay(
  venue: BenchVenue,
  day: string,
  bills: number,
  options: TradeDayOptions = {},
): Promise<DayResult> {
  const clock = currentBenchClock();
  const bounds = businessDayBounds(
    { timeZone: BENCH_PROFILE.timeZone, dayCutover: BENCH_PROFILE.dayCutover, cutoverChanges: [] },
    day,
  );
  const plans = planDay(venue, day, bills, Date.parse(bounds.startAt), options.seats);
  const events = dayEvents(plans);
  const routes: Record<PaymentRoute, number> = {
    pay: 0,
    "payments-reader": 0,
    "payments-cash": 0,
    collect: 0,
  };
  let requests = 0;
  const call = async (cookie: string, method: string, path: string, body?: unknown) => {
    requests += 1;
    const response = await venue.app.request(path, {
      method,
      headers: { cookie, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new BenchRefusal(method, path, response.status, text);
    return { json: (text === "" ? null : JSON.parse(text)) as Record<string, unknown>, response };
  };

  const agentCall = async (path: string, body: unknown) => {
    requests += 1;
    const response = await venue.app.request(path, {
      method: "POST",
      headers: { authorization: venue.printAgentAuthorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new BenchRefusal("POST", path, response.status, text);
    return (text === "" ? null : JSON.parse(text)) as Record<string, unknown>;
  };

  // Each printer prints as a working one does: whenever a step has queued a job, the print agent
  // claims every job due and reports each one printed before the next step, so no job outlives
  // the till's waiting time (`JOBS_WAITING_MS`, apps/server/src/print-job-trouble.ts).
  let printedThrough = -1;
  const printQueued = async () => {
    const top = venue.db.all<{ top: number }>(
      sql`select coalesce(max(rowid), 0) as top from print_jobs`,
    )[0]!.top;
    if (top === printedThrough) return;
    for (;;) {
      const pull = await agentCall("/print-api/agent/jobs", {});
      const jobs = pull.jobs as { id: string; invoiceClaim?: unknown }[];
      if (jobs.length === 0) break;
      for (const job of jobs)
        await agentCall(`/print-api/agent/jobs/${job.id}/result`, {
          status: "done",
          ...(job.invoiceClaim === undefined ? {} : { invoiceClaim: job.invoiceClaim }),
        });
    }
    printedThrough = top;
  };

  const firstSeat = Math.min(...plans.map((plan) => plan.seatAt));
  const opening = firstSeat - 30 * MINUTE;
  // The clock never runs back, so a day already behind it would be traded at the wrong time.
  if (clock.now().getTime() > opening)
    throw new Error(
      `bench: day ${day} opens before the bench clock's ${clock.now().toISOString()}`,
    );
  clock.set(new Date(opening));
  const sessions = new Map<string, string>();
  const waiterOf = new Map<string, string>();
  const onShift = shiftOf(venue, day);
  for (const [index, till] of venue.tills.entries()) {
    const waiter = onShift[index % onShift.length]!;
    const { response } = await call(till.cookie, "POST", "/api/session", {
      personId: waiter.id,
      pin: waiter.pin,
    });
    const token = /waitron_till_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
    if (token === null) throw new Error("bench: signing in set no session cookie");
    sessions.set(till.id, `${SESSION_COOKIE}=${token[1]}; ${till.cookie}`);
    waiterOf.set(till.id, waiter.id);
  }

  const live = plans.map((plan): LiveBill => ({ plan, groupIds: [], tickets: [] }));
  const taken = new Set<string>();
  const results: BillResult[] = [];
  const revision = (partyId: string) =>
    venue.db.all<{ revision: number }>(sql`select revision from parties where id = ${partyId}`)[0]!
      .revision;
  const editOf = (tabId: string) => withTransaction(venue.db, (tx) => readBillEditState(tx, tabId));

  for (const event of events) {
    clock.set(new Date(event.at));
    const bill = live[event.bill]!;
    const { plan } = bill;
    const cookie = sessions.get(plan.till.id)!;
    const step = event.step;
    if (step.kind === "seat") {
      await options.beforeBill?.(plan.index);
      bill.tableId = freeTable(venue, plan, taken);
      taken.add(bill.tableId);
      const { json } = await call(cookie, "POST", `/api/tables/${bill.tableId}/seat`, {
        guestCount: plan.guests,
      });
      bill.partyId = json.partyId as string;
      bill.tabId = json.tabId as string;
      bill.seatedAt = clock.now();
    } else if (step.kind === "allergy") {
      await call(cookie, "PUT", `/api/parties/${bill.partyId}/allergy`, {
        submissionId: randomUUID(),
        expectedPartyRevision: revision(bill.partyId!),
        allergy: NO_ALLERGY,
      });
    } else if (step.kind === "round") {
      // As the till does: the waiter's unsent dishes are saved as a draft, then the draft is sent.
      const edit = await editOf(bill.tabId!);
      const { json: saved } = await call(cookie, "PUT", `/api/parties/${bill.partyId}/drafts`, {
        billId: bill.tabId,
        draftId: edit.draftId,
        revision: edit.draftRevision ?? 0,
        expectedEdit: edit,
        personId: waiterOf.get(plan.till.id),
        lines: plan.rounds[step.round]!.map((menuItemId) => ({ menuItemId, quantity: "1" })),
      });
      const draft = saved.draft as { id: string; revision: number; lines: { id: string }[] };
      const { json: submitted } = await call(
        cookie,
        "POST",
        `/api/parties/${bill.partyId}/drafts/${draft.id}/submit`,
        {
          submissionId: randomUUID(),
          expectedPartyRevision: revision(bill.partyId!),
          expectedEdit: saved.edit,
          draftRevision: draft.revision,
          groups: [{ lineIds: draft.lines.map((line) => line.id), release: step.release }],
        },
      );
      bill.groupIds[step.round] = (submitted.groups as { id: string }[])[0]!.id;
      bill.tickets[step.round] = await newTickets(venue, bill);
    } else if (step.kind === "fire") {
      await call(
        cookie,
        "POST",
        `/api/parties/${bill.partyId}/groups/${bill.groupIds[step.round]}/fire`,
        { submissionId: randomUUID(), expectedPartyRevision: revision(bill.partyId!) },
      );
    } else if (step.kind === "invoice") {
      const [order] = await venue.db
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, bill.tabId!));
      await call(cookie, "PUT", `/api/working-orders/${bill.tabId}/invoice-choice`, {
        revision: order!.revision,
        invoiceType: "F1",
        recipient: INVOICE_RECIPIENT,
        expectedEdit: await editOf(bill.tabId!),
      });
    } else if (step.kind === "advance") {
      for (const ticket of bill.tickets[step.round]!)
        await call(cookie, "POST", `/api/ticket-items/${ticket.id}/advance`, {
          stationId: ticket.stationId,
          to: step.to,
        });
    } else if (step.kind === "served") {
      await call(
        cookie,
        "POST",
        `/api/parties/${bill.partyId}/groups/${bill.groupIds[step.round]}/served`,
        { submissionId: randomUUID(), expectedPartyRevision: revision(bill.partyId!) },
      );
    } else if (step.kind === "pay") {
      await pay(bill, cookie, call, editOf);
      const [order] = await venue.db
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, bill.tabId!));
      if (order?.status !== "settled")
        throw new Error(`bench: bill ${bill.tabId} is ${order?.status} after ${plan.route}`);
      routes[plan.route] += 1;
    } else if (step.kind === "handOver") {
      // A table bill's dishes stay on their stations' lists until a till collects the paid order.
      await call(cookie, "POST", `/api/orders/${bill.tabId}/collect`, {
        submissionId: randomUUID(),
      });
    } else {
      const expectedEdits = await withTransaction(venue.db, async (tx) => {
        const edits = [];
        for (const id of await readPartyBillIds(tx, await partyFamily(tx, bill.partyId!)))
          edits.push(await readBillEditState(tx, id));
        return edits;
      });
      await call(cookie, "POST", `/api/parties/${bill.partyId}/finish`, {
        expectedPartyRevision: revision(bill.partyId!),
        expectedEdits,
        submissionId: randomUUID(),
      });
      taken.delete(bill.tableId!);
      results.push({ seatedAt: bill.seatedAt!, finishedAt: clock.now(), route: plan.route });
      // Synchronous SQLite starves the venue watchdog's timer unless the loop gets a turn.
      if (results.length % 25 === 0) await nextTurn();
    }
    await printQueued();
  }

  clock.set(new Date(Math.max(...events.map((event) => event.at)) + 5 * MINUTE));
  for (const till of venue.tills) await call(sessions.get(till.id)!, "DELETE", "/api/session");

  const overnight = await closeDay(venue, day, new Date(Date.parse(bounds.endAt) + 30 * MINUTE));
  await printQueued();
  return { day, bills: results, routes, requests, ...overnight };
}

/** The bill's ticket items not yet assigned to any of its rounds; a held round's exist unfired. */
async function newTickets(venue: BenchVenue, bill: LiveBill) {
  const known = new Set(bill.tickets.flat().map((ticket) => ticket.id));
  const tickets = await venue.db
    .select({ id: ticketItems.id, stationId: ticketItems.stationId })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, bill.tabId!))
    .orderBy(sql`rowid`);
  return tickets.filter((ticket) => !known.has(ticket.id));
}

type Call = (
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ json: Record<string, unknown> }>;

async function pay(
  bill: LiveBill,
  cookie: string,
  call: Call,
  editOf: (tabId: string) => Promise<unknown>,
): Promise<void> {
  const tabId = bill.tabId!;
  const route = bill.plan.route;
  if (route === "pay") {
    await call(cookie, "POST", "/api/pay", {
      id: tabId,
      lines: [],
      expectedEdit: await editOf(tabId),
    });
    return;
  }
  const { json: balance } = await call(cookie, "GET", `/api/working-orders/${tabId}/payments`);
  const due = balance.outstanding as string;
  if (route === "collect") {
    await call(cookie, "POST", `/api/working-orders/${tabId}/place`, {
      expectedEdit: await editOf(tabId),
    });
    await call(cookie, "POST", `/api/working-orders/${tabId}/collect`, {
      expectedEdit: await editOf(tabId),
      tender: { method: "cash", amount: cashHandedOver(due) },
    });
    return;
  }
  const common = {
    submissionId: randomUUID(),
    expectedEdit: await editOf(tabId),
    kind: "contribution",
    amount: due,
    applied: due,
    tip: "0.00",
  };
  await call(
    cookie,
    "POST",
    `/api/working-orders/${tabId}/payments`,
    route === "payments-reader"
      ? { ...common, method: "card", entry: "reader" }
      : { ...common, method: "cash", tendered: cashHandedOver(due) },
  );
}

/** The note a guest hands over: the bill rounded up to the next five euros. */
function cashHandedOver(due: string): string {
  return (Math.ceil(Number(due) / 5) * 5).toFixed(2);
}

/** What boot runs in the background once the day has ended, and the close the bench adds. */
async function closeDay(venue: BenchVenue, day: string, at: Date) {
  const clock = currentBenchClock();
  clock.set(at);
  const now = clock.now();
  let aeat = fakes.get(venue);
  if (aeat === undefined) {
    aeat = createFakeAeat({ serverNow: now });
    fakes.set(venue, aeat);
  }
  aeat.setServerNow(now);
  const client = aeat.client();
  const filing = await drain(
    {
      db: venue.db,
      resolveClient: () => Promise.resolve(client),
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      environment: deploymentEnvironment({}),
    },
    now,
  );
  let attendancePasses = 0;
  for (let more = true; more; attendancePasses++) {
    if (attendancePasses > 10_000) throw new Error("bench: the attendance passes never settled");
    more = (
      await runAttendancePass({
        db: venue.db,
        nodeId: venue.nodeId,
        now: () => clock.now(),
        isPrimary: () => true,
      })
    ).more;
    if (attendancePasses % 25 === 0) await nextTurn();
  }
  await withTransaction(venue.db, async (tx) => {
    const close = await computeDailyClose(tx, {
      nodeId: venue.nodeId,
      businessDay: day,
      ...(await resolveVenueClock(tx, venue.nodeId)),
    });
    // Every drawer that took cash is counted, and holds exactly its float and its takings.
    const cashCounts = close.cash.byOrigin.flatMap((row) =>
      row.deviceId === null || !row.byMethod.some((entry) => entry.method === "cash")
        ? []
        : [
            {
              deviceId: row.deviceId,
              openingFloat: OPENING_FLOAT,
              payouts: "0.00",
              countedCash: addDecimal(decimal(OPENING_FLOAT), row.cashTakings),
            },
          ],
    );
    await recordDailyClose(tx, {
      nodeId: venue.nodeId,
      businessDay: day,
      timeZone: BENCH_PROFILE.timeZone,
      closedBy: venue.manager.id,
      cashCounts,
    });
  });
  return {
    filed: {
      submitted: filing.recordsSubmitted,
      accepted: filing.recordsAccepted,
      halted: filing.recordsHalted,
    },
    attendancePasses,
  };
}

function daySeed(seed: number, day: string): number {
  let hash = seed >>> 0;
  for (const char of day) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash;
}

/** The waiters on shift: one per till, chosen afresh each day. */
function shiftOf(venue: BenchVenue, day: string) {
  const random = seededRandom(daySeed(venue.seed, `${day}:shift`));
  return [...venue.waiters]
    .map((waiter) => ({ waiter, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ waiter }) => waiter);
}

/** What planning a day reads of the venue. */
export type PlanningVenue = Pick<BenchVenue, "seed" | "dishes" | "zones" | "tills">;

export function planDay(
  venue: PlanningVenue,
  day: string,
  bills: number,
  dayStart: number,
  seats: TradeDayOptions["seats"],
): PlannedBill[] {
  const random = seededRandom(daySeed(venue.seed, day));
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const between = (from: number, to: number) => from + Math.floor(random() * (to - from + 1));
  const routes = paymentRoutesFor(bills);
  // Its own sequence, so holding rounds leaves every other draw of the day as it was.
  const holds = seededRandom(daySeed(venue.seed, `${day}:hold`));
  const invoices = seededRandom(daySeed(venue.seed, `${day}:invoice`));
  const invoiceChance =
    BENCH_PROFILE.invoiceShare /
    (BENCH_PROFILE.paymentMix["payments-reader"] + BENCH_PROFILE.paymentMix["payments-cash"]);
  const seatTimes: number[] = [];
  if (seats !== undefined) {
    const span = seats.to.getTime() - seats.from.getTime();
    for (let i = 0; i < bills; i++)
      seatTimes.push(seats.from.getTime() + (bills === 1 ? 0 : (span * i) / (bills - 1)));
  } else {
    // Local lunch from 13:00 to 15:30 and dinner from 20:30 to 23:30: the day starts at 05:00.
    const services = [
      { from: dayStart + 8 * HOUR, span: 2.5 * HOUR },
      { from: dayStart + 15.5 * HOUR, span: 3 * HOUR },
    ];
    for (let i = 0; i < bills; i++) {
      const service = services[i < bills / 2 ? 0 : 1]!;
      seatTimes.push(service.from + Math.floor(random() * service.span));
    }
    seatTimes.sort((a, b) => a - b);
  }
  let previousDelta = 0;
  const plans = seatTimes.map((seatAt, index): PlannedBill => {
    // Paired bills hold exactly twice the mean between them, so any even count of bills does too.
    const delta = index % 2 === 0 ? between(-1, 1) : -previousDelta;
    previousDelta = delta;
    const lines = BENCH_PROFILE.linesPerBill + delta;
    const roundCount = Math.min(
      lines,
      between(BENCH_PROFILE.roundsPerBill.min, BENCH_PROFILE.roundsPerBill.max),
    );
    const dishes = new Set<string>();
    while (dishes.size < lines) dishes.add(pick(venue.dishes).menuItemId);
    const ordered = [...dishes];
    const rounds: string[][] = Array.from({ length: roundCount }, () => []);
    ordered.forEach((dish, n) => rounds[n % roundCount]!.push(dish));
    const zone = pick(venue.zones);
    const tills = venue.tills.filter((till) => till.departmentId === zone.departmentId);
    return {
      index,
      seatAt,
      guests: between(1, 6),
      zone,
      till: pick(tills),
      rounds,
      held: rounds.map((_, round) => round > 0 && holds() < BENCH_PROFILE.heldRoundShare),
      invoice: routes[index]!.startsWith("payments-") && invoices() < invoiceChance,
      route: routes[index]!,
    };
  });
  return waitForTables(venue, plans);
}

/**
 * A full room makes the next party wait: each bill, in the order it arrived, takes the table in its
 * department that frees first, and is seated then if that is later than it arrived.
 */
function waitForTables(venue: PlanningVenue, plans: PlannedBill[]): PlannedBill[] {
  const freeAt = new Map<string, number[]>();
  for (const zone of venue.zones)
    freeAt.set(zone.departmentId, [
      ...(freeAt.get(zone.departmentId) ?? []),
      ...zone.tableIds.map(() => -Infinity),
    ]);
  for (const plan of plans) {
    const tables = freeAt.get(plan.zone.departmentId)!;
    const first = tables.indexOf(Math.min(...tables));
    const stay = eventsOf(plan).find((event) => event.step.kind === "finish")!.at - plan.seatAt;
    // Seated the instant a table frees, it still sorts after that finish: the bill leaving arrived
    // first, so it has the lower index.
    plan.seatAt = Math.max(plan.seatAt, tables[first]!);
    tables[first] = plan.seatAt + stay;
  }
  return plans;
}

/** Every step of the day's bills, in the order `tradeDay` sends them. */
export function dayEvents(plans: readonly PlannedBill[]): Event[] {
  return plans
    .flatMap(eventsOf)
    .sort((a, b) => a.at - b.at || a.bill - b.bill || a.order - b.order);
}

function eventsOf(plan: PlannedBill): Event[] {
  const events: Event[] = [];
  let order = 0;
  const at = (minutes: number, step: Step) =>
    events.push({ at: plan.seatAt + minutes * MINUTE, bill: plan.index, order: order++, step });
  at(0, { kind: "seat" });
  at(1, { kind: "allergy" });
  plan.rounds.forEach((_, round) => {
    const start = 3 + round * 18;
    if (plan.held[round]) {
      at(start - HELD_AHEAD_MINUTES, { kind: "round", round, release: "hold" });
      at(start, { kind: "fire", round });
    } else at(start, { kind: "round", round, release: "fire" });
    at(start + 2, { kind: "advance", round, to: "preparing" });
    at(start + 9, { kind: "advance", round, to: "ready" });
    at(start + 12, { kind: "served", round });
  });
  const end = 3 + plan.rounds.length * 18;
  if (plan.invoice) at(end + 5, { kind: "invoice" });
  at(end + 6, { kind: "pay" });
  at(end + 8, { kind: "finish" });
  at(end + 9, { kind: "handOver" });
  return events;
}

function freeTable(venue: BenchVenue, plan: PlannedBill, taken: Set<string>): string {
  const sameDepartment = venue.zones.filter((zone) => zone.departmentId === plan.zone.departmentId);
  for (const zone of [plan.zone, ...sameDepartment]) {
    const table = zone.tableIds.find((id) => !taken.has(id));
    if (table !== undefined) return table;
  }
  throw new Error(`bench: no free table for bill ${plan.index}`);
}

/** Rows in every table of the venue database. */
export function countRows(venue: BenchVenue): Record<string, number> {
  const tables = venue.db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables)
    counts[name] = venue.db.all<{ n: number }>(
      sql.raw(`select count(*) as n from ${quoteIdent(name)}`),
    )[0]!.n;
  return counts;
}
