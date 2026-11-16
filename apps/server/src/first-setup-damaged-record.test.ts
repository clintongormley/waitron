import { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";
import { openVenueDatabase, invoiceSeries, sales, withTransaction } from "@waitron/db";
import { count, eq } from "drizzle-orm";
import { registrosFacturacion } from "@waitron/fiscal-verifactu/src/schema/registros.js";
import { recordSale } from "@waitron/core";
import { nodeId, seriesId } from "@waitron/shared";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { heldSetup } from "../test/held-setup-database.js";
import { withoutSignIn } from "../test/start-again-held-fixture.js";
import { diskSnapshot, expectStartAgainDeleted } from "../test/start-again-deleted.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";

async function damaged(options: Parameters<typeof heldSetup>[0] = {}, keepNode = false) {
  return damageRecord(await heldSetup(options), keepNode);
}
async function damageRecord(f: Awaited<ReturnType<typeof heldSetup>>, keepNode = false) {
  if (!keepNode) await rm(join(f.roots.venueDir, "node.db"));
  await rm(join(f.roots.stateDir, "flows/setup/documents"), { recursive: true, force: true });
  await writeFile(join(f.roots.stateDir, "flows/setup/record.json"), "{truncated");
  return f;
}

it("a fully damaged setup record with no kept records offers unknown history and deletes only after confirmation", async () => {
  const f = await damaged();
  const { ids, actions } = await withoutSignIn(f);
  const before = await diskSnapshot(f.roots);
  const shown = await actions.startAgainSummary(ids);
  expect(shown).toEqual({ reached: "unknown" });
  expect(ids.revision).toBeNull();
  expect(ids.ownerGeneration).toBeNull();
  await expect(actions.startAgainFirstSetup(ids)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await diskSnapshot(f.roots)).toEqual(before);
  await actions.startAgainFirstSetup({ ...ids, confirmDamagedSetupRecord: { shown } });
  await expectStartAgainDeleted(f.roots);
});

it("a damaged setup record never hides a sale and its fiscal record", async () => {
  const f = await damaged({ invoices: 1 });
  const { ids, actions } = await withoutSignIn(f);
  const before = await diskSnapshot(f.roots);
  for (const send of [
    () => actions.startAgainSummary(ids),
    () =>
      actions.startAgainFirstSetup({
        ...ids,
        confirmDamagedSetupRecord: { shown: { reached: "unknown" } },
      }),
  ])
    await expect(send()).rejects.toMatchObject({
      code: "setup.start_again_refused",
      params: { cause: "kept-records" },
    });
  expect(await diskSnapshot(f.roots)).toEqual(before);
});

it.each(["documents", "trading", "database", "missing-database", "outside", "node"])(
  "damaged record keeps the %s refusal and all files",
  async (kind) => {
    const f = await damaged({ tradingSettings: kind === "trading" }, kind === "node");
    if (kind === "documents") {
      await mkdir(join(f.roots.stateDir, "flows/setup/documents"));
      await writeFile(join(f.roots.stateDir, "flows/setup/documents/evidence.json"), "{}");
    }
    if (kind === "database")
      await writeFile(join(f.roots.venueDir, "venue.db"), "damaged database");
    if (kind === "missing-database") await rm(join(f.roots.venueDir, "venue.db"));
    if (kind === "outside")
      f.host.resolution = {
        ...f.host.resolution,
        ...createFirstSetupResolutionInspection({
          ...f.roots,
          store: f.host.store,
          modules: f.host.modules,
          publicEvidencePaths: [join(f.roots.stateDir, "lost-evidence.json")],
        }),
      };
    const { ids, actions } = await withoutSignIn(f);
    const before = await diskSnapshot(f.roots);
    await expect(actions.startAgainSummary(ids)).rejects.toMatchObject({ code: "setup.not_ready" });
    expect(await diskSnapshot(f.roots)).toEqual(before);
  },
);

it("the damaged-record routes admit null counters only for the flagged summary and confirmed wipe", async () => {
  const f = await damaged();
  const { ids, actions } = await withoutSignIn(f);
  const app = new Hono();
  const restart = vi.fn();
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    startAgain: actions.startAgainFirstSetup,
    summary: actions.startAgainSummary,
    stop: actions.stopForStartAgain,
    requestRestart: restart,
  });
  const socket = new TLSSocket(new Socket());
  const post = (route: string, body: unknown) =>
    app.request(
      `https://box.test/setup-api/first-setup/resolution/${route}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://box.test" },
        body: JSON.stringify(body),
      },
      { incoming: { socket } },
    );
  try {
    const before = await diskSnapshot(f.roots);
    expect((await post("stop", ids)).status).toBe(400);
    expect((await post("start-again/summary", { ...ids, revision: 1 })).status).toBe(400);
    const summary = await post("start-again/summary", ids);
    expect(summary.status).toBe(200);
    expect(await summary.json()).toEqual({ reached: "unknown" });
    for (const [extra, code] of [
      [{}, "setup.attempt_conflict"],
      [{ confirmDamagedSetupRecord: { shown: { reached: "named" } } }, "setup.request_invalid"],
      [
        { confirmDamagedSetupRecord: { shown: { reached: "unknown", databaseUnreadable: true } } },
        "setup.request_invalid",
      ],
    ] as const) {
      const refused = await post("start-again", { ...ids, ...extra });
      expect(await refused.json()).toMatchObject({ error: { code } });
      expect(await diskSnapshot(f.roots)).toEqual(before);
    }
    const wiped = await post("start-again", {
      ...ids,
      confirmDamagedSetupRecord: { shown: { reached: "unknown" } },
    });
    expect(wiped.status).toBe(200);
    expect(await wiped.json()).toEqual({ restarting: true });
    await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
    await expectStartAgainDeleted(f.roots);
  } finally {
    socket.destroy();
  }
});

it("valid JSON with an invalid setup envelope stays refused through summary and wipe", async () => {
  const f = await damaged();
  await writeFile(join(f.roots.stateDir, "flows/setup/record.json"), "{}");
  const { ids, actions } = await withoutSignIn(f);
  const app = new Hono();
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    startAgain: actions.startAgainFirstSetup,
    summary: actions.startAgainSummary,
  });
  const socket = new TLSSocket(new Socket());
  const before = await diskSnapshot(f.roots);
  try {
    for (const route of ["start-again/summary", "start-again"]) {
      const answer = await app.request(
        `https://box.test/setup-api/first-setup/resolution/${route}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://box.test" },
          body: JSON.stringify(ids),
        },
        { incoming: { socket } },
      );
      expect(answer.status).toBe(409);
      expect(await answer.json()).toMatchObject({ error: { code: "setup.attempt_invalid" } });
    }
    expect(await diskSnapshot(f.roots)).toEqual(before);
  } finally {
    socket.destroy();
  }
});

it("changing damaged bytes after the summary refuses the stale confirmed wipe", async () => {
  const f = await damaged();
  const { ids, actions } = await withoutSignIn(f);
  const shown = await actions.startAgainSummary(ids);
  await writeFile(join(f.roots.stateDir, "flows/setup/record.json"), "{different damaged bytes");
  const before = await diskSnapshot(f.roots);
  await expect(
    actions.startAgainFirstSetup({ ...ids, confirmDamagedSetupRecord: { shown } }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await diskSnapshot(f.roots)).toEqual(before);
});

it("a sale without any fiscal record still refuses damaged-record deletion", async () => {
  const f = await heldSetup();
  const state = (await f.host.store.read())!;
  const db = await openVenueDatabase(f.roots.venueDir);
  try {
    const [series] = await db.venue
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.nodeId, state.frozen.nodeId));
    await withTransaction(db.venue, (tx) =>
      recordSale(
        tx,
        f.host.modules
          .find((module) => module.name === "fiscal-none")!
          .fiscal!.makeBackend({
            db: db.venue,
            clock: steadyClock,
            environment: state.frozen.environment,
          }),
        saleInput({ nodeId: nodeId(state.frozen.nodeId), seriesId: seriesId(series!.id) }),
      ),
    );
    expect(await db.venue.select({ count: count() }).from(sales)).toEqual([{ count: 1 }]);
    expect(await db.venue.select({ count: count() }).from(registrosFacturacion)).toEqual([
      { count: 0 },
    ]);
  } finally {
    await db.close();
  }
  await damageRecord(f);
  const { ids, actions } = await withoutSignIn(f);
  const before = await diskSnapshot(f.roots);
  await expect(actions.startAgainSummary(ids)).rejects.toMatchObject({
    code: "setup.start_again_refused",
    params: { cause: "kept-records" },
  });
  expect(await diskSnapshot(f.roots)).toEqual(before);
});
