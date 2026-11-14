import { readModuleRecord } from "@waitron/provisioning";
import { heldSetup } from "../test/held-setup-database.js";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { SCRATCH_DIR } from "@waitron/store";
import { START_AGAIN_ROUTES } from "./setup-first-fiscal-api.js";
import { mountSetup } from "./setup-api.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";

const copyFails = vi.hoisted(() => ({ on: false, calls: 0 }));

vi.mock("./venue-private-copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./venue-private-copy.js")>();
  return {
    ...actual,
    copyVenueFiles: (...args: Parameters<typeof actual.copyVenueFiles>) => {
      if (!copyFails.on) return actual.copyVenueFiles(...args);
      copyFails.calls += 1;
      return Promise.reject(Object.assign(new Error("no space"), { code: "ENOSPC" }));
    },
  };
});

afterEach(() => {
  copyFails.on = false;
  copyFails.calls = 0;
});

const readFails = vi.hoisted(() => ({ on: false }));

vi.mock("./first-setup-database-holdings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./first-setup-database-holdings.js")>();
  const { SetupDatabaseReadFailed } = await import("./setup-database-read-failed.js");
  return {
    ...actual,
    readSetupDatabase: (...args: Parameters<typeof actual.readSetupDatabase>) =>
      readFails.on
        ? Promise.reject(new SetupDatabaseReadFailed("database unreadable: in place EIO"))
        : actual.readSetupDatabase(...args),
  };
});

afterEach(() => {
  readFails.on = false;
});

/** The database open as the ordinary server holds it, with one committed write still in its -wal. */
async function holdOpenWithPendingWrite(venueDir: string) {
  const held = await openVenueDatabase(venueDir);
  held.venue.run(
    sql`insert into settings (module, version, revision, doc, updated_at) values ('adjustments', 1, 1, '{}', ${new Date().toISOString()})`,
  );
  expect((await stat(join(venueDir, "venue.db-wal"))).size).toBeGreaterThan(0);
  return held;
}

async function stopOnOrdinaryServer(f: Awaited<ReturnType<typeof heldSetup>>) {
  const requestRestart = vi.fn();
  const log = vi.fn();
  const app = new Hono();
  mountSetup(app, { environment: "production", firstFiscal: f.host, requestRestart }, log);
  const inspection = await f.host.resolution.inspectFirstSetupResolution();
  const record = () => readFile(join(f.roots.stateDir, "flows/setup/record.json"));
  const before = await record();
  const socket = new TLSSocket(new Socket());
  try {
    const response = await app.request(
      `https://box.test${START_AGAIN_ROUTES.stop.path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspectionId: inspection.inspectionId,
          revision: inspection.revision,
          ownerGeneration: inspection.ownerGeneration,
        }),
      },
      { incoming: { socket } },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { response, before, after: await record(), requestRestart, log };
  } finally {
    socket.destroy();
  }
}

it("a committed setup whose publication failed: the stop writes nothing and the box restarts", async () => {
  const f = await heldSetup({ status: "committed" });
  const held = await holdOpenWithPendingWrite(f.roots.venueDir);
  try {
    const { response, before, after, requestRestart } = await stopOnOrdinaryServer(f);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ restarting: true });
    expect(after).toEqual(before);
    expect(requestRestart).toHaveBeenCalledOnce();
  } finally {
    await held.close();
  }
});

it("a committed setup held open with a pending write: when its database cannot be copied, the stop still restarts, and the repair page deletes it", async () => {
  const f = await heldSetup({ status: "committed" });
  const held = await holdOpenWithPendingWrite(f.roots.venueDir);
  // A -journal sends the read to a private copy; a -wal alone is read in place.
  const journal = join(f.roots.venueDir, "venue.db-journal");
  await writeFile(journal, "");
  copyFails.on = true;
  let stopped: Awaited<ReturnType<typeof stopOnOrdinaryServer>>;
  try {
    stopped = await stopOnOrdinaryServer(f);
  } finally {
    await held.close();
    await rm(journal);
  }
  expect(copyFails.calls).toBe(1);
  expect(stopped.response.status, await stopped.response.clone().text()).toBe(200);
  expect(stopped.after).toEqual(stopped.before);
  expect(stopped.requestRestart).toHaveBeenCalledOnce();
  await expectRepairPageDeletes(f);
  expect(copyFails.calls).toBe(1);
});

it("a committed setup whose database cannot be read: the stop logs why, writes nothing and the box restarts", async () => {
  const f = await heldSetup({ status: "committed" });
  readFails.on = true;
  const { response, before, after, requestRestart, log } = await stopOnOrdinaryServer(f);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(after).toEqual(before);
  expect(requestRestart).toHaveBeenCalledOnce();
  expect(log.mock.calls.filter(([, event]) => event === "setup.stop_database_read_failed")).toEqual(
    [["warn", "setup.stop_database_read_failed", { reason: "database unreadable: in place EIO" }]],
  );
});

it("a committed setup held open with a pending write and an invoice: the stop still refuses it, and restarts nothing", async () => {
  const f = await heldSetup({ status: "committed", invoices: 1 });
  const held = await holdOpenWithPendingWrite(f.roots.venueDir);
  let stopped: Awaited<ReturnType<typeof stopOnOrdinaryServer>>;
  try {
    stopped = await stopOnOrdinaryServer(f);
  } finally {
    await held.close();
  }
  expect(stopped.response.status).toBe(409);
  expect(await stopped.response.json()).toEqual({
    error: { code: "setup.start_again_refused", params: { cause: "kept-records" } },
  });
  expect(stopped.after).toEqual(stopped.before);
  expect(stopped.requestRestart).not.toHaveBeenCalled();
});

it("a finished setup is refused, writes nothing and restarts nothing", async () => {
  const f = await heldSetup({ status: "complete" });
  expect((await f.host.store.readResumable())!.publicationComplete).toBe(true);
  const { response, before, after, requestRestart } = await stopOnOrdinaryServer(f);
  expect(response.status).toBe(409);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    "setup.attempt_conflict",
  );
  expect(after).toEqual(before);
  expect(requestRestart).not.toHaveBeenCalled();
});

it("a committed setup whose publication failed: then the repair entry serves Start again for it, and Start again deletes it", async () => {
  const f = await heldSetup({ status: "committed" });
  expect((await resolveFirstSetupEntry(f.roots, {})).kind).toBe("resolution");
  const held = await holdOpenWithPendingWrite(f.roots.venueDir);
  let response: Response;
  try {
    ({ response } = await stopOnOrdinaryServer(f));
  } finally {
    await held.close();
  }
  expect(response.status, await response.clone().text()).toBe(200);
  await expectRepairPageDeletes(f);
});

async function expectRepairPageDeletes(f: Awaited<ReturnType<typeof heldSetup>>) {
  const admission = await resolveFirstSetupEntry(f.roots, {});
  if (admission.kind !== "resolution") throw new Error("Expected the repair entry");
  const socket = new TLSSocket(new Socket());
  try {
    const inspected = await admission.app.request(
      `https://box.test${START_AGAIN_ROUTES.inspect.path}`,
    );
    const { inspectionId, revision, ownerGeneration } = (await inspected.json()) as {
      inspectionId: string;
      revision: number;
      ownerGeneration: number;
    };
    for (const path of [START_AGAIN_ROUTES.summary.path, START_AGAIN_ROUTES.startAgain.path]) {
      const answer = await admission.app.request(
        `https://box.test${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inspectionId, revision, ownerGeneration }),
        },
        { incoming: { socket } },
      );
      expect(answer.status, await answer.clone().text()).toBe(200);
    }
  } finally {
    socket.destroy();
  }
  for (const dir of [f.roots.stateDir, f.roots.venueDir])
    expect(
      (await readdir(dir)).filter(
        (name) =>
          !name.endsWith(".lock") && (dir !== f.roots.stateDir || name !== "module-records"),
      ),
      dir,
    ).toEqual(dir === f.roots.stateDir ? ["flows", SCRATCH_DIR] : []);
  expect(await readdir(join(f.roots.stateDir, SCRATCH_DIR))).toEqual([]);
  expect(await readModuleRecord(f.roots.stateDir, "fiscal-verifactu")).toEqual({
    version: 1,
    prepared: [],
    retained: {},
  });
}
