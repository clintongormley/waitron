import { AsyncResource } from "node:async_hooks";
import { eq, sql } from "drizzle-orm";
import { vi } from "vitest";
import type { Database, NodeDatabase, NodeTransaction, Transaction } from "@waitron/db";

// A suite's `vi.mock("node:crypto", …)` factory loads this module, so nothing it imports at top
// level may import `node:crypto`: `@waitron/db` and `@waitron/identity` are imported where used.

type Crypto = typeof import("node:crypto");
type Done = (error: Error | null, key: Buffer) => void;

// Each key derivation of the watched PIN runs the next `during` action (another writer, or a change
// to a person) and holds its key back until that action has committed or a second has passed. A
// derivation outside the write lock lets the action commit first ("writer", "derived"); inside it,
// the action waits for the lock and "derived" comes first.
const pins = {
  pin: null as string | null,
  during: [] as (() => Promise<unknown>)[],
  /** Runs an action in the test's own async context, not the route's: a writer inside the route's
   * context would read as the route asking again for a lock it holds. */
  start: (action: () => Promise<unknown>) => action(),
  order: [] as string[],
  writes: [] as Promise<unknown>[],
  requestHoldsLock: 0,
  stopWatchingLock: () => {},
  /** Every derivation of the watched PIN, held back or not. */
  count: 0,
};

// Records each key derivation while a test watches: inside one of the request's transactions in
// `order`, outside them in `outside`.
const passwords = {
  watching: false,
  /** How many of the request's transactions are open, on either file. */
  inRequestTransaction: 0,
  order: [] as string[],
  outside: 0,
};

let failing: string | null = null;

/** `node:crypto` with a `scrypt` that the watchers below can see; otherwise the real `scrypt`. */
export function watchedCrypto(actual: Crypto): Crypto {
  const scrypt = (secret: string, salt: Buffer, keyLength: number, done: Done) => {
    if (secret === failing) throw new Error("scrypt failed (test fault)");
    if (passwords.watching) {
      if (passwords.inRequestTransaction > 0) passwords.order.push("key derived in a transaction");
      else passwords.outside += 1;
    }
    const watched = secret === pins.pin;
    if (watched) pins.count += 1;
    if (watched && pins.requestHoldsLock > 0) {
      pins.order.push("derived under the request's lock");
    }
    const during = watched ? pins.during.shift() : undefined;
    if (during === undefined) {
      actual.scrypt(secret, salt, keyLength, done);
      return;
    }
    const write = pins.start(during).then(
      () => pins.order.push("writer"),
      (error: unknown) => pins.order.push(`writer failed: ${String(error)}`),
    );
    pins.writes.push(write);
    actual.scrypt(secret, salt, keyLength, (error, key) => {
      const waited = new Promise((resolve) => setTimeout(resolve, 1_000));
      void Promise.race([write, waited]).then(() => {
        pins.order.push("derived");
        done(error, key);
      });
    });
  };
  return { ...actual, scrypt: scrypt as Crypto["scrypt"] };
}

function watchPin(pin: string, during: (() => Promise<unknown>)[]): AsyncResource {
  pins.pin = pin;
  pins.during = during;
  pins.count = 0;
  return new AsyncResource("watched derivation");
}

/** Watches each derivation of `pin`, running the next of `during` beside it. */
export function watchDerivations(pin: string, ...during: (() => Promise<unknown>)[]): void {
  const scope = watchPin(pin, during);
  pins.start = (action) => scope.runInAsyncScope(action);
}

/**
 * As `watchDerivations`, and also records "derived under the request's lock" for a derivation of
 * `pin` made while a request (not one of the `during` actions) holds `db`'s write lock.
 */
export function watchDerivationsAndLock(
  db: Database,
  pin: string,
  ...during: (() => Promise<unknown>)[]
): void {
  const scope = watchPin(pin, during);
  let starting = false;
  pins.start = (action) => {
    starting = true;
    try {
      return scope.runInAsyncScope(action);
    } finally {
      starting = false;
    }
  };
  const original = db.withWriteLock;
  const spy = vi.spyOn(db, "withWriteLock").mockImplementation((body) =>
    starting
      ? original(body)
      : original(async () => {
          pins.requestHoldsLock += 1;
          try {
            return await body();
          } finally {
            pins.requestHoldsLock -= 1;
          }
        }),
  );
  pins.stopWatchingLock = () => spy.mockRestore();
}

/** What the watched derivations recorded, once every action they started has finished. */
export async function watchedOrder(): Promise<string[]> {
  await Promise.all(pins.writes);
  pins.stopWatchingLock();
  const order = pins.order;
  pins.pin = null;
  pins.during = [];
  pins.order = [];
  pins.writes = [];
  pins.stopWatchingLock = () => {};
  return order;
}

/** How many times the watched PIN has been derived since `watchDerivations` was called. */
export function watchedDerivationCount(): number {
  return pins.count;
}

/** Runs `request`, recording each key it derives, inside or outside a transaction. */
export async function watchingDerivations<T>(
  request: () => Promise<T>,
): Promise<{ result: T; order: string[]; outside: number }> {
  const order: string[] = [];
  Object.assign(passwords, { watching: true, order, outside: 0 });
  try {
    const result = await request();
    return { result, order, outside: passwords.outside };
  } finally {
    passwords.watching = false;
  }
}

/**
 * Runs `request` while, on the next turn of the event loop, another writer commits a transaction.
 * Returns the request's result and, in order: when the writer committed, when each of the request's
 * transactions committed, and each key the request derived while holding the write lock; and how
 * many keys it derived outside its transactions.
 */
export async function writerBesideRequest<T>(
  db: Database,
  request: () => Promise<T>,
): Promise<{ result: T; order: string[]; outside: number }> {
  const { withTransaction } = await import("@waitron/db");
  return writersBeside([{ db, transaction: (body) => withTransaction(db, body) }], request);
}

/** `writerBesideRequest` on both files' write locks: a writer commits beside each. */
export async function venueAndNodeWritersBesideRequest<T>(
  db: Database,
  node: NodeDatabase,
  request: () => Promise<T>,
): Promise<{ result: T; order: string[]; outside: number }> {
  const { withNodeTransaction, withTransaction } = await import("@waitron/db");
  return writersBeside(
    [
      { db, transaction: (body) => withTransaction(db, body) },
      { db: node, transaction: (body) => withNodeTransaction(node, body) },
    ],
    request,
  );
}

interface WatchedLock {
  db: Database;
  transaction: (body: (tx: Transaction) => unknown) => Promise<unknown>;
}

async function writersBeside<T>(
  locks: readonly WatchedLock[],
  request: () => Promise<T>,
): Promise<{ result: T; order: string[]; outside: number }> {
  let writerAsking = false;
  const spies = locks.map(({ db }) => {
    const original = db.withWriteLock;
    return vi.spyOn(db, "withWriteLock").mockImplementation((body) =>
      writerAsking
        ? original(body)
        : original(async () => {
            passwords.inRequestTransaction += 1;
            try {
              return await body();
            } finally {
              passwords.inRequestTransaction -= 1;
              passwords.order.push("request's transaction");
            }
          }),
    );
  });
  try {
    return await watchingDerivations(async () => {
      const writers = locks.map(
        ({ transaction }) =>
          new Promise<void>((resolve, reject) => {
            setImmediate(() => {
              writerAsking = true;
              const committed = transaction((tx) => tx.execute(sql`select 1`));
              writerAsking = false;
              committed.then(() => {
                passwords.order.push("writer");
                resolve();
              }, reject);
            });
          }),
      );
      const [result] = await Promise.all([request(), ...writers]);
      return result;
    });
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

/**
 * Holds the write lock, runs `request`, and makes `change` in the held transaction once the request
 * asks for the lock — so a check the request took before that saw the row as it was.
 */
export async function whileChangingOnLockRequest<T>(
  db: Database,
  change: (tx: Transaction) => Promise<void>,
  request: () => Promise<T>,
): Promise<T> {
  const { withTransaction } = await import("@waitron/db");
  return changingOnLockRequest(db, (body) => withTransaction(db, body), change, request);
}

/** `whileChangingOnLockRequest` on `node.db`'s write lock. */
export async function whileChangingNodeOnLockRequest<T>(
  node: NodeDatabase,
  change: (tx: NodeTransaction) => Promise<void>,
  request: () => Promise<T>,
): Promise<T> {
  const { withNodeTransaction } = await import("@waitron/db");
  return changingOnLockRequest(node, (body) => withNodeTransaction(node, body), change, request);
}

async function changingOnLockRequest<D extends Database, X, T>(
  db: D,
  transaction: (body: (tx: X) => Promise<void>) => Promise<void>,
  change: (tx: X) => Promise<void>,
  request: () => Promise<T>,
): Promise<T> {
  let lockRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    lockRequested = resolve;
  });
  const held = transaction(async (tx) => {
    await requested;
    await change(tx);
  });
  const original = db.withWriteLock;
  const spy = vi.spyOn(db as Database, "withWriteLock").mockImplementation((body) => {
    const queued = original(body);
    lockRequested();
    return queued;
  });
  try {
    return await request();
  } finally {
    spy.mockRestore();
    lockRequested();
    await held;
  }
}

/** `whileChangingOnLockRequest`, the change suspending `personId`. */
export async function whileSuspendingOnLockRequest<T>(
  db: Database,
  personId: string,
  request: () => Promise<T>,
): Promise<T> {
  const { persons } = await import("@waitron/identity");
  return whileChangingOnLockRequest(
    db,
    async (tx) => {
      await tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, personId));
    },
    request,
  );
}

/** Runs `request` while every key derivation of `secret` throws as it starts. */
export async function failingDerivationsOf<T>(
  secret: string,
  request: () => Promise<T>,
): Promise<T> {
  failing = secret;
  try {
    return await request();
  } finally {
    failing = null;
  }
}
