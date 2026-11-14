import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { afterEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  openVenueDatabase,
  readSettings,
  saveSettings,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword } from "@waitron/identity";
import { recoveryApp } from "./recovery-surface.js";
import {
  FRESH,
  readRecoveryState,
  writeRecoveryState,
  type RecoveryState,
} from "./recovery-state.js";
import { MODULES_SETTINGS } from "./modules.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(
  modules: Record<string, boolean> = {},
  state: RecoveryState = {
    ...FRESH,
    failures: 3,
    level: "recovery",
    lastErrorCode: "server.internal",
  },
) {
  await seedPersons(suite.db, {
    displayName: "Administrator",
    role: "admin",
    passwordHash: hashPassword("administrator password"),
  });
  await withTransaction(suite.db, (tx) =>
    saveSettings(tx, MODULES_SETTINGS, { doc: { modules }, expectedRevision: 0, personId: null }),
  );
  const stateDir = await mkdtemp(join(tmpdir(), "recovery-bookings-"));
  dirs.push(stateDir);
  const venueDir = join(stateDir, "venue");
  await mkdir(venueDir);
  await suite.db.archiveTo(join(venueDir, "venue.db"));
  await writeRecoveryState(stateDir, state);
  const restart = vi.fn();
  const app = recoveryApp({
    state,
    logDir: stateDir,
    onRetry: async () => {},
    bookings: { roots: { stateDir, venueDir }, onFinished: restart },
    environment: { roots: { stateDir, venueDir }, baseEnv: {}, onFinished: async () => {} },
  });
  const request = async (body?: string, secure = true, locale = "en-GB") => {
    const socket = secure ? new TLSSocket(new Socket()) : new Socket();
    try {
      return await app.request(
        `https://box.test${body === undefined ? "/" : "/recovery-api/bookings/off"}`,
        {
          headers: { Origin: "https://box.test", "Accept-Language": locale },
          ...(body === undefined ? {} : { method: "POST", body: new URLSearchParams(body) }),
        },
        { incoming: { socket } },
      );
    } finally {
      socket.destroy();
    }
  };
  return { stateDir, venueDir, request, restart, state };
}
it("offers effective-On recovery alongside the environment form, in both languages, with Stop", async () => {
  const f = await fixture();
  for (const [locale, action] of [
    ["en-GB", "Switch Bookings off and start again"],
    ["es-ES", "Desactivar Reservas y volver a arrancar"],
  ]) {
    const body = await (await f.request(undefined, true, locale)).text();
    expect(body).toContain(action);
    expect(body).toContain('action="/recovery-api/bookings/off"');
    expect(body.indexOf('action="/recovery-api/bookings/off"')).toBeLessThan(
      body.indexOf('action="/recovery-api/retry"'),
    );
    expect(body).toContain('action="/recovery-api/environment/start-again"');
    const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(body).toContain('value="keep" formnovalidate');
  }
  expect(
    await (await f.request("choice=move&password=administrator+password", false)).text(),
  ).toContain("secure");
  expect(f.restart).not.toHaveBeenCalled();
  expect((await f.request("choice=move&password=wrong")).status).toBe(403);
  expect((await readRecoveryState(f.stateDir)).failures).toBe(3);
});
it.each([false, true])(
  "does not offer or run recovery with Bookings off=%s or a stopped server",
  async (off) => {
    const f = await fixture(off ? { bookings: false } : {}, {
      ...FRESH,
      failures: 3,
      level: "recovery",
      lastErrorCode: "server.internal",
      ...(!off ? { refused: true as const } : {}),
    });
    expect(await (await f.request()).text()).not.toContain('action="/recovery-api/bookings/off"');
    expect((await f.request("choice=move&password=administrator+password")).status).toBe(
      off ? 409 : 404,
    );
    expect(f.restart).not.toHaveBeenCalled();
  },
);
it("saves only Bookings Off, clears failed starts, and restarts with Bookings wording", async () => {
  const f = await fixture({ "fiscal-none": false, payments: false });
  const response = await f.request("choice=move&password=administrator+password");
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain("Bookings is off");
  expect(body).not.toContain("set aside");
  const opened = await openVenueDatabase(f.venueDir);
  try {
    expect(await readSettings(opened.venue, MODULES_SETTINGS)).toMatchObject({
      doc: { modules: { "fiscal-none": false, payments: false, bookings: false } },
      revision: 2,
    });
    expect(opened.venue.all(sql`select display_name from persons`)).toEqual([
      { display_name: "Administrator" },
    ]);
  } finally {
    await opened.close();
  }
  expect(await readRecoveryState(f.stateDir)).toMatchObject({ level: "normal", failures: 0 });
  expect(f.restart).toHaveBeenCalledTimes(1);
});
it("hides unreadable settings without hiding recovery or altering the database", async () => {
  const f = await fixture();
  await writeFile(join(f.venueDir, "venue.db"), "not a database");
  expect(await (await f.request()).text()).toContain("Waitron did not start");
  expect(await (await f.request()).text()).not.toContain('action="/recovery-api/bookings/off"');
  expect(await readFile(join(f.venueDir, "venue.db"), "utf8")).toBe("not a database");
});
it("does not clear failures or restart when the settings save fails", async () => {
  const f = await fixture();
  const opened = await openVenueDatabase(f.venueDir);
  try {
    await opened.venue.execute(
      sql`create trigger refuse_settings before update on settings begin select raise(abort, 'save refused'); end`,
    );
  } finally {
    await opened.close();
  }
  expect((await f.request("choice=move&password=administrator+password")).status).toBe(409);
  expect((await readRecoveryState(f.stateDir)).failures).toBe(3);
  expect(f.restart).not.toHaveBeenCalled();
});
