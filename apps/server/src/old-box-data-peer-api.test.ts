import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { strFromU8, unzipSync } from "fflate";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  recordActivity,
  stampDeployment,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import { sha256Hex, verifyEnvelope } from "@waitron/handover";
import { seedManager, seedPerson } from "@waitron/identity/test/fixtures.js";
import { endorseKey, signDocumentBody, type CanonicalValue } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { UnreturnedRecord, WaitronModule } from "@waitron/module";
import { recordHandoverRestrictionTx } from "@waitron/node-db";
import { seedSale, seedVenueWithSeries } from "@waitron/reporting/test/fixtures.js";
import { beginHandover } from "./handover-store.js";
import { signAsThisBox } from "./handover-signing.js";
import { OLD_BOX_DATA_WORDS } from "./i18n/old-box-data.js";
import { RESTRICTED_DOWNLOAD_WORDS } from "./i18n/restricted-page.js";
import type { Logger } from "./logger.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { oldBoxDataRoute } from "./old-box-data-page.js";
import { mountOldBoxDataPeerApi, type OldBoxDataPeerDeps } from "./old-box-data-peer-api.js";
import { oneBuildAtATime } from "./old-box-data-turn.js";
import { makeOldBoxWorkbook } from "./old-box-data-workbook.js";
import { restrictedDownloadDeps } from "./restricted-page.js";
import { returnVenue } from "./return-records.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { row, sheetNamed } from "./testing/xlsx-rows.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const OPERATION = "00000000-0000-4000-8000-0000000000ee";
const NOW = Date.parse("2026-11-23T10:00:00.000Z");
const COPY_AT = Date.parse("2026-11-20T10:00:00.000Z");
const FIVE_MINUTES = 5 * 60_000;

const RECORDS: UnreturnedRecord[] = [1, 2].map((number) => ({
  saleId: `sale-${number}`,
  number,
  type: "issue",
  createdAt: "2026-11-20T10:00:00.000Z",
  filingState: null,
}));
/** A module whose summary is a list of record numbers the main box holds. */
const sample: WaitronModule = {
  name: "sample",
  version: "1.0.0",
  tier: "mandatory",
  handover: {
    summarise: async () => null,
    unreturned: async (_query, held) => [
      {
        ids: { chain: "old-box" },
        whole: held === undefined,
        records: RECORDS.filter((record) => !(Array.isArray(held) && held.includes(record.number))),
      },
    ],
  },
};

/** The old box, replaced by an emergency switch, that this suite's route runs on. */
let source: string;
/** The new main box its chart names. */
let receiver: string;
let lines: { level: string; event: string; fields: unknown }[];
const log: Logger = (level, event, fields) => {
  lines.push({ level, event, fields });
};

beforeEach(async () => {
  lines = [];
  await seedVenue(suite.db, { name: "Old box venue", timeZone: "Europe/Madrid" });
  await stampDeployment(suite.db, "preproduction");
  source = await seedNode(suite.db);
  receiver = await seedNode(suite.db);
  for (const nodeId of [source, receiver])
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  const sourceKey = await readNodeIdentityKey(suite.node, ring, source);
  const receiverKey = await readNodeIdentityKey(suite.node, ring, receiver);
  const body = {
    term: 3,
    nodes: [
      {
        nodeId: receiver,
        contactUrl: "https://receiver.test",
        standing: "serving-primary" as const,
      },
      { nodeId: source, contactUrl: "https://source.test", standing: "sell-only" as const },
    ],
  };
  await writeNodeMembership(suite.db, {
    body,
    signerNodeId: receiver,
    signature: signDocumentBody(body, receiverKey),
    endorsements: [endorseKey(receiver, nodeSigningPublicKey(receiverKey), source, sourceKey)],
  });
  await withNodeTransaction(suite.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: source,
      operationId: OPERATION,
      kind: "handed-over",
      successorNodeId: receiver,
      membershipTerm: 3,
    }),
  );
});

function appWith(over: Partial<OldBoxDataPeerDeps> = {}): Hono {
  const app = new Hono();
  mountOldBoxDataPeerApi(
    app,
    {
      db: suite.db,
      node: suite.node,
      ring,
      nodeId: source,
      modules: [sample],
      now: () => new Date(NOW),
      ...over,
    },
    log,
  );
  return app;
}

/** The main box's request body, signed by `signer` (the main box unless said otherwise). */
async function query(
  over: Record<string, CanonicalValue | undefined> = {},
  signer: string = receiver,
) {
  const body: Record<string, CanonicalValue> = {
    venue: (await returnVenue({ db: suite.db }))!,
    sourceNodeId: signer,
    destinationNodeId: source,
    nonce: randomUUID(),
    sentAtMs: NOW,
    language: "en",
    holdings: { sample: [1] },
  };
  for (const [key, value] of Object.entries(over))
    if (value === undefined) delete body[key];
    else body[key] = value;
  return signAsThisBox({ node: suite.node, ring, nodeId: signer }, "old-box-data-query", body);
}

function send(app: Hono, envelope: unknown): Promise<Response> {
  return Promise.resolve(
    app.request("https://source.test/api/node/old-box-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    }),
  );
}

interface Signed {
  nonce: string;
  sourceNodeId: string;
  madeOn: string;
  counts: Record<string, number>;
  sha256: string;
}

type Answer = Signed & { workbook: string };

/**
 * The old box's answer: its envelope verified under its own key, with the workbook beside it whose
 * fingerprint the envelope signs.
 */
async function answered(response: Response): Promise<Answer> {
  expect(response.status).toBe(200);
  const sourceKey = nodeSigningPublicKey(await readNodeIdentityKey(suite.node, ring, source));
  const { envelope, workbook, ...rest } = (await response.json()) as {
    envelope: unknown;
    workbook: string;
  };
  expect(rest).toEqual({});
  const verified = verifyEnvelope<Signed>(envelope, "old-box-data", (id) =>
    id === source ? sourceKey : undefined,
  );
  if (!verified.valid) throw new Error(`the answer did not verify: ${verified.reason}`);
  expect(verified.body).not.toHaveProperty("workbook");
  expect(verified.body.sha256).toBe(sha256Hex(Buffer.from(workbook, "base64")));
  return { ...verified.body, workbook };
}

const files = (answer: Answer) => unzipSync(new Uint8Array(Buffer.from(answer.workbook, "base64")));

async function expectRefused(response: Response, reason: string): Promise<void> {
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "handover.old_box_data_query_refused", params: { reason } },
  });
}

function venueFile(): string {
  return suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
}

/** venue.db together with its write-ahead log, where a write lands before a checkpoint. */
async function venueHash(): Promise<string> {
  const hash = createHash("sha256");
  for (const path of [venueFile(), `${venueFile()}-wal`]) {
    try {
      hash.update(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

describe("POST /api/node/old-box-data on the old box", () => {
  it("answers the main box's signed request with a workbook of what its summary lacks, and a signed envelope naming its SHA-256", async () => {
    const request = await query();
    const answer = await answered(await send(appWith(), request));
    expect(answer).toMatchObject({
      nonce: request.body.nonce,
      sourceNodeId: receiver,
      madeOn: "2026-11-23",
      counts: { invoiceRows: 1 },
    });
    const invoices = sheetNamed(files(answer), OLD_BOX_DATA_WORDS.en.invoiceSheet)!;
    // The summary is stamped with the time the request arrived.
    expect(row(invoices, 1)).toEqual([
      OLD_BOX_DATA_WORDS.en.invoiceIntro.replace("{time}", "2026-11-23 11:00+01:00"),
    ]);
    expect(row(invoices, 3)[0]).toBe("sale-2");
    expect(row(invoices, 4)).toEqual([]);
  });

  it.each(["en", "es"] as const)(
    "names the tabs in the request's language (%s)",
    async (language) => {
      const answer = await answered(await send(appWith(), await query({ language })));
      const workbook = strFromU8(files(answer)["xl/workbook.xml"]!);
      const words = OLD_BOX_DATA_WORDS[language];
      for (const name of [
        words.invoiceSheet,
        words.ordersSheet,
        words.paymentsSheet,
        words.hoursSheet,
        words.activitySheet,
      ])
        expect(workbook).toContain(`<sheet name="${name}"`);
    },
  );

  it("logs ids, counts and codes, never a name the file holds", async () => {
    const named = await seedPerson(suite.db, "manager");
    const NAME = "Marta Ruiz Quintana";
    await suite.db.run(sql`update persons set display_name = ${NAME} where id = ${named}`);
    await withTransaction(suite.db, (tx) =>
      recordActivity(tx, {
        kind: "dashboard.signed_in",
        subjectId: named,
        personId: named,
        data: { method: "password" },
        at: new Date(COPY_AT),
      }),
    );
    const answer = await answered(await send(appWith(), await query({ lastChangeAtMs: COPY_AT })));
    // The control: the name reaches the file, so its absence from the log means something.
    expect(sheetNamed(files(answer), OLD_BOX_DATA_WORDS.en.activitySheet)).toContain(NAME);
    const sent = lines.find((line) => line.event === "old_box_data.sent");
    expect(sent?.fields).toMatchObject({
      nodeId: receiver,
      since: "copy",
      invoiceRows: 1,
    });
    await send(appWith(), await query({ language: "fr" }));
    expect(lines.some((line) => line.event === "handover.old_box_data_query_refused")).toBe(true);
    for (const line of lines) expect(JSON.stringify(line)).not.toContain(NAME);
  });
});

describe("the since tabs of the old box's answer", () => {
  const firstLine = async (over: Record<string, CanonicalValue | undefined>) => {
    const answer = await answered(await send(appWith(), await query(over)));
    const activity = sheetNamed(files(answer), OLD_BOX_DATA_WORDS.en.activitySheet);
    return activity === undefined ? undefined : row(activity, 1);
  };

  it("after an emergency switch, start 10 minutes before the request's copy time", async () => {
    expect(await firstLine({ lastChangeAtMs: COPY_AT })).toEqual([
      OLD_BOX_DATA_WORDS.en.sinceCopyIntro.replace("{time}", "2026-11-20 10:50:00.000+01:00"),
    ]);
  });

  it("list everything when the request says the copy held no sale or order", async () => {
    expect(await firstLine({ lastChangeAtMs: null })).toEqual([
      OLD_BOX_DATA_WORDS.en.sinceAllIntro,
    ]);
  });

  it("start 7 days before this box's latest change when the request has no copy time", async () => {
    const venue = await seedVenueWithSeries(suite.db);
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-20T10:00:00.000Z",
      total: "10.00",
      lines: [{ vatRate: "10.00", lineTotal: "10.00" }],
    });
    expect(await firstLine({})).toEqual([
      OLD_BOX_DATA_WORDS.en.sinceOwnIntro.replace("{time}", "2026-11-13 11:00:00.000+01:00"),
    ]);
  });

  it("are left out after a planned handover", async () => {
    await beginHandover(
      { node: suite.node, nodeId: source },
      {
        operationId: OPERATION,
        scenario: "controlled",
        venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
        sourceNodeId: source,
        destinationNodeId: receiver,
        membership: { term: 3, digest: "a".repeat(64) },
      },
      "source",
    );
    const answer = await answered(await send(appWith(), await query({ lastChangeAtMs: COPY_AT })));
    expect(files(answer)["xl/worksheets/sheet1.xml"]).toBeDefined();
    expect(files(answer)["xl/worksheets/sheet2.xml"]).toBeUndefined();
  });
});

describe("refusals of POST /api/node/old-box-data", () => {
  it("refuses a request signed by a box other than the main box", async () => {
    await expectRefused(await send(appWith(), await query({}, source)), "signer");
  });

  it("refuses a request whose signature does not match its body", async () => {
    const request = await query();
    await expectRefused(
      await send(appWith(), { ...request, body: { ...request.body, language: "es" } }),
      "signature",
    );
  });

  it.each([
    [
      "another venue",
      { venue: { country: "ES", taxId: "B00000000", environment: "preproduction" } },
    ],
    ["another destination", { destinationNodeId: "00000000-0000-4000-8000-0000000000ab" }],
    ["another source", { sourceNodeId: "00000000-0000-4000-8000-0000000000ab" }],
  ])("refuses a request for %s", async (_name, over) => {
    await expectRefused(await send(appWith(), await query(over)), "binding");
  });

  it("refuses a repeated request", async () => {
    const app = appWith();
    const request = await query();
    await answered(await send(app, request));
    await expectRefused(await send(app, request), "nonce");
  });

  it("refuses a request sent more than 5 minutes from this box's clock, either way", async () => {
    const app = appWith();
    for (const sentAtMs of [NOW - FIVE_MINUTES - 1, NOW + FIVE_MINUTES + 1])
      await expectRefused(await send(app, await query({ sentAtMs })), "stale");
    for (const sentAtMs of [NOW - FIVE_MINUTES, NOW + FIVE_MINUTES])
      await answered(await send(app, await query({ sentAtMs })));
  });

  it.each([
    ["a summary that is not an object", { holdings: [1] }],
    ["no summary", { holdings: undefined }],
    ["a copy time that is not a date", { lastChangeAtMs: Number.MAX_SAFE_INTEGER }],
    ["a copy time that is not a number", { lastChangeAtMs: "1" }],
    ["another language", { language: "fr" }],
    ["no language", { language: undefined }],
    ["an empty nonce", { nonce: "" }],
    ["a send time that is not a whole number", { sentAtMs: NOW + 0.5 }],
  ])("refuses a request with %s", async (_name, over) => {
    await expectRefused(await send(appWith(), await query(over)), "request");
  });

  it("refuses while a wipe is under way", async () => {
    await expectRefused(await send(appWith({ resetOrdered: () => true }), await query()), "wiping");
  });

  it("refuses a second request while the first is being made, and serves the next", async () => {
    let entered!: () => void;
    const holding = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const app = appWith({
      build: async (input) => {
        if (calls++ === 0) {
          entered();
          await gate;
        }
        return makeOldBoxWorkbook(input);
      },
    });
    const first = send(app, await query());
    try {
      await holding;
      await expectRefused(await send(app, await query()), "busy");
    } finally {
      release();
    }
    await answered(await first);
    await answered(await send(app, await query()));
  });

  it("gives the turn back after a build that fails", async () => {
    let calls = 0;
    const app = appWith({
      build: async (input) => {
        if (calls++ === 0) throw new Error("build failed");
        return makeOldBoxWorkbook(input);
      },
    });
    const failed = await send(app, await query());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: { code: "server.internal" } });
    expect(lines).toContainEqual({
      level: "error",
      event: "old_box_data.peer_failed",
      fields: { errorCode: "unknown", requestId: undefined },
    });
    await answered(await send(app, await query()));
  });
});

describe("the one build at a time the old box's page and its peer route share", () => {
  let socket: TLSSocket;
  beforeEach(() => {
    socket = new TLSSocket(new Socket());
  });
  afterEach(() => {
    socket.destroy();
  });

  it("refuses the peer request while the page holds the turn, and the page while the peer request does", async () => {
    const EMAIL = "owner@example.test";
    await seedManager(suite.db, { email: EMAIL, role: "admin" });
    const turn = oneBuildAtATime();
    const pageTaken = turn.take()!;
    await expectRefused(await send(appWith({ turn }), await query()), "busy");
    pageTaken();

    let entered!: () => void;
    const holding = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const peer = appWith({
      turn,
      build: async (input) => {
        entered();
        await gate;
        return makeOldBoxWorkbook(input);
      },
    });
    const page = new Hono();
    oldBoxDataRoute({
      ...restrictedDownloadDeps({ venue: suite.db, node: suite.node, nodeId: source, log }),
      modules: [sample],
      totpKeyRing: TOTP_KEY_RING,
      turn,
    })(page);
    const first = send(peer, await query());
    try {
      await holding;
      const refused = await page.request(
        "https://source.test/old-box-data",
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://source.test",
            "sec-fetch-site": "same-origin",
            "accept-language": "en-GB",
          },
          body: new URLSearchParams({ email: EMAIL, password: "correct horse" }).toString(),
        },
        { incoming: { socket } },
      );
      expect(refused.status).toBe(409);
      expect(await refused.text()).toContain(RESTRICTED_DOWNLOAD_WORDS["en-GB"].busy);
    } finally {
      release();
    }
    await answered(await first);
  }, 15_000);
});

describe("what the old box's answer writes", () => {
  it("leaves venue.db's file unchanged", async () => {
    const app = appWith();
    const request = await query({ lastChangeAtMs: COPY_AT });
    const before = await venueHash();
    await answered(await send(app, request));
    expect(await venueHash()).toBe(before);
  });

  it("the control: one row written through the test's own handle changes the hash", async () => {
    const before = await venueHash();
    await seedPerson(suite.db, "manager");
    expect(await venueHash()).not.toBe(before);
  });
});
