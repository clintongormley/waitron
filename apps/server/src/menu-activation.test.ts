import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  installChangeFeed,
  subscribeToChanges,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  CATALOGUE_CHANGE_SOURCES,
  CATALOGUE_MIGRATIONS,
  listMenuPublications,
  menuPublications,
  menuScheduledPublications,
  previewMenu,
  publishMenu,
  queueMenuPublication,
  updateProduct,
} from "@waitron/catalogue";
import { menusFixture, type MenusFixture } from "@waitron/catalogue/test/menus-fixture.js";
import { AppError } from "@waitron/shared";
import { changeSubscriber, LiveEvents } from "./live-api.js";
import type { Logger, LogLevel } from "./logger.js";
import { startMenuActivation } from "./menu-activation.js";

const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

const MAX_WAIT_MS = 20 * 86_400_000;
const LONGEST_TIMER_MS = 2_147_483_647;
// Years after the real clock, so a read that takes the real clock never finds these editions due.
const day = (date: number) => new Date(`2030-01-${String(date).padStart(2, "0")}T06:00:00.000Z`);
const ANA = "manager-ana";

let f: MenusFixture;

async function setSoup(unitPrice: string): Promise<void> {
  await app((tx) => updateProduct(tx, f.soup, { unitPrice }));
}

async function publishNow(menuId: string): Promise<void> {
  const { hash } = await app((tx) => previewMenu(tx, menuId));
  await app((tx) => publishMenu(tx, menuId, hash, ANA));
}

async function queue(menuId: string, activatesAt: Date) {
  const { hash } = await app((tx) => previewMenu(tx, menuId));
  return app((tx) => queueMenuPublication(tx, menuId, hash, activatesAt, ANA));
}

/** Lunch live at v1, and v2, v3, v4 queued for the given days, each with a different Soup price. */
async function lunchWithQueue(...days: number[]): Promise<string[]> {
  f = await menusFixture(fx.db);
  await publishNow(f.lunch);
  const versionIds: string[] = [];
  for (const [index, date] of days.entries()) {
    await setSoup((5.5 + index * 0.5).toFixed(2));
    versionIds.push((await queue(f.lunch, day(date))).versionId);
  }
  return versionIds;
}

async function stateOf(versionId: string): Promise<string | undefined> {
  const [row] = await fx.db
    .select({ state: menuScheduledPublications.state })
    .from(menuScheduledPublications)
    .where(eq(menuScheduledPublications.versionId, versionId));
  return row?.state;
}

async function pointerOf(menuId: string): Promise<string | undefined> {
  const [row] = await fx.db
    .select({ versionId: menuPublications.versionId })
    .from(menuPublications)
    .where(eq(menuPublications.menuId, menuId));
  return row?.versionId;
}

function latch(): { waited: Promise<void>; open: () => void } {
  let open!: () => void;
  const waited = new Promise<void>((resolve) => (open = resolve));
  return { waited, open };
}

/**
 * The venue database seen through a door that counts each write transaction begun, and can fail
 * the next one or hold it until a latch opens.
 */
function instrumented(db: Database) {
  const door = {
    begins: 0,
    inFlight: 0,
    mostAtOnce: 0,
    failNext: false,
    holdNext: undefined as Promise<void> | undefined,
  };
  const wrapped = new Proxy(db, {
    get(target, property) {
      if (property === "withWriteLock") {
        return async <T>(fn: () => Promise<T>): Promise<T> => {
          door.begins += 1;
          door.inFlight += 1;
          door.mostAtOnce = Math.max(door.mostAtOnce, door.inFlight);
          try {
            if (door.failNext) {
              door.failNext = false;
              throw new AppError("provisioning.database_in_use", { database: "venue" });
            }
            const hold = door.holdNext;
            door.holdNext = undefined;
            if (hold !== undefined) await hold;
            return await target.withWriteLock(fn);
          } finally {
            door.inFlight -= 1;
          }
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
  return { db: wrapped, door };
}

function startDuty(
  options: {
    isPrimary?: () => boolean;
    holdFirst?: Promise<void>;
    failFirst?: boolean;
    maxWaitMs?: number;
  } = {},
) {
  const { db, door } = instrumented(fx.db);
  door.holdNext = options.holdFirst;
  door.failNext = options.failFirst ?? false;
  const armed: { ms: number; fn: () => void; cancelled: boolean }[] = [];
  const lines: { level: LogLevel; event: string; fields: Record<string, unknown> | undefined }[] =
    [];
  const log: Logger = (level, event, fields) => lines.push({ level, event, fields });
  const bus = new LiveEvents();
  const clock = { now: day(4) };
  const duty = startMenuActivation({
    db,
    bus,
    isPrimary: options.isPrimary ?? (() => true),
    now: () => clock.now,
    log,
    maxWaitMs: options.maxWaitMs ?? MAX_WAIT_MS,
    timer: (ms, fn) => {
      const entry = { ms, fn, cancelled: false };
      armed.push(entry);
      return { cancel: () => (entry.cancelled = true) };
    },
  });
  /** Waits until the duty has armed its `count`-th timer. */
  const armedCount = (count: number) =>
    vi.waitFor(() => expect(armed).toHaveLength(count), { timeout: 5_000 });
  return { duty, door, armed, lines, bus, clock, armedCount, log };
}

/** Lets every queued microtask and the I/O they wait on run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

const SCHEDULE_CHANGE = { resources: [{ type: "menu_scheduled_publications" }] };

describe("startMenuActivation", () => {
  it("on start, activates every overdue edition and arms the timer for the next one", async () => {
    const [v2, v3, v4] = await lunchWithQueue(2, 3, 6);
    const { duty, armed, armedCount, lines } = startDuty();
    try {
      await armedCount(1);
      expect(await pointerOf(f.lunch)).toBe(v3);
      expect(await stateOf(v2!)).toBe("activated");
      expect(await stateOf(v3!)).toBe("activated");
      expect(await stateOf(v4!)).toBe("queued");
      expect(armed[0]!.ms).toBe(day(6).getTime() - day(4).getTime());
      expect(lines.filter((line) => line.event === "menu_publication.activated")).toEqual([
        {
          level: "info",
          event: "menu_publication.activated",
          fields: { menuId: f.lunch, versionId: v3, number: 3 },
        },
      ]);
      expect(lines).toContainEqual({
        level: "debug",
        event: "menu_publication.activation_armed",
        fields: { sleepMs: armed[0]!.ms },
      });
    } finally {
      await duty.stop();
    }
  });

  it("activates the next edition when its timer fires, then sleeps the longest wait", async () => {
    const [v2] = await lunchWithQueue(6);
    const { duty, armed, armedCount, clock } = startDuty();
    try {
      await armedCount(1);
      expect(await stateOf(v2!)).toBe("queued");
      clock.now = day(6);
      armed[0]!.fn();
      await armedCount(2);
      expect(await pointerOf(f.lunch)).toBe(v2);
      expect(await stateOf(v2!)).toBe("activated");
      expect(armed[1]!.ms).toBe(MAX_WAIT_MS);
    } finally {
      await duty.stop();
    }
  });

  it("never sleeps longer than the longest wait, however far off the next edition is", async () => {
    const far = new Date(day(4).getTime() + MAX_WAIT_MS + 86_400_000);
    f = await menusFixture(fx.db);
    await publishNow(f.lunch);
    await setSoup("5.50");
    await queue(f.lunch, far);
    const { duty, armed, armedCount } = startDuty();
    try {
      await armedCount(1);
      expect(armed[0]!.ms).toBe(MAX_WAIT_MS);
    } finally {
      await duty.stop();
    }
  });

  it("never arms a timer longer than Node honours, whatever the longest wait", async () => {
    f = await menusFixture(fx.db);
    await publishNow(f.lunch);
    const { duty, armed, armedCount } = startDuty({ maxWaitMs: LONGEST_TIMER_MS * 10 });
    try {
      await armedCount(1);
      expect(armed[0]!.ms).toBe(LONGEST_TIMER_MS);
    } finally {
      await duty.stop();
    }
  });

  it("never arms a timer longer than Node honours for an edition further off than that", async () => {
    f = await menusFixture(fx.db);
    await publishNow(f.lunch);
    await setSoup("5.50");
    await queue(f.lunch, new Date(day(4).getTime() + LONGEST_TIMER_MS + 86_400_000));
    const { duty, armed, armedCount } = startDuty({ maxWaitMs: LONGEST_TIMER_MS * 10 });
    try {
      await armedCount(1);
      expect(armed[0]!.ms).toBe(LONGEST_TIMER_MS);
    } finally {
      await duty.stop();
    }
  });

  it("re-arms for a sooner edition when the queue changes, and not for another kind of change", async () => {
    await lunchWithQueue(9);
    const { duty, door, armed, armedCount, bus } = startDuty();
    try {
      await armedCount(1);
      expect(armed[0]!.ms).toBe(day(9).getTime() - day(4).getTime());
      await publishNow(f.dinner);
      await app((tx) => updateProduct(tx, f.burger, { unitPrice: "13.00" }));
      await queue(f.dinner, day(8));
      const before = door.begins;

      bus.publish(SCHEDULE_CHANGE);
      // The listener only schedules a run: none has begun on the publisher's own call stack.
      expect(door.begins).toBe(before);
      await armedCount(2);
      expect(armed[0]!.cancelled).toBe(true);
      expect(armed[1]!.ms).toBe(day(8).getTime() - day(4).getTime());

      bus.publish({ resources: [{ type: "products" }] });
      await flush();
      expect(armed).toHaveLength(2);
      expect(door.begins).toBe(before + 1);
    } finally {
      await duty.stop();
    }
  });

  it("writes nothing on a node that is not primary, and activates once it is", async () => {
    const [v2] = await lunchWithQueue(2);
    let primary = false;
    const { duty, door, armed, armedCount } = startDuty({ isPrimary: () => primary });
    try {
      await armedCount(1);
      expect(door.begins).toBe(0);
      expect(await stateOf(v2!)).toBe("queued");
      const read = await app((tx) => listMenuPublications(tx, f.lunch, day(4)));
      expect(read.live?.versionId).toBe(v2);
      expect(armed[0]!.ms).toBe(MAX_WAIT_MS);

      primary = true;
      armed[0]!.fn();
      await armedCount(2);
      expect(await stateOf(v2!)).toBe("activated");
      expect(await pointerOf(f.lunch)).toBe(v2);
    } finally {
      await duty.stop();
    }
  });

  it("logs a failed run with its code, re-arms, and activates on the next run", async () => {
    const [v2] = await lunchWithQueue(2);
    const { duty, armed, armedCount, lines } = startDuty({ failFirst: true });
    try {
      await armedCount(1);
      expect(lines).toContainEqual({
        level: "warn",
        event: "menu_publication.activation_failed",
        fields: { errorCode: "provisioning.database_in_use" },
      });
      expect(armed[0]!.ms).toBe(MAX_WAIT_MS);
      expect(await stateOf(v2!)).toBe("queued");

      armed[0]!.fn();
      await armedCount(2);
      expect(await stateOf(v2!)).toBe("activated");
    } finally {
      await duty.stop();
    }
  });

  it("runs exactly once more after a run during which it was woken, never two at once", async () => {
    await lunchWithQueue(9);
    const held = latch();
    const { duty, door, armed, armedCount, bus } = startDuty({ holdFirst: held.waited });
    try {
      await vi.waitFor(() => expect(door.begins).toBe(1));
      bus.publish(SCHEDULE_CHANGE);
      await flush();
      bus.publish(SCHEDULE_CHANGE);
      await flush();
      expect(door.begins).toBe(1);

      held.open();
      await armedCount(1);
      await flush();
      expect(door.begins).toBe(2);
      expect(door.mostAtOnce).toBe(1);
      expect(armed).toHaveLength(1);
      expect(armed[0]!.ms).toBe(day(9).getTime() - day(4).getTime());
    } finally {
      await duty.stop();
    }
  });

  it("stop() cancels the armed timer and stops listening", async () => {
    await lunchWithQueue(9);
    const { duty, door, armed, armedCount, bus } = startDuty();
    await armedCount(1);
    // A wake the bus scheduled just before the stop finds the duty stopped.
    bus.publish(SCHEDULE_CHANGE);
    await duty.stop();
    expect(armed[0]!.cancelled).toBe(true);
    expect(bus.subscriberCount).toBe(0);
    bus.publish(SCHEDULE_CHANGE);
    await flush();
    expect(armed).toHaveLength(1);
    expect(door.begins).toBe(1);
  });

  it("stop() waits for a run in flight, which then arms nothing", async () => {
    await lunchWithQueue(9);
    const { duty, door, armed, armedCount, bus } = startDuty();
    await armedCount(1);
    const held = latch();
    door.holdNext = held.waited;
    bus.publish(SCHEDULE_CHANGE);
    await vi.waitFor(() => expect(door.begins).toBe(2));

    let stopped = false;
    const stopping = duty.stop().then(() => (stopped = true));
    await flush();
    expect(stopped).toBe(false);

    held.open();
    await stopping;
    await flush();
    expect(armed).toHaveLength(1);
    expect(door.begins).toBe(2);
  });

  it("sleeps on a real timer when none is given", async () => {
    f = await menusFixture(fx.db);
    await publishNow(f.lunch);
    await setSoup("5.50");
    const { versionId } = await queue(f.lunch, new Date(Date.now() + 1_000));
    const duty = startMenuActivation({
      db: fx.db,
      bus: new LiveEvents(),
      isPrimary: () => true,
      now: () => new Date(),
      log: () => {},
      maxWaitMs: MAX_WAIT_MS,
    });
    try {
      expect(await stateOf(versionId)).toBe("queued");
      await vi.waitFor(async () => expect(await stateOf(versionId)).toBe("activated"), {
        timeout: 10_000,
        interval: 100,
      });
    } finally {
      await duty.stop();
    }
  });

  // Last in the file: the change-feed triggers it installs stay on the suite's database.
  it("is woken once by its own activation, which then finds nothing to do", async () => {
    const [v2] = await lunchWithQueue(6);
    await installChangeFeed(fx.db, CATALOGUE_CHANGE_SOURCES);
    const { duty, door, armed, armedCount, bus, clock, log } = startDuty();
    const unsubscribe = subscribeToChanges(changeSubscriber(bus, log));
    const changes: { begins: number; types: string[] }[] = [];
    bus.subscribe((event) => {
      if (event.kind === "change")
        changes.push({ begins: door.begins, types: event.change.resources.map((r) => r.type) });
    });
    try {
      await armedCount(1);
      clock.now = day(6);
      armed[0]!.fn();
      await armedCount(2);
      await flush();

      expect(await stateOf(v2!)).toBe("activated");
      // Every change is the activation's, delivered before the extra run had begun.
      expect(changes.flatMap((change) => change.types)).toContain("menu_scheduled_publications");
      expect(new Set(changes.map((change) => change.begins))).toEqual(new Set([2]));
      expect(door.begins).toBe(3);
      expect(armed).toHaveLength(2);
      expect(armed[1]!.ms).toBe(MAX_WAIT_MS);

      bus.close();
      await flush();
      expect(door.begins).toBe(3);
      expect(armed).toHaveLength(2);
    } finally {
      unsubscribe();
      await duty.stop();
    }
  });
});
