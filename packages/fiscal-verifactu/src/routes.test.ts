import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  hashSessionToken,
  managementSessions,
  persons,
  startManagementSession,
  type PersonRoleValue,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { AppError, locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { FISCAL_ROUTES } from "./routes.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const PATH = "/management-api/fiscal-outbox/retry";

interface Person {
  id: string;
  token: string;
  cookie: string;
}

let manager: Person;
let supervisor: Person;

async function seedPerson(role: PersonRoleValue, name: string): Promise<Person> {
  return withTransaction(suite.db, async (tx) => {
    const [p] = await tx
      .insert(persons)
      .values({ displayName: name, pinHash: hashPin("1234"), role })
      .returning({ id: persons.id });
    const session = await startManagementSession(tx, { personId: p!.id });
    return { id: p!.id, token: session.token, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  });
}

beforeEach(async () => {
  manager = await seedPerson("manager", "Marta");
  supervisor = await seedPerson("supervisor", "Sergio");
});

/** A full disk that refuses any write turn which changed a row; a turn that only reads commits. */
function writeRefusingDb(): Database {
  const changes = () => suite.db.all<{ n: number }>(sql`select total_changes() as n`)[0]!.n;
  return new Proxy(suite.db, {
    get(target, prop) {
      if (prop === "withWriteLock") {
        return <T>(body: () => Promise<T>) =>
          target.withWriteLock(async () => {
            const before = changes();
            const value = await body();
            if (changes() !== before) throw new AppError("storage.disk_full", {});
            return value;
          });
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

function mount(
  options: { db?: Database; filing?: boolean; awaitingCertificate?: boolean; drain?: false } = {},
) {
  const wake = vi.fn();
  const log = vi.fn<Logger>();
  const ctx: ModuleRouteContext = {
    db: options.db ?? suite.db,
    cfg: { locationId: locationId("00000000-0000-4000-8000-000000000001") },
    core: {} as ModuleRouteContext["core"],
    ...(options.drain === false
      ? {}
      : {
          fiscalDrain: {
            filing: () => options.filing ?? true,
            awaitingCertificate: () => options.awaitingCertificate ?? false,
            wake,
          },
        }),
  };
  const app = new Hono();
  FISCAL_ROUTES.mount(app, ctx, log);
  return { app, wake, log };
}

function press(app: Hono, cookie?: string) {
  return app.request(PATH, {
    method: "POST",
    headers: cookie === undefined ? {} : { cookie },
    body: "{}",
  });
}

const FUTURE = () => new Date(Date.now() + 60 * 60_000).toISOString();

/** Three waiting records whose waits end an hour after the real clock: the route reads the wall
 * clock, and the fixture's own wait is long past. */
async function seedWaiting(): Promise<string[]> {
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  await suite.db.execute(sql`update envios set proximo_intento_en = ${FUTURE()}`);
  return seeded.registroIds;
}

async function waits(): Promise<unknown[]> {
  const rows = await suite.db.execute<{ proximo_intento_en: string }>(
    sql`select proximo_intento_en from envios order by registro_id`,
  );
  return rows.rows.map((r) => r.proximo_intento_en);
}

/** Every row a press or its session check could write. */
async function snapshot(): Promise<unknown[][]> {
  const tables = [
    sql`select * from envios order by registro_id`,
    sql`select * from management_sessions order by token_hash`,
    sql`select * from persons order by id`,
  ];
  const rows: unknown[][] = [];
  for (const query of tables) rows.push((await suite.db.execute(query)).rows);
  return rows;
}

describe("POST /management-api/fiscal-outbox/retry", () => {
  it("a manager's press clears the waits, wakes the drain once and logs who pressed", async () => {
    await seedWaiting();
    const { app, wake, log } = mount();
    const before = Date.now();
    const res = await press(app, manager.cookie);
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ waiting: 3 });
    const written = await waits();
    expect(written).toHaveLength(3);
    for (const w of written) {
      const at = new Date(w as string).getTime();
      expect(at).toBeGreaterThanOrEqual(before);
      expect(at).toBeLessThanOrEqual(after);
    }
    expect(wake).toHaveBeenCalledTimes(1);
    expect(log.mock.calls).toEqual([
      ["info", "fiscal.retry_now", { waiting: 3, cleared: 3, personId: manager.id }],
    ]);
  });

  it("wakes the drain only after the transaction commits", async () => {
    await seedWaiting();
    const unchanged = await snapshot();
    const { app, wake } = mount({ db: writeRefusingDb() });
    const res = await press(app, manager.cookie);
    expect(res.status).toBe(507);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "storage.disk_full",
    );
    expect(await snapshot()).toEqual(unchanged);
    expect(wake).not.toHaveBeenCalled();
  });

  async function expectRefused(
    options: Parameters<typeof mount>[0],
    cookie: string | undefined,
    status: number,
    code: string,
  ) {
    await seedWaiting();
    const unchanged = await snapshot();
    const { app, wake } = mount(options);
    const res = await press(app, cookie);
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
    expect(await snapshot()).toEqual(unchanged);
    expect(wake).not.toHaveBeenCalled();
  }

  // The session checks come before the box's filing state.
  const NEITHER = { filing: false, awaitingCertificate: true };

  it("refuses a request with no session", async () => {
    await expectRefused(NEITHER, undefined, 401, "management_session.required");
  });

  it("refuses an expired session", async () => {
    await suite.db
      .update(managementSessions)
      .set({ lastSeenAt: new Date(Date.now() - 31 * 60_000).toISOString() })
      .where(eq(managementSessions.tokenHash, hashSessionToken(manager.token)));
    await expectRefused({}, manager.cookie, 401, "management_session.expired");
  });

  it("refuses a suspended person", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, manager.id)),
    );
    await expectRefused({}, manager.cookie, 403, "person.suspended");
  });

  it("refuses a supervisor, who may not manage the system", async () => {
    await expectRefused(NEITHER, supervisor.cookie, 403, "authorization.not_permitted");
  });

  it("refuses on a box that does not file records now", async () => {
    await expectRefused({ filing: false }, manager.cookie, 409, "fiscal.not_filing");
  });

  it("names the filing refusal first when both fiscal checks would refuse", async () => {
    await expectRefused(NEITHER, manager.cookie, 409, "fiscal.not_filing");
  });

  it("refuses while the box waits for its tax-agency certificate", async () => {
    await expectRefused(
      { awaitingCertificate: true },
      manager.cookie,
      409,
      "fiscal.awaiting_certificate",
    );
  });

  it("is not mounted on a host without a submission loop", () => {
    expect(mount().app.routes.map((r) => r.path)).toContain(PATH);
    const { app } = mount({ drain: false });
    expect(app.routes.map((r) => r.path)).not.toContain(PATH);
  });
});
