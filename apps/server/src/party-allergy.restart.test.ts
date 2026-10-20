import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { openVenueDatabase, orderGroups, ticketItems } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashSessionToken, persons, sessions } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { PartyAllergyRead } from "@waitron/module";
import { readPartyAllergy, setRoutingCell } from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { readPartyAllergyView } from "./party-allergy.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import { freePorts } from "./testing/free-ports.js";
import {
  OPERATOR,
  inTx,
  revisionOf,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { SESSION_COOKIE } from "./till-session.js";
import { mountTillApi } from "./till-api.js";

let v: PartyVenue;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    v = await setupPartyVenue(db);
    await db.insert(persons).values({ id: OPERATOR, displayName: "Test operator", role: "staff" });
  },
});

async function boot(env: NodeJS.ProcessEnv) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
      fileURLToPath(new URL("./bin.ts", import.meta.url)),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const deadline = setTimeout(() => child.kill("SIGKILL"), 12_000);
    try {
      return await exited;
    } finally {
      clearTimeout(deadline);
    }
  };
  const close = async () => {
    expect(await stop(), output).toEqual({ code: 0, signal: null });
  };
  try {
    await vi.waitFor(
      () => {
        expect(child.exitCode, output).toBeNull();
        expect(output, output).toContain('"event":"server.listening"');
      },
      { timeout: 60_000 },
    );
    return { close, pid: child.pid! };
  } catch (error) {
    await stop();
    throw error;
  }
}

describe("A669 consideration through a server process restart", () => {
  it.each([
    { path: "direct", noPreparation: false },
    { path: "direct", noPreparation: true },
    { path: "draft", noPreparation: false },
    { path: "draft", noPreparation: true },
  ])(
    "$path retains unticked held work with no-preparation $noPreparation, while a fresh draft remains new",
    async ({ path, noPreparation }) => {
      const productName = noPreparation ? "Flan" : "Burger";
      const party = await seat(v, await v.table(`Restart ${randomUUID().slice(0, 8)}`));
      if (noPreparation)
        await inTx(v, (tx) =>
          setRoutingCell(
            tx,
            v.cfg,
            {
              row: { kind: "product", productId: v.productId(productName) },
              zoneId: v.tables.zoneId,
            },
            { kind: "no_preparation" },
          ),
        );
      const draft = await inTx(v, (tx) =>
        saveDraftForTest(tx, v.cfg, party.partyId, OPERATOR, {
          billId: party.tabId,
          draftId: null,
          revision: 0,
          lines: Array.from({ length: path === "draft" ? 2 : 1 }, (_, index) => ({
            sourceLineId: null,
            menuItemId: v.item(productName),
            variantId: null,
            menuVersionId: null,
            options: [],
            extras: [],
            note: null,
            quantity: "1",
            courseId: null,
            noMerge: true,
            slot: index,
            joinGroupId: null,
            afterGroupId: null,
          })),
        }),
      );
      const token = randomUUID();
      await v.db
        .update(sessions)
        .set({ tokenHash: hashSessionToken(token) })
        .where(eq(sessions.id, v.operator.sessionId));
      const command = {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(v, party.partyId),
        expectedEdit: await inTx(v, (tx) => readBillEditState(tx, party.tabId)),
        ...(path === "draft"
          ? {
              draftRevision: draft.revision,
              groups: [{ release: "hold", lineIds: [draft.lines[0]!.id] }],
            }
          : {
              groups: [
                { release: "hold", lines: [{ menuItemId: v.item(productName), quantity: "1" }] },
              ],
            }),
        allergy: {
          party: {
            answer: "allergies",
            guests: [{ who: "Alex", allergens: { milk: {} }, note: "Separate utensils" }],
          },
          ticks: [],
        },
      };
      const freshLineId = draft.lines[path === "draft" ? 1 : 0]!.id;
      const scratch = await mkdtemp(join(tmpdir(), "waitron-allergy-restart-"));
      let server: Awaited<ReturnType<typeof boot>> | undefined;
      try {
        const venueDir = join(scratch, "venue");
        await mkdir(venueDir);
        await suite.db.run(sql`vacuum into ${join(venueDir, "venue.db")}`);
        const migrationsRoot = join(scratch, "migrations");
        await copyMigrationsRoot(migrationsRoot);
        await writeFile(
          join(scratch, "modules.json"),
          JSON.stringify({ modules: { "fiscal-none": false } }),
        );
        const [firstPort, secondPort] = await freePorts(2);
        const env: NodeJS.ProcessEnv = {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("WAITRON_")),
          ),
          WAITRON_HTTP_HOST: "127.0.0.1",
          WAITRON_HTTP_LANDING_PORT: "0",
          WAITRON_HTTP_PORT: String(firstPort),
          WAITRON_STATE_DIR: scratch,
          WAITRON_VENUE_DIR: venueDir,
          WAITRON_TILL_NODE_ID: v.cfg.nodeId,
          WAITRON_TILL_LOCATION_ID: v.cfg.locationId,
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_ENV: "preproduction",
          WAITRON_CLOUD_ORIGIN: "https://cloud.example",
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
          WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
        };
        let port = firstPort;
        const request = async <T>(path: string, body?: unknown): Promise<T> => {
          const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(10_000),
          });
          const result: unknown = await response.json();
          expect(response.status, JSON.stringify(result)).toBe(200);
          return result as T;
        };
        const view = () => request<PartyAllergyRead>(`/api/parties/${party.partyId}/allergy`);
        server = await boot(env);
        const firstPid = server.pid;
        const submitted = await request<{ groups: { id: string }[] }>(
          `/api/parties/${party.partyId}/${path === "draft" ? `drafts/${draft.id}/submit` : "groups"}`,
          command,
        );
        const groupId = submitted.groups[0]!.id;
        const before = await view();
        expect(before.snapshot).toMatchObject({
          answer: "allergies",
          guests: [{ who: "Alex", note: "Separate utensils" }],
          ticks: [],
        });
        const held = before.dishes.find((dish) => dish.line.kind === "working")!;
        expect(held).toMatchObject({ offeredBefore: true, sentAt: null, billId: party.tabId });
        expect(before.dishes.find((dish) => dish.line.kind === "draft")).toMatchObject({
          line: { kind: "draft", id: freshLineId },
          offeredBefore: false,
          sentAt: null,
        });
        const previewPath = `/api/parties/${party.partyId}/allergy/send-preview`;
        const preview = await request<PartyAllergyRead>(previewPath, { kind: "group", groupId });
        expect(preview.dishes).toEqual([held]);
        await server.close();
        server = undefined;
        const inspected = await openVenueDatabase(venueDir);
        try {
          expect(
            await inspected.venue
              .select({ holdPrintedAt: orderGroups.holdPrintedAt })
              .from(orderGroups)
              .where(eq(orderGroups.id, groupId)),
          ).toEqual([{ holdPrintedAt: null }]);
          if (noPreparation)
            expect(
              await inspected.venue
                .select()
                .from(ticketItems)
                .where(eq(ticketItems.workingOrderId, party.tabId)),
            ).toEqual([]);
        } finally {
          await inspected.close();
        }
        port = secondPort;
        server = await boot({ ...env, WAITRON_HTTP_PORT: String(port) });
        expect(server.pid).not.toBe(firstPid);
        expect(await view()).toEqual(before);
        expect(await request<PartyAllergyRead>(previewPath, { kind: "group", groupId })).toEqual(
          preview,
        );
        await request(`/api/parties/${party.partyId}/groups/${groupId}/fire`, {
          submissionId: randomUUID(),
          expectedPartyRevision: before.snapshot.revision,
        });
        const after = await view();
        expect(after.snapshot.guests).toEqual(before.snapshot.guests);
        expect(after.snapshot.ticks).toEqual([]);
        expect(after.dishes.find((dish) => dish.line.kind === "working")).toMatchObject({
          line: held.line,
          offeredBefore: true,
          sentAt: expect.any(String),
        });
        expect(after.dishes.find((dish) => dish.line.kind === "draft")).toMatchObject({
          line: { kind: "draft", id: freshLineId },
          offeredBefore: false,
          sentAt: null,
        });
        await server.close();
        server = undefined;
      } finally {
        try {
          await server?.close();
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
      }
    },
    240_000,
  );
});

describe("A669 submit HTTP assignments", () => {
  for (const path of ["draft", "direct"] as const) {
    it.each(["hold", "fire"] as const)(
      `${path} carries the guest and dish assignment through %s`,
      async (release) => {
        const party = await seat(v, await v.table(`Assigned ${randomUUID().slice(0, 8)}`));
        const draft =
          path === "direct"
            ? null
            : await inTx(v, (tx) =>
                saveDraftForTest(tx, v.cfg, party.partyId, OPERATOR, {
                  billId: party.tabId,
                  draftId: null,
                  revision: 0,
                  lines: [
                    {
                      sourceLineId: null,
                      menuItemId: v.item("Burger"),
                      variantId: null,
                      menuVersionId: null,
                      options: [],
                      extras: [],
                      note: null,
                      quantity: "1",
                      courseId: null,
                      noMerge: true,
                      slot: 0,
                      joinGroupId: null,
                      afterGroupId: null,
                    },
                  ],
                }),
              );
        const token = randomUUID();
        await v.db
          .update(sessions)
          .set({ tokenHash: hashSessionToken(token) })
          .where(eq(sessions.id, v.operator.sessionId));
        const body = {
          submissionId: randomUUID(),
          expectedPartyRevision: await revisionOf(v, party.partyId),
          expectedEdit: await inTx(v, (tx) => readBillEditState(tx, party.tabId)),
          ...(draft === null
            ? { groups: [{ release, lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }] }
            : {
                draftRevision: draft.revision,
                groups: [{ release, lineIds: [draft.lines[0]!.id] }],
              }),
          allergy: {
            party: {
              answer: "allergies",
              guests: [
                { who: "Assigned guest", allergens: { milk: {} }, note: "Assigned guest note" },
              ],
            },
            ticks: [
              {
                line:
                  draft === null
                    ? { kind: "submitted", groupIndex: 0, lineIndex: 0 }
                    : { kind: "draft", id: draft.lines[0]!.id },
                guestIndex: 0,
              },
            ],
          },
        };
        const app = new Hono();
        mountTillApi(
          app,
          {
            db: v.db,
            cfg: v.cfg,
            backend: v.backend,
            clock: v.clock,
            secureCookies: false,
            venueLocale: "en-GB",
          },
          () => {},
        );
        const request = () =>
          app.request(
            `/api/parties/${party.partyId}/${draft === null ? "groups" : `drafts/${draft.id}/submit`}`,
            {
              method: "POST",
              headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
              body: JSON.stringify(body),
            },
          );
        const response = await request();
        const submitted: unknown = await response.json();
        expect(response.status, JSON.stringify(submitted)).toBe(200);
        const snapshot = await inTx(v, (tx) => readPartyAllergy(tx, party.partyId));
        expect(snapshot).toMatchObject({
          answer: "allergies",
          guests: [{ who: "Assigned guest", allergens: { milk: {} }, note: "Assigned guest note" }],
        });
        const current = await inTx(v, (tx) => readPartyAllergyView(tx, v.cfg, party.partyId));
        expect(current.dishes).toHaveLength(1);
        const line = current.dishes[0]!.line;
        expect(line.kind).toBe("working");
        if (line.kind !== "working") throw new Error("submit did not create a working dish");
        expect(snapshot.ticks).toEqual([
          { guestId: snapshot.guests[0]!.id, draftLineId: null, workingLineId: line.id },
        ]);
        const retry = await request();
        expect(retry.status).toBe(200);
        expect(await retry.json()).toEqual(submitted);
        expect(await inTx(v, (tx) => readPartyAllergy(tx, party.partyId))).toEqual(snapshot);
      },
    );
  }
});
