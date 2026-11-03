import type { Hono } from "hono";
import type { Context } from "hono";
import type { Database, NodeDatabase } from "@waitron/db";
import type { TotpKeyRing } from "@waitron/identity";
import type { SignedMembershipDocument } from "@waitron/membership";
import { codeOf } from "@waitron/server-kit";
import type { StartedServer } from "./boot.js";
import { mountCarryOn, type CarryOnTurn } from "./carry-on.js";
import type { DeploymentEnvironment } from "./config.js";
import { createHandoverGate } from "./handover-gate.js";
import { stepDown, type StepDownRequest, type StepDownResult } from "./handover-stepdown.js";
import { healthApp, type HealthState } from "./health.js";
import type { Logger } from "./logger.js";
import { mountNodeApi } from "./node-api.js";
import type { StartPeerCheckOutcome } from "./start-peer-check.js";
import { waitingPageRoute } from "./waiting-page.js";

/** The page's words say "every 15 seconds"; change both together. */
export const WAIT_RECHECK_MS = 15_000;

/** What the routes of the waiting start may ask of it. */
export interface WaitingHooks {
  /** Writes the restriction, then closes the waiting start and restarts the process. */
  stepDown: (request: StepDownRequest) => Promise<StepDownResult>;
}

export interface WaitingStartDeps {
  /** The start's health state; `/health` answers that the box takes no sales while it waits. */
  health: HealthState;
  now: () => Date;
  venueDir?: string;
  nodeId: string;
  environment: DeploymentEnvironment;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  /** The boxes this one waits for, as the check that began the wait named them. */
  waitingOn: readonly string[];
  /** The page's name for each box, or `null` where it has none. */
  namesOf: (ids: readonly string[]) => Promise<readonly (string | null)[]>;
  /** Signs in the person who carries on as the main box; without it the page offers no form. */
  carryOn?: {
    db: Database;
    credentialKeyRing: TotpKeyRing;
    /** Whether a request reached the box over HTTPS from the page; tests replace it. */
    secure?: (c: Context) => boolean;
  };
  /** The peer routes, mounted on the waiting start's own app. */
  routes: ((app: Hono, hooks: WaitingHooks) => void)[];
  node: NodeDatabase;
  /** The start check, asked again every `intervalMs` until it answers other than `wait`. */
  recheck: () => Promise<StartPeerCheckOutcome>;
  intervalMs: number;
  /**
   * Called as a carry-on takes its turn, before it waits for the re-ask in flight (`turn`), and
   * as it claims the wait inside the transaction that records it (`claimed`). Tests only.
   */
  onCarryOn?: (stage: "turn" | "claimed") => void | Promise<void>;
  /** Binds the waiting start's listeners; `close` closes them and nothing else. */
  listen: (app: Hono) => { close(): Promise<void> };
  closeStore: () => Promise<void>;
  restart: () => void;
  log: Logger;
}

export type WaitEnd =
  | { kind: "checked"; outcome: StartPeerCheckOutcome }
  | { kind: "carried-on" }
  /** Closed by a shutdown or a stepdown: the store is closed and the start must not go on. */
  | { kind: "stopped" };

export interface WaitingStart {
  /** What the start answers while it waits; `close` stops the wait and closes the store. */
  server: StartedServer;
  /** Settles once the listeners and timer are gone; a `checked` or `carried-on` start goes on. */
  ended: Promise<WaitEnd>;
  /** Takes the carry-on turn, as the carry-on route does. */
  beginCarryOn: () => Promise<CarryOnTurn>;
}

/**
 * A box whose check found no joined peer answering serves only its status and the peer routes, from
 * its own app and listeners, and asks again until a peer answers. Nothing here sells or files.
 */
export function startWaiting(deps: WaitingStartDeps): WaitingStart {
  const { log } = deps;
  const app = healthApp(deps.health, deps.now, {
    ...(deps.venueDir === undefined ? {} : { venueDir: deps.venueDir }),
  });
  const gate = createHandoverGate();
  app.use("*", gate.middleware);
  mountNodeApi(
    app,
    {
      nodeId: deps.nodeId,
      acceptingSales: false,
      environment: deps.environment,
      readMembership: deps.readMembership,
    },
    log,
  );
  let waitingOn = deps.waitingOn;
  const section =
    deps.carryOn === undefined
      ? undefined
      : mountCarryOn(app, {
          ...deps.carryOn,
          node: deps.node,
          nodeId: deps.nodeId,
          peerNodeIds: () => waitingOn,
          namesOf: deps.namesOf,
          chartTerm: async () => (await deps.readMembership())?.body.term ?? 0,
          beginCarryOn: () => beginCarryOn(),
          log,
        });
  waitingPageRoute(() => deps.namesOf(waitingOn), log, section)(app);

  let resolveEnd: (end: WaitEnd) => void = () => {};
  const ended = new Promise<WaitEnd>((resolve) => (resolveEnd = resolve));
  let leaving = false;
  // Set before the stepdown's first await, so an answer that lands while the restriction is being
  // written never continues the start the stepdown is about to restart.
  let steppingDown = false;
  let timer: NodeJS.Timeout | undefined;
  // The latest re-ask, settled once it has decided whether the wait ends (`endedWith` is then
  // set). The store stays open until it has settled, and a carry-on waits for it.
  let asking: Promise<void> = Promise.resolve();
  let endedWith: WaitEnd | null = null;
  // While a carry-on holds its turn no new re-ask starts, so none can answer after the carry-on
  // has looked; turns are taken one at a time, so a second carry-on sees the first's outcome.
  let carrying = false;
  let carryOnTurn: Promise<void> = Promise.resolve();

  const leave = async (end: WaitEnd): Promise<void> => {
    if (leaving) return;
    leaving = true;
    endedWith = end;
    clearTimeout(timer);
    try {
      await listeners.close();
    } catch (error) {
      log("warn", "waiting_start.close_failed", { errorCode: codeOf(error) });
    }
    if (end.kind === "stopped") {
      await asking;
      await deps.closeStore();
    } else deps.health.takesNoSales = false;
    resolveEnd(end);
  };

  const hooks: WaitingHooks = {
    stepDown: (request) => {
      steppingDown = true;
      return stepDown(
        {
          node: deps.node,
          nodeId: deps.nodeId,
          gate,
          // Nothing runs in the background while the box waits but the re-ask, which
          // `steppingDown` stops.
          duties: { aborts: [], closers: [] },
          close: () => leave({ kind: "stopped" }),
          restart: deps.restart,
          log,
        },
        request,
      );
    },
  };
  for (const mount of deps.routes) mount(app, hooks);

  const schedule = (): void => {
    timer = setTimeout(() => {
      asking = ask();
    }, deps.intervalMs);
  };

  const ask = async (): Promise<void> => {
    let outcome: StartPeerCheckOutcome | null = null;
    try {
      outcome = await deps.recheck();
    } catch (error) {
      log("warn", "waiting_start.recheck_failed", { errorCode: codeOf(error) });
    }
    if (leaving || steppingDown) return;
    if (outcome !== null && outcome.result !== "wait") {
      // Not awaited: closing the listeners waits for requests in flight, and a carry-on awaiting
      // this re-ask is one of them.
      void leave({ kind: "checked", outcome });
      return;
    }
    if (outcome?.waitingOn !== undefined) waitingOn = outcome.waitingOn;
    if (!carrying) schedule();
  };

  const beginCarryOn = async (): Promise<CarryOnTurn> => {
    const previous = carryOnTurn;
    let release: () => void = () => {};
    carryOnTurn = new Promise((done) => (release = done));
    await previous;
    carrying = true;
    clearTimeout(timer);
    // Not awaited: an await here would itself give a re-ask answered by the seam time to finish.
    void deps.onCarryOn?.("turn");
    await asking;
    const done = (): void => {
      carrying = false;
      if (!leaving && !steppingDown) schedule();
      release();
    };
    if (endedWith !== null || steppingDown) {
      const end = endedWith;
      done();
      if (end?.kind === "checked") return { kind: "answered", outcome: end.outcome };
      return end?.kind === "carried-on" ? { kind: "carried-on" } : { kind: "stopped" };
    }
    return {
      kind: "go",
      claim: async () => {
        if (leaving || steppingDown) return false;
        await deps.onCarryOn?.("claimed");
        return true;
      },
      finish: () => {
        const waiting = !leaving && !steppingDown;
        if (waiting) void leave({ kind: "carried-on" });
        done();
        return waiting;
      },
      abandon: done,
    };
  };

  deps.health.takesNoSales = true;
  const listeners = deps.listen(app);
  schedule();
  log("info", "waiting_start.waiting", { waitingOn });

  return {
    server: {
      health: deps.health,
      close: async () => {
        await leave({ kind: "stopped" });
        await ended;
      },
    },
    ended,
    beginCarryOn,
  };
}
