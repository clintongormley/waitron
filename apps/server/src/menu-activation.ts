import { activateDueMenuPublications } from "@waitron/catalogue";
import { withTransaction, type Database } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import type { LiveEvents } from "./live-api.js";
import type { Logger } from "./logger.js";
import { unrefTimer, type Timer } from "./unref-timer.js";

const SCHEDULE = "menu_scheduled_publications";
// Node fires a longer timer at once.
const LONGEST_TIMER_MS = 2_147_483_647;

/**
 * Puts each queued menu edition live at its time, on the primary only: one run at start, then one
 * whenever the armed timer fires or a change to the schedule reaches `bus`. Runs never overlap; a
 * wake during a run gives exactly one more run after it.
 */
export function startMenuActivation(deps: {
  db: Database;
  bus: LiveEvents;
  isPrimary: () => boolean;
  now: () => Date;
  log: Logger;
  /** The longest the duty sleeps: config.maxTickMs. */
  maxWaitMs: number;
  timer?: (ms: number, fn: () => void) => Timer;
}): { stop: () => Promise<void> } {
  const timer = deps.timer ?? unrefTimer;
  let armed: Timer | undefined;
  let running: Promise<void> | undefined;
  let again = false;
  let wakeQueued = false;
  let stopped = false;

  async function activate(): Promise<number> {
    if (!deps.isPrimary()) return deps.maxWaitMs;
    const { activated, nextDueAt } = await withTransaction(deps.db, (tx) =>
      activateDueMenuPublications(tx, deps.now()),
    );
    for (const edition of activated) deps.log("info", "menu_publication.activated", edition);
    if (nextDueAt === null) return deps.maxWaitMs;
    return Math.min(Math.max(nextDueAt.getTime() - deps.now().getTime(), 0), deps.maxWaitMs);
  }

  async function runUntilSettled(): Promise<void> {
    let sleepMs: number;
    do {
      again = false;
      try {
        sleepMs = await activate();
      } catch (error) {
        deps.log("warn", "menu_publication.activation_failed", { errorCode: codeOf(error) });
        sleepMs = deps.maxWaitMs;
      }
    } while (again && !stopped);
    running = undefined;
    if (stopped) return;
    sleepMs = Math.min(sleepMs, LONGEST_TIMER_MS);
    deps.log("debug", "menu_publication.activation_armed", { sleepMs });
    armed = timer(sleepMs, wake);
  }

  function wake(): void {
    if (stopped) return;
    if (running !== undefined) {
      again = true;
      return;
    }
    armed?.cancel();
    armed = undefined;
    running = runUntilSettled();
  }

  // The bus delivers on the writer's call stack, after its commit, so this only schedules a run.
  const unsubscribe = deps.bus.subscribe((event) => {
    if (event.kind !== "change" || wakeQueued) return;
    if (!event.change.resources.some((resource) => resource.type === SCHEDULE)) return;
    wakeQueued = true;
    queueMicrotask(() => {
      wakeQueued = false;
      wake();
    });
  });

  wake();

  return {
    stop: async () => {
      stopped = true;
      armed?.cancel();
      unsubscribe();
      await running;
    },
  };
}
