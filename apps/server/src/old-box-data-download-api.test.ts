import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  handoverActivations,
  stampDeployment,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import { startManagementSession } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { endorseKey, signDocumentBody, type NodeStanding } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { UnreturnedRecord, WaitronModule } from "@waitron/module";
import { beginHandoverOperationTx, recordHandoverRestrictionTx } from "@waitron/node-db";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { signAsThisBox } from "./handover-signing.js";
import type { Logger } from "./logger.js";
import { AnswerTooLarge } from "./mirror-bundle-fetch.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import {
  mountOldBoxDataDownloadApi,
  type OldBoxDataDownloadDeps,
} from "./old-box-data-download-api.js";
import { readHoldings } from "./old-box-holdings.js";
import { mountOldBoxDataPeerApi, type OldBoxDataPeerDeps } from "./old-box-data-peer-api.js";
import { orderReset } from "./reset-order.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { workbookDownloadHeaders } from "./xlsx-workbook.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const NOW = Date.parse("2026-11-23T10:00:00.000Z");
const COPY_AT = Date.parse("2026-11-20T10:00:00.000Z");
const OLD_URL = "https://old.test";

const RECORDS: UnreturnedRecord[] = [1, 2].map((number) => ({
  saleId: `sale-${number}`,
  number,
  type: "issue",
  createdAt: "2026-11-20T10:00:00.000Z",
  filingState: null,
}));
/** The old box's module: its unreturned records are those the main box's summary lacks. */
const oldSample: WaitronModule = {
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
/** The main box's module, whose summary says it holds record 1. */
const mainSample: WaitronModule = {
  ...oldSample,
  handover: { ...oldSample.handover!, holdings: async () => [1] },
};

/** This suite's box: the new main box. */
let main: string;
/** The replaced old main box it asks. */
let oldBox: string;
let adminId: string;
let adminCookie: string;
let lines: { level: string; event: string; fields: Record<string, unknown> | undefined }[];
const log: Logger = (level, event, fields) => {
  lines.push({ level, event, fields });
};

async function holdChart({
  oldStanding = "sell-only",
  oldUrl = OLD_URL,
  primary,
}: { oldStanding?: NodeStanding; oldUrl?: string; primary?: string } = {}) {
  const mainKey = await readNodeIdentityKey(suite.node, ring, main);
  const oldKey = await readNodeIdentityKey(suite.node, ring, oldBox);
  const body = {
    term: 3,
    nodes: [
      {
        nodeId: main,
        contactUrl: "https://main.test",
        standing: (primary === undefined ? "serving-primary" : "serving-secondary") as NodeStanding,
      },
      { nodeId: oldBox, contactUrl: oldUrl, standing: oldStanding },
      ...(primary === undefined
        ? []
        : [
            {
              nodeId: primary,
              contactUrl: "https://other.test",
              standing: "serving-primary" as NodeStanding,
            },
          ]),
    ],
  };
  await writeNodeMembership(suite.db, {
    body,
    signerNodeId: main,
    signature: signDocumentBody(body, mainKey),
    endorsements: [endorseKey(main, nodeSigningPublicKey(mainKey), oldBox, oldKey)],
  });
}

async function sessionFor(role: "admin" | "manager", locale: string | null = null) {
  return withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: `P-${randomUUID()}`,
      role,
      ...(locale === null ? {} : { locale }),
    });
    const session = await startManagementSession(tx, { method: "password", personId: person!.id });
    await setFreshManagementSignIn(tx, session.token);
    return { personId: person!.id, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  });
}

beforeEach(async () => {
  lines = [];
  await seedVenue(suite.db, { name: "Download venue", timeZone: "Europe/Madrid" });
  await stampDeployment(suite.db, "preproduction");
  main = await seedNode(suite.db);
  oldBox = await seedNode(suite.db);
  for (const nodeId of [main, oldBox])
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  const oldKey = await readNodeIdentityKey(suite.node, ring, oldBox);
  await pinMainBoxKey(suite.node, main, {
    nodeId: oldBox,
    publicKey: nodeSigningPublicKey(oldKey),
  });
  await holdChart();
  // The old box, stepped down, names this box as the one it answers.
  await withNodeTransaction(suite.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: oldBox,
      operationId: randomUUID(),
      kind: "handed-over",
      successorNodeId: main,
      membershipTerm: 3,
    }),
  );
  ({ personId: adminId, cookie: adminCookie } = await sessionFor("admin"));
});

/** The old box's own route, reached through `postToBox`'s `fetch` stand-in. */
function oldBoxApp(over: Partial<OldBoxDataPeerDeps> = {}): Hono {
  const app = new Hono();
  mountOldBoxDataPeerApi(
    app,
    {
      db: suite.db,
      node: suite.node,
      ring,
      nodeId: oldBox,
      modules: [oldSample],
      now: () => new Date(NOW),
      ...over,
    },
    log,
  );
  return app;
}

interface Exchange {
  /** The signed request bodies the old box received. */
  sent: Record<string, unknown>[];
  /** The old box's answers, as text. */
  answers: string[];
  fetch: typeof fetch;
}

/** A `fetch` that hands each request to `oldApp`, and `alter`s its answer before passing it on. */
function exchange(
  oldApp: Hono = oldBoxApp(),
  alter: (answer: Response) => Promise<Response> = async (a) => a,
): Exchange {
  const ex: Exchange = {
    sent: [],
    answers: [],
    fetch: (async (url: string, init: RequestInit) => {
      ex.sent.push((JSON.parse(init.body as string) as { body: Record<string, unknown> }).body);
      const answer = await alter(await oldApp.request(url, init));
      ex.answers.push(await answer.clone().text());
      return answer;
    }) as typeof fetch,
  };
  return ex;
}

function appWith(over: Partial<OldBoxDataDownloadDeps> = {}): Hono {
  const app = new Hono();
  mountOldBoxDataDownloadApi(
    app,
    {
      db: suite.db,
      node: suite.node,
      ring,
      nodeId: main,
      modules: [mainSample],
      now: () => new Date(NOW),
      venueLocale: "es-ES",
      ...over,
    },
    log,
  );
  return app;
}

function download(app: Hono, cookie = adminCookie, nodeId = oldBox): Promise<Response> {
  return Promise.resolve(
    app.request(`https://main.test/management-api/servers/${nodeId}/old-box-data`, {
      method: "POST",
      headers: { cookie },
    }),
  );
}

async function downloads() {
  return suite.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.kind, "handover.old_box_data_downloaded"));
}

/** Refused with `code`, no file passed on and no download recorded. */
async function expectRefused(response: Response, code: string, status = 409) {
  expect(response.status).toBe(status);
  const answer = (await response.json()) as { error: { code: string } };
  expect(answer.error.code).toBe(code);
  expect(await downloads()).toEqual([]);
  return answer;
}

/** A re-signed copy of the old box's answer body, changed by `change`. */
function resigned(signer: () => string, change: (body: Record<string, unknown>) => void) {
  return async (answer: Response) => {
    const envelope = (await answer.json()) as { body: Record<string, unknown> };
    const body = { ...envelope.body };
    change(body);
    const signed = await signAsThisBox(
      { node: suite.node, ring, nodeId: signer() },
      "old-box-data",
      body as never,
    );
    return new Response(JSON.stringify(signed), { status: 200 });
  };
}

/** An emergency switch from the old box to this one, declaring the copy's latest change. */
async function emergencySwitch(lastChangeAtMs: number | null) {
  await withTransaction(suite.db, (tx) =>
    tx.insert(handoverActivations).values({
      operationId: randomUUID(),
      sourceNodeId: oldBox,
      destinationNodeId: main,
      scenario: "emergency",
      evidence: {
        purpose: "waitron.handover.declaration.v1",
        body: { lastCopy: { lastChangeAtMs } },
        signerNodeId: main,
        signature: "signature",
      },
      personId: adminId,
      activatedAt: "2026-11-21T10:00:00.000Z",
    }),
  );
}

describe("a node.manage holder with a fresh proof", () => {
  it("gets the old box's workbook byte for byte, as a download never cached or sniffed", async () => {
    const ex = exchange();
    const res = await download(appWith({ fetch: ex.fetch }));

    expect(res.status).toBe(200);
    const answer = JSON.parse(ex.answers[0]!) as {
      body: { madeOn: string; workbook: string };
    };
    expect(Buffer.from(await res.arrayBuffer())).toEqual(
      Buffer.from(answer.body.workbook, "base64"),
    );
    const expected = workbookDownloadHeaders(`waitron-old-main-box-${answer.body.madeOn}.xlsx`);
    for (const [name, value] of Object.entries(expected)) expect(res.headers.get(name)).toBe(value);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sends this box's summary, signed, to the old box's address", async () => {
    let asked = "";
    const ex = exchange();
    const fetch = ((url: string, init: RequestInit) => {
      asked = url;
      return ex.fetch(url, init);
    }) as typeof globalThis.fetch;
    expect((await download(appWith({ fetch }))).status).toBe(200);

    expect(asked).toBe(`${OLD_URL}/api/node/old-box-data`);
    expect(ex.sent[0]).toMatchObject({
      sourceNodeId: main,
      destinationNodeId: oldBox,
      sentAtMs: NOW,
      holdings: await readHoldings(suite.db, [mainSample]),
    });
    expect(ex.sent[0]).not.toHaveProperty("lastChangeAtMs");
  });

  it("sends the copy's latest change after an emergency switch", async () => {
    await emergencySwitch(COPY_AT);
    const ex = exchange();
    expect((await download(appWith({ fetch: ex.fetch }))).status).toBe(200);
    expect(ex.sent[0]).toHaveProperty("lastChangeAtMs", COPY_AT);
  });

  it.each([
    ["es-ES", "es"],
    ["en-GB", "en"],
    [null, "es"],
  ] as const)(
    "asks in the language of a person whose saved locale is %s: %s",
    async (locale, language) => {
      const { cookie } = await sessionFor("admin", locale);
      const ex = exchange();
      expect((await download(appWith({ fetch: ex.fetch }), cookie)).status).toBe(200);
      expect(ex.sent[0]).toHaveProperty("language", language);
    },
  );

  it("sends a fresh nonce on every request", async () => {
    const ex = exchange();
    const app = appWith({ fetch: ex.fetch });
    expect((await download(app)).status).toBe(200);
    expect((await download(app)).status).toBe(200);
    expect(ex.sent[0]!.nonce).not.toBe(ex.sent[1]!.nonce);
  });

  it("records one download naming the person, the old box and the tab counts", async () => {
    const ex = exchange();
    expect((await download(appWith({ fetch: ex.fetch }))).status).toBe(200);
    const counts = (JSON.parse(ex.answers[0]!) as { body: { counts: Record<string, number> } }).body
      .counts;

    const entries = await downloads();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      personId: adminId,
      subjectKind: "node",
      subjectId: oldBox,
      data: counts,
    });
    expect(counts.invoiceRows).toBe(1);
  });
});

describe("refusals", () => {
  it("someone without node.manage: authorization.not_permitted, the old box never asked", async () => {
    const ex = exchange();
    const { cookie } = await sessionFor("manager");
    await expectRefused(
      await download(appWith({ fetch: ex.fetch }), cookie),
      "authorization.not_permitted",
      403,
    );
    expect(ex.sent).toEqual([]);
  });

  it("a stale proof: management_session.proof_required", async () => {
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, adminCookie, false));
    const ex = exchange();
    await expectRefused(
      await download(appWith({ fetch: ex.fetch })),
      "management_session.proof_required",
      400,
    );
    expect(ex.sent).toEqual([]);
  });

  it("this box is not the serving primary: membership.not_primary", async () => {
    const other = await seedNode(suite.db);
    await holdChart({ primary: other });
    const ex = exchange();
    await expectRefused(await download(appWith({ fetch: ex.fetch })), "membership.not_primary");
    expect(ex.sent).toEqual([]);
  });

  it("an open handover naming the old box: handover.operation_in_progress", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      beginHandoverOperationTx(tx, {
        nodeId: main,
        operationId: randomUUID(),
        role: "destination",
        scenario: "controlled",
        sourceNodeId: oldBox,
        destinationNodeId: main,
        binding: {},
        fingerprint: "f",
        state: "copy_accepted",
        waitingReason: null,
      }),
    );
    const ex = exchange();
    await expectRefused(
      await download(appWith({ fetch: ex.fetch })),
      "handover.operation_in_progress",
    );
    expect(ex.sent).toEqual([]);
  });

  it.each([
    ["not replaced", async () => holdChart({ oldStanding: "serving-secondary" })],
    ["not listed", async () => {}],
    [
      "not the box whose key this box pinned",
      async () => {
        const mainKey = await readNodeIdentityKey(suite.node, ring, main);
        await pinMainBoxKey(suite.node, main, {
          nodeId: randomUUID(),
          publicKey: nodeSigningPublicKey(mainKey),
        });
      },
    ],
  ])("the box is %s: handover.old_box_data_unavailable", async (name, arrange) => {
    await arrange();
    const ex = exchange();
    const target = name === "not listed" ? randomUUID() : oldBox;
    await expectRefused(
      await download(appWith({ fetch: ex.fetch }), adminCookie, target),
      "handover.old_box_data_unavailable",
    );
    expect(ex.sent).toEqual([]);
  });

  it("a standing wipe order: handover.old_box_data_wipe_ordered, the old box never asked", async () => {
    await emergencySwitch(COPY_AT);
    await orderReset(
      { db: suite.db, node: suite.node, nodeId: main },
      { targetNodeId: oldBox, personId: adminId, acceptLoss: true },
    );
    const ex = exchange();
    await expectRefused(
      await download(appWith({ fetch: ex.fetch })),
      "handover.old_box_data_wipe_ordered",
    );
    expect(ex.sent).toEqual([]);
  });

  it("no address for the old box: handover.old_box_unreachable", async () => {
    await holdChart({ oldUrl: "" });
    const ex = exchange();
    await expectRefused(
      await download(appWith({ fetch: ex.fetch })),
      "handover.old_box_unreachable",
    );
    expect(ex.sent).toEqual([]);
  });

  it("a failure before connecting: handover.old_box_unreachable", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    await expectRefused(await download(appWith({ fetch })), "handover.old_box_unreachable");
  });

  const after = (reason: string, alter: (answer: Response) => Promise<Response>) => ({
    reason,
    alter,
  });
  it.each([
    after("status", async () => new Response("not found", { status: 404 })),
    after("signature", async (answer) => {
      const envelope = (await answer.json()) as { body: Record<string, unknown> };
      return new Response(
        JSON.stringify({ ...envelope, body: { ...envelope.body, madeOn: "2026-01-01" } }),
        { status: 200 },
      );
    }),
    after(
      "signer",
      resigned(
        () => main,
        () => {},
      ),
    ),
    after(
      "nonce",
      resigned(
        () => oldBox,
        (body) => {
          body.nonce = "another";
        },
      ),
    ),
    after(
      "workbook",
      resigned(
        () => oldBox,
        (body) => {
          body.workbook = "not base64!";
        },
      ),
    ),
  ])(
    "after connecting, $reason: handover.old_box_data_refused, the reason in the log only",
    async ({ reason, alter }) => {
      const ex = exchange(oldBoxApp(), alter);
      const answer = await expectRefused(
        await download(appWith({ fetch: ex.fetch })),
        "handover.old_box_data_refused",
      );
      expect(answer).toEqual({ error: { code: "handover.old_box_data_refused", params: {} } });
      const logged = lines.find((l) => l.event === "handover.old_box_data_refused");
      expect(String(logged?.fields?.logReason)).toMatch(new RegExp(`^${reason}`));
    },
  );

  it("the old box's own refusal: handover.old_box_data_refused", async () => {
    const ex = exchange(oldBoxApp({ resetOrdered: () => true }));
    await expectRefused(
      await download(appWith({ fetch: ex.fetch })),
      "handover.old_box_data_refused",
    );
    const logged = lines.find((l) => l.event === "handover.old_box_data_refused");
    expect(logged?.fields?.logReason).toBe("status_409:handover.old_box_data_query_refused:wiping");
  });

  it("a time-out once connected: handover.old_box_data_refused", async () => {
    const fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof globalThis.fetch;
    await expectRefused(
      await download(appWith({ fetch, timeoutMs: 50 })),
      "handover.old_box_data_refused",
    );
  });

  it("an answer over the cap: handover.old_box_data_too_large", async () => {
    let cap: number | undefined;
    const post: OldBoxDataDownloadDeps["post"] = async (_deps, _id, _url, _body, opts) => {
      cap = opts?.maxBytes;
      throw new AnswerTooLarge("too large");
    };
    await expectRefused(await download(appWith({ post })), "handover.old_box_data_too_large");
    expect(cap).toBe(64 * 1024 * 1024);
  });
});

it("holds no write transaction while the old box is asked: a second writer finishes first", async () => {
  const ex = exchange();
  // Outside the request's own context, so the write queue sees another writer.
  const outside = AsyncLocalStorage.snapshot();
  let second: "finished" | "blocked" | undefined;
  const fetch = (async (url: string, init: RequestInit) => {
    const write = outside(() =>
      withTransaction(suite.db, (tx) =>
        tx.run(sql`update persons set telephone = '600000000' where id = ${adminId}`),
      ),
    ).then(() => "finished" as const);
    second = await Promise.race([
      write,
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 2_000)),
    ]);
    return ex.fetch(url, init);
  }) as typeof globalThis.fetch;

  const res = await download(appWith({ fetch }));
  expect(second).toBe("finished");
  expect(res.status).toBe(200);
});
