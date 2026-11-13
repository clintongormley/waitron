import type { PassBoard } from "../../src/pass-card.js";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { cpus, hostname, totalmem } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import {
  devices,
  deviceProfiles,
  kitchenStations,
  printJobs,
  orderGroups,
  ticketItems,
  withTransaction,
  workingOrders,
  workingOrderLines,
} from "@waitron/db";
import { DEFAULT_SKIP_RETRY_MS, drain } from "@waitron/fiscal-verifactu";
import { PERSON_HEADER } from "@waitron/shared";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { readBillEditState, readPartyBillIds } from "../../src/bill-editing.js";
import { deploymentEnvironment } from "../../src/config.js";
import { VENUE_SERVICE } from "../../src/modules.js";
import { partyFamily } from "../../src/parties.js";
import { offerOnProfile } from "../../src/testing/enrol.js";
import { SESSION_COOKIE } from "../../src/till-session.js";
import { installBenchClock, type BenchClock } from "./bench-clock.js";
import { openBenchVenue, type BenchVenue } from "./bench-venue.js";
import {
  COPY_DIR,
  copyFolder,
  gitCommit,
  SESSION_FILE,
  VOLUME_FILE,
  type BenchSession,
} from "./build-year.js";
import { BenchRefusal } from "./trading-day.js";
import { runtime, type Runtime } from "./runtime.js";

export const CASE_NAMES = [
  "payment.partial",
  "payment.final",
  "sale.counter",
  "floor.read",
  "floor.open",
  "kitchen.queue",
  "kitchen.screen",
  "kitchen.pass",
  "kitchen.pass-screen",
  "dashboard.open",
  "kitchen.pass-release",
  "print.problems",
  // Last: each sample adds 50 sales, which every case after it would also read.
  "filing.pass",
] as const;

const FLOOR_TABLES = 15;
const ITEMS_PER_FLOOR_TABLE = 2;
const FILING_BATCH = 50;
const NO_ALLERGY = { party: { answer: "none", guests: [] }, ticks: [] };

export type Timer = (run: () => Promise<unknown>) => Promise<void>;

/** What one sample answered, and how much of its set-up its final answer showed. */
export interface Sample {
  outcome: string;
  seen: number;
}

export interface BenchCase {
  name: string;
  /** Sets up, calls `time` exactly once around the request being measured, then cleans up. */
  sample: (time: Timer) => Promise<Sample>;
}

export interface BenchGroup {
  /** Runs before the group's cases, once a round. */
  prepare?: () => Promise<void>;
  cases: BenchCase[];
}

export interface RoundTiming {
  round: number;
  count: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface CaseTiming {
  name: string;
  /** Each outcome a sample answered, with how many samples answered it. */
  outcomes: Record<string, number>;
  /** The least set-up any sample's answer showed: seated tables, open items, filed sales. */
  leastSeen: number;
  rounds: RoundTiming[];
}

export interface Machine {
  hostname: string;
  cpu: string;
  cores: number;
  memoryBytes: number;
  platform: string;
}

export interface MeasureResult extends Runtime {
  load: "idle";
  machine: Machine;
  commit: string | null;
  seed: number;
  profile: unknown;
  totalRows: number;
  samples: number;
  rounds: number;
  cases: CaseTiming[];
}

export interface OpenedRound {
  groups: BenchGroup[];
  close(): Promise<void>;
}

export interface SampleOptions {
  samples: number;
  rounds: number;
  now?: () => number;
}

/** Runs every group's cases `samples` times a round, a round after another. */
export async function sampleRounds(
  groups: BenchGroup[] | ((round: number) => Promise<OpenedRound>),
  options: SampleOptions,
): Promise<CaseTiming[]> {
  const now = options.now ?? (() => performance.now());
  const timings = new Map<string, CaseTiming>();
  for (let round = 1; round <= options.rounds; round++) {
    const opened =
      typeof groups === "function" ? await groups(round) : { groups, close: async () => {} };
    try {
      for (const group of opened.groups) {
        await group.prepare?.();
        for (const benchCase of group.cases) {
          const entry = timings.get(benchCase.name) ?? {
            name: benchCase.name,
            outcomes: {},
            leastSeen: Infinity,
            rounds: [],
          };
          timings.set(benchCase.name, entry);
          const durations: number[] = [];
          for (let n = 0; n < options.samples; n++) {
            let calls = 0;
            let duration = 0;
            const sample = await benchCase.sample(async (run) => {
              calls += 1;
              const started = now();
              await run();
              duration = now() - started;
            });
            if (calls !== 1)
              throw new Error(`bench: case ${benchCase.name} timed ${calls} runs, not one`);
            durations.push(duration);
            entry.outcomes[sample.outcome] = (entry.outcomes[sample.outcome] ?? 0) + 1;
            entry.leastSeen = Math.min(entry.leastSeen, sample.seen);
            // Synchronous SQLite starves the venue watchdog's timer unless the loop gets a turn.
            await nextTurn();
          }
          entry.rounds.push({ round, count: durations.length, ...summarise(durations) });
        }
      }
    } finally {
      await opened.close();
    }
  }
  return [...timings.values()];
}

function summarise(durations: number[]) {
  const sorted = [...durations].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return {
    medianMs,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    maxMs: sorted.at(-1)!,
  };
}

export interface MeasureOptions {
  /** A finished `bench build` folder. Each round works on its own copy of `last-day/`. */
  venue: string;
  out: string;
  samples?: number;
  rounds?: number;
}

export async function measureVenue(options: MeasureOptions): Promise<MeasureResult> {
  const samples = options.samples ?? 200;
  const rounds = options.rounds ?? 3;
  const volumePath = join(options.venue, VOLUME_FILE);
  if (!existsSync(volumePath))
    throw new Error(`bench: ${options.venue} holds no ${VOLUME_FILE}: the build has not finished`);
  const volume = JSON.parse(readFileSync(volumePath, "utf8")) as {
    totalRows: number;
    profile: unknown;
  };
  const session = JSON.parse(
    readFileSync(join(options.venue, SESSION_FILE), "utf8"),
  ) as BenchSession;
  const scratch = mkdtempSync(join(options.venue, "measure-"));
  try {
    // Every round starts from the same copy at the same instant, so the rounds measure one state.
    const cases = await sampleRounds(
      async (round) => {
        const copy = join(scratch, `round-${round}`);
        copyFolder(join(options.venue, COPY_DIR), copy);
        const clock = installBenchClock(new Date(session.clockAt));
        try {
          const venue = await openBenchVenue(copy, {
            seed: session.seed,
            deviceCookies: session.deviceCookies,
          });
          return {
            groups: await caseGroups(venue, clock),
            close: async () => {
              try {
                await venue.close();
              } finally {
                clock.uninstall();
                rmSync(copy, { recursive: true, force: true });
              }
            },
          };
        } catch (error) {
          clock.uninstall();
          throw error;
        }
      },
      { samples, rounds },
    );
    const result: MeasureResult = {
      ...runtime(),
      load: "idle",
      machine: machine(),
      commit: gitCommit(),
      seed: session.seed,
      profile: volume.profile,
      totalRows: volume.totalRows,
      samples,
      rounds,
      cases,
    };
    writeFileSync(`${options.out}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
    renameSync(`${options.out}.tmp`, options.out);
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function machine(): Machine {
  const cores = cpus();
  return {
    hostname: hostname(),
    cpu: cores[0]?.model ?? "",
    cores: cores.length,
    memoryBytes: totalmem(),
    platform: `${process.platform}-${process.arch}`,
  };
}

interface Answer {
  status: number;
  body: unknown;
}

async function caseGroups(venue: BenchVenue, clock: BenchClock): Promise<BenchGroup[]> {
  const send = async (as: string, method: string, path: string, body?: unknown) => {
    const response = await venue.app.request(path, {
      method,
      headers: {
        cookie: as,
        "content-type": "application/json",
        ...(as === cookie ? { [PERSON_HEADER]: waiter.id } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, text };
  };
  /** A set-up request: anything but success stops the measurement. */
  const call = async (cookie: string, method: string, path: string, body?: unknown) => {
    const { status, text } = await send(cookie, method, path, body);
    if (status < 200 || status > 299) throw new BenchRefusal(method, path, status, text);
    return (text === "" ? null : JSON.parse(text)) as Record<string, unknown>;
  };
  /** The measured requests, in turn; each body is read inside the timer, as a client reads it. */
  const timed = async (
    time: Timer,
    requests: { cookie: string; method: string; path: string; body?: unknown }[],
  ): Promise<Answer[]> => {
    const answers: { status: number; text: string }[] = [];
    await time(async () => {
      for (const request of requests)
        answers.push(await send(request.cookie, request.method, request.path, request.body));
    });
    return answers.map(({ status, text }, index) => {
      if (status !== 200) {
        const { method, path } = requests[index]!;
        throw new BenchRefusal(method, path, status, text);
      }
      return { status, body: text === "" ? null : JSON.parse(text) };
    });
  };
  const outcomeOf = (answers: Answer[]) => answers.map((answer) => answer.status).join(" ");

  const till = venue.tills[0]!;
  const waiter = venue.waiters[0]!;
  const signedIn = await venue.app.request("/api/session", {
    method: "POST",
    headers: { cookie: till.cookie, "content-type": "application/json" },
    body: JSON.stringify({ personId: waiter.id, pin: waiter.pin }),
  });
  const token = /waitron_till_session=([^;]+)/.exec(signedIn.headers.get("set-cookie") ?? "");
  if (token === null) throw new Error("bench: signing in set no session cookie");
  const cookie = `${SESSION_COOKIE}=${token[1]}; ${till.cookie}`;

  const screen = venue.kitchenScreens[0]!;
  // A kitchen display shows one screen, so the other one is turned into the pass.
  const passScreen = venue.kitchenScreens[1]!;
  const kitchenDishes = venue.db
    .all<{ id: string }>(
      sql`select mi.id as id from menu_items mi join products p on p.id = mi.product_id
          where p.name like 'Mains %' order by p.name`,
    )
    .map((row) => row.id);
  const tables = venue.zones
    .filter((zone) => zone.departmentId === till.departmentId)
    .flatMap((zone) => zone.tableIds);
  const revision = (partyId: string) =>
    venue.db.all<{ revision: number }>(sql`select revision from parties where id = ${partyId}`)[0]!
      .revision;
  const editOf = (tabId: string) => withTransaction(venue.db, (tx) => readBillEditState(tx, tabId));

  let dishTurn = 0;
  const nextDishes = (count: number) =>
    Array.from({ length: count }, () => kitchenDishes[dishTurn++ % kitchenDishes.length]!);

  /** Seats a party at `tableId` and fires one round; `served` takes it to the table. */
  const openBill = async (tableId: string, dishes: string[], served: boolean) => {
    const seated = await call(cookie, "POST", `/api/tables/${tableId}/seat`, { guestCount: 2 });
    const partyId = seated.partyId as string;
    const tabId = seated.tabId as string;
    await call(cookie, "PUT", `/api/parties/${partyId}/allergy`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revision(partyId),
      allergy: NO_ALLERGY,
    });
    await call(cookie, "POST", `/api/parties/${partyId}/groups`, {
      expectedEdit: await editOf(tabId),
      submissionId: randomUUID(),
      expectedPartyRevision: revision(partyId),
      groups: [
        { lines: dishes.map((menuItemId) => ({ menuItemId, quantity: "1" })), release: "fire" },
      ],
    });
    if (served) {
      const [group] = await venue.db
        .select({ id: orderGroups.id })
        .from(orderGroups)
        .where(eq(orderGroups.partyId, partyId));
      const tickets = await venue.db
        .select({ id: ticketItems.id, stationId: ticketItems.stationId })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, tabId));
      for (const to of ["preparing", "ready"])
        for (const ticket of tickets)
          await call(cookie, "POST", `/api/ticket-items/${ticket.id}/advance`, {
            stationId: ticket.stationId,
            to,
          });
      await call(cookie, "POST", `/api/parties/${partyId}/groups/${group!.id}/served`, {
        submissionId: randomUUID(),
        expectedPartyRevision: revision(partyId),
      });
    }
    return { partyId, tabId };
  };
  const outstanding = async (tabId: string) =>
    (await call(cookie, "GET", `/api/working-orders/${tabId}/payments`)).outstanding as string;
  const cashPayment = async (tabId: string, amount: string) => ({
    cookie,
    method: "POST",
    path: `/api/working-orders/${tabId}/payments`,
    body: {
      submissionId: randomUUID(),
      expectedEdit: await editOf(tabId),
      kind: "contribution",
      amount,
      applied: amount,
      tip: "0.00",
      method: "cash",
      tendered: amount,
    },
  });
  const finish = async (partyId: string) => {
    const expectedEdits = await withTransaction(venue.db, async (tx) => {
      const edits = [];
      for (const id of await readPartyBillIds(tx, await partyFamily(tx, partyId)))
        edits.push(await readBillEditState(tx, id));
      return edits;
    });
    await call(cookie, "POST", `/api/parties/${partyId}/finish`, {
      expectedPartyRevision: revision(partyId),
      expectedEdits,
      submissionId: randomUUID(),
    });
  };
  const paymentSample =
    (part: boolean) =>
    async (time: Timer): Promise<Sample> => {
      const bill = await openBill(tables[0]!, nextDishes(4), true);
      const due = await outstanding(bill.tabId);
      const amount = part ? (Math.floor(Number(due) * 50) / 100).toFixed(2) : due;
      const answers = await timed(time, [await cashPayment(bill.tabId, amount)]);
      const [order] = await venue.db
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, bill.tabId));
      if ((order?.status === "settled") === part)
        throw new Error(
          `bench: a ${part ? "part" : "whole"} payment left the bill ${order?.status}`,
        );
      if (part) {
        const rest = await outstanding(bill.tabId);
        const payment = await cashPayment(bill.tabId, rest);
        await call(payment.cookie, payment.method, payment.path, payment.body);
      }
      await finish(bill.partyId);
      return { outcome: outcomeOf(answers), seen: 1 };
    };
  const counterSale = async () => ({
    cookie,
    method: "POST",
    path: "/api/sales",
    body: {
      expectedEdit: null,
      lines: nextDishes(2).map((menuItemId) => ({ menuItemId, quantity: "1" })),
      tender: { method: "cash", amount: "200.00" },
    },
  });

  const floorTabs = new Set<string>();
  /** The floor's own dishes not yet ready, by id: a dish carries a name, its group does not. */
  const openItems = (answer: unknown): number => {
    const open = new Set<string>();
    const walk = (value: unknown, orderId: string | undefined) => {
      if (Array.isArray(value)) for (const entry of value) walk(entry, orderId);
      else if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const here = typeof record.orderId === "string" ? record.orderId : orderId;
        if (
          here !== undefined &&
          floorTabs.has(here) &&
          typeof record.id === "string" &&
          typeof record.name === "string" &&
          typeof record.state === "string" &&
          record.state !== "ready" &&
          record.state !== "served"
        )
          open.add(record.id);
        for (const child of Object.values(record)) walk(child, here);
      }
    };
    walk(answer, undefined);
    return open.size;
  };
  const seatedTables = (state: unknown) =>
    (state as { hasOpenTab: boolean }[]).filter((table) => table.hasOpenTab).length;
  const atLeast = (name: string, seen: number, wanted: number) => {
    if (seen < wanted) throw new Error(`bench: ${name} saw ${seen} of its ${wanted} set up`);
    return seen;
  };

  const aeat = createFakeAeat({ serverNow: clock.now() });
  const client = aeat.client();
  /** One filing pass at an instant past AEAT's wait, so a pass with rows due always sends. */
  const filingPass = async () => {
    const gate = venue.db.all<{ at: string }>(
      sql`select proximo_envio_en as at from envio_flujo where id = 1`,
    )[0];
    if (gate !== undefined) clock.set(new Date(Date.parse(gate.at) + 1000));
    const now = clock.now();
    aeat.setServerNow(now);
    return () =>
      drain(
        {
          db: venue.db,
          resolveClient: () => Promise.resolve(client),
          skipRetryMs: DEFAULT_SKIP_RETRY_MS,
          environment: deploymentEnvironment({}),
        },
        now,
      );
  };

  return [
    {
      cases: [
        { name: "payment.partial", sample: paymentSample(true) },
        { name: "payment.final", sample: paymentSample(false) },
        {
          name: "sale.counter",
          sample: async (time) => ({
            outcome: outcomeOf(await timed(time, [await counterSale()])),
            seen: 1,
          }),
        },
      ],
    },
    {
      // Left open for the rest of the round: the round's copy is thrown away after it.
      prepare: async () => {
        for (const tableId of tables.slice(1, 1 + FLOOR_TABLES))
          floorTabs.add((await openBill(tableId, nextDishes(ITEMS_PER_FLOOR_TABLE), false)).tabId);
        const [device] = await venue.db
          .select({ profileId: devices.deviceProfileId })
          .from(devices)
          .where(eq(devices.id, passScreen.id));
        const pass = { kind: "pass", stationIds: null, zoneIds: null } as const;
        await withTransaction(venue.db, async (tx) => {
          const [profile] = await tx
            .select({ capabilities: deviceProfiles.capabilities })
            .from(deviceProfiles)
            .where(eq(deviceProfiles.id, device!.profileId!));
          const capabilities = profile!.capabilities as string[];
          if (!capabilities.includes("run-the-pass"))
            await tx
              .update(deviceProfiles)
              .set({ capabilities: [...capabilities, "run-the-pass"] })
              .where(eq(deviceProfiles.id, device!.profileId!));
          await offerOnProfile(tx, device!.profileId!, pass);
          await VENUE_SERVICE.setDeviceKitchenScreens(tx, {
            deviceId: passScreen.id,
            profileId: device!.profileId!,
            screens: [pass],
          });
        });
      },
      cases: [
        {
          name: "floor.read",
          sample: async (time) => {
            const answers = await timed(time, [
              { cookie, method: "GET", path: "/api/tables/state" },
            ]);
            return {
              outcome: outcomeOf(answers),
              seen: atLeast("floor.read", seatedTables(answers[0]!.body), FLOOR_TABLES),
            };
          },
        },
        {
          name: "floor.open",
          sample: async (time) => {
            const answers = await timed(time, [
              { cookie, method: "GET", path: "/api/zones" },
              { cookie, method: "GET", path: "/api/tables/state" },
            ]);
            return {
              outcome: outcomeOf(answers),
              seen: atLeast("floor.open", seatedTables(answers[1]!.body), FLOOR_TABLES),
            };
          },
        },
        ...(
          [
            ["kitchen.queue", cookie, `/api/stations/${screen.stationId}/queue`],
            ["kitchen.screen", screen.cookie, "/api/device/station-screen"],
            ["kitchen.pass", cookie, "/api/expo/board"],
            ["kitchen.pass-screen", passScreen.cookie, "/api/device/pass-board"],
          ] as const
        ).map(([name, as, path]): BenchCase => ({
          name,
          sample: async (time) => {
            const answers = await timed(time, [{ cookie: as, method: "GET", path }]);
            return {
              outcome: outcomeOf(answers),
              seen: atLeast(
                name,
                openItems(answers[0]!.body),
                FLOOR_TABLES * ITEMS_PER_FLOOR_TABLE,
              ),
            };
          },
        })),
        {
          name: "dashboard.open",
          sample: async (time) => {
            const as = venue.managementCookie;
            const answers = await timed(time, [
              { cookie: as, method: "GET", path: "/management-api/session/me" },
              { cookie: as, method: "GET", path: "/management-api/reports/overview" },
              { cookie: as, method: "GET", path: "/management-api/reports/overdue-orders" },
            ]);
            const sales = (answers[1]!.body as { counts: { sales: number } }).counts.sales;
            return { outcome: outcomeOf(answers), seen: atLeast("dashboard.open", sales, 1) };
          },
        },
      ],
    },
    {
      cases: [
        {
          name: "kitchen.pass-release",
          sample: async (time) => {
            await venue.db.update(kitchenStations).set({ waitsForPass: true });
            const bill = await openBill(tables[0]!, nextDishes(2), false);
            const { board } = (await call(
              passScreen.cookie,
              "GET",
              "/api/device/pass-board",
            )) as unknown as { board: PassBoard };
            const card = board.toFire.find(
              (card) => card.target.kind === "group" && card.target.partyId === bill.partyId,
            );
            if (!card) throw new Error("bench: no two-dish pass release card");
            const answers = await timed(time, [
              {
                cookie: passScreen.cookie,
                method: "POST",
                path: "/api/device/pass-screen/release",
                body: {
                  submissionId: randomUUID(),
                  target: card.target,
                  ticketItemIds: card.releaseTicketItemIds,
                  expectedContext: card.releaseContext,
                },
              },
            ]);
            await venue.db.update(kitchenStations).set({ waitsForPass: false });
            const [group] = await venue.db
              .select({ id: orderGroups.id })
              .from(orderGroups)
              .where(eq(orderGroups.partyId, bill.partyId));
            await call(cookie, "POST", `/api/parties/${bill.partyId}/groups/${group!.id}/ready`, {
              submissionId: randomUUID(),
              expectedPartyRevision: revision(bill.partyId),
            });
            await call(cookie, "POST", `/api/parties/${bill.partyId}/groups/${group!.id}/served`, {
              submissionId: randomUUID(),
              expectedPartyRevision: revision(bill.partyId),
            });
            const payment = await cashPayment(bill.tabId, await outstanding(bill.tabId));
            await call(payment.cookie, payment.method, payment.path, payment.body);
            await finish(bill.partyId);
            return {
              outcome: outcomeOf(answers),
              seen: (answers[0]!.body as { releasedTicketItemIds: string[] }).releasedTicketItemIds
                .length,
            };
          },
        },
        {
          name: "print.problems",
          sample: async (time) => {
            const [job] = await venue.db
              .select({ id: printJobs.id })
              .from(printJobs)
              .where(eq(printJobs.kind, "document"))
              .orderBy(sql`${printJobs}.rowid desc`)
              .limit(1);
            if (!job) throw new Error("bench: no print job for the problem read");
            await venue.db
              .update(printJobs)
              .set({ status: "failed", attempts: 100, lastError: "printer.offline" })
              .where(eq(printJobs.id, job.id));
            const answers = await timed(time, [
              { cookie: venue.managementCookie, method: "GET", path: "/management-api/alerts" },
            ]);
            const alerts = (answers[0]!.body as { alerts: { code: string }[] }).alerts;
            return {
              outcome: outcomeOf(answers),
              seen: atLeast(
                "print.problems",
                alerts.filter((alert) => alert.code === "printer.jobs_waiting").length,
                1,
              ),
            };
          },
        },
      ],
    },
    {
      cases: [
        {
          name: "filing.pass",
          sample: async (time) => {
            await (
              await filingPass()
            )();
            for (let n = 0; n < FILING_BATCH; n++) {
              const sale = await counterSale();
              await call(sale.cookie, sale.method, sale.path, sale.body);
            }
            const pass = await filingPass();
            let accepted = 0;
            await time(async () => {
              accepted = (await pass()).recordsAccepted;
            });
            return {
              outcome: `accepted ${accepted}`,
              seen: atLeast("filing.pass", accepted, FILING_BATCH),
            };
          },
        },
      ],
    },
  ];
}
