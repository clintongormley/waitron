import { seedPersons } from "@waitron/identity/test/person-rows.js";
import * as handover from "@waitron/handover";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { openBackupQuery } from "@waitron/store";
import * as nodeDatabase from "@waitron/node-db";
import { dirname, join } from "node:path";
import { registerModulePermissions, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { requireManagementChangeFromOwnPage } from "./own-page.js";
import { eq, sql } from "drizzle-orm";
import * as loop from "./loop.js";
import * as database from "@waitron/db";
import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  openVenueDatabase,
  stampDeployment,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import { endorseKey, signDocumentBody, type CanonicalValue } from "@waitron/membership";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import type { WaitronModule } from "@waitron/module";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import {
  startReturnRecordsDuty,
  runReturnRecordsPass,
  formerMainForReturn,
  returnDigest,
  returnVenue,
} from "./return-records.js";
import { mountReturnRecordsApi } from "./return-records-api.js";
import { abandonReturn } from "./return-abandoned.js";
import { advanceHandover } from "./handover-store.js";
import { listServers, removeStandby } from "./membership-removal.js";
import { signAsThisBox } from "./handover-signing.js";
import { AppError } from "@waitron/shared";
import { caCertPath } from "./box-secrets.js";
import { mintBoxAuthority, startBoxServer } from "./testing/box-authority.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
let source: string;
let receiver: string;
let received: CanonicalValue[];
let accounted: boolean;
const modules: WaitronModule[] = [
  {
    name: "sample",
    version: "1.0.0",
    tier: "mandatory",
    handover: {
      summarise: async () => null,
      returnRecords: {
        read: async () => ["first", "second"],
        receive: async (_tx, _source, batch, _now, _accepted) => {
          received.push(batch);
          return accounted || (_accepted ?? []).includes(returnDigest(batch));
        },
        acceptPermission: "sample.accept",
        inspect: async (_tx, _source, batch) => [
          {
            saleId: String(batch),
            fingerprint: returnDigest(batch),
            eligible: true,
            outstanding: [batch],
            original: { invoice: String(batch) },
            incoming: batch,
            held: "held",
          },
        ],
      },
    },
  },
];

beforeEach(async () => {
  received = [];
  accounted = true;
  await seedVenue(suite.db, { name: "Return venue" });
  await stampDeployment(suite.db, "preproduction");
  source = await seedNode(suite.db);
  receiver = await seedNode(suite.db);
  for (const nodeId of [source, receiver])
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  const sourceKey = await readNodeIdentityKey(suite.node, ring, source);
  const receiverKey = await readNodeIdentityKey(suite.node, ring, receiver);
  await pinMainBoxKey(suite.node, receiver, {
    nodeId: source,
    publicKey: nodeSigningPublicKey(sourceKey),
  });
  const body = {
    term: 2,
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
});

function destination(
  requireWritable = () => {},
  handles: Pick<database.VenueDatabase, "node"> & { db: database.Database } = suite,
  log: Logger = () => {},
) {
  const app = new Hono();
  app.use(
    "*",
    requireManagementChangeFromOwnPage(
      async () => false,
      () => {},
    ),
  );
  mountReturnRecordsApi(
    app,
    {
      db: handles.db,
      node: handles.node,
      ring,
      nodeId: receiver,
      modules,
      requireWritable,
      wake: () => {},
    },
    log,
  );
  return app;
}
function send(fetch: typeof globalThis.fetch) {
  return runReturnRecordsPass({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules,
    fetch,
    stopped: () => false,
  });
}

it("returns all module batches through real signatures and confirms only the complete inventory", async () => {
  const app = destination();
  const answers: unknown[] = [];
  const result = await send(async (url, init) => {
    const response = await app.request(String(url), init);
    answers.push(await response.clone().json());
    return response;
  });
  expect(result).toBe("confirmed");
  expect(received).toEqual(["first", "second"]);
  expect(answers).toEqual([
    expect.objectContaining({
      body: expect.objectContaining({ accounted: true }),
    }),
    expect.objectContaining({ body: expect.objectContaining({ accounted: true }) }),
  ]);
});

it.each(["environment", "venue", "destination", "source", "signature", "payload"])(
  "refuses a return with wrong %s before invoking its module",
  async (field) => {
    const app = destination();
    let status = 0;
    const result = await send(async (url, init) => {
      const raw = JSON.parse(String(init?.body)) as {
        body: Record<string, CanonicalValue>;
        signature: string;
      };
      const venue = raw.body.venue as Record<string, CanonicalValue>;
      if (field === "signature") raw.signature = Buffer.alloc(64).toString("base64");
      else {
        if (field === "payload") delete raw.body.payload;
        if (field === "environment") venue.environment = "production";
        if (field === "venue") venue.taxId = "other-taxpayer";
        if (field === "destination") raw.body.destinationNodeId = source;
        if (field === "source") raw.body.sourceNodeId = receiver;
        const { signAsThisBox } = await import("./handover-signing.js");
        Object.assign(
          raw,
          await signAsThisBox({ node: suite.node, ring, nodeId: source }, "return-batch", raw.body),
        );
      }
      const response = await app.request(String(url), { ...init, body: JSON.stringify(raw) });
      status = response.status;
      return response;
    });
    expect(status).toBe(409);
    expect(result).toBe("needs-attention");
    expect(received).toEqual([]);
  },
);

it.each([
  "pinned source",
  "primary receiver",
  "revoked source",
  "evicted source",
  "changed chart",
  "read-only receiver",
])("refuses a trusted return for a %s before importing facts", async (field) => {
  const chart = (await database.readNodeMembership(suite.db))!;
  const receiverKey = await readNodeIdentityKey(suite.node, ring, receiver);
  const sourceKey = await readNodeIdentityKey(suite.node, ring, source);
  const app = destination(() => {
    if (field === "read-only receiver") throw new AppError("node.read_only", {});
  });
  const result = await send(async (url, init) => {
    const changed = {
      ...chart,
      body: {
        ...chart.body,
        nodes: chart.body.nodes.map((row) => ({ ...row })),
        revoked: [...(chart.body.revoked ?? [])],
      },
      endorsements: [...chart.endorsements],
    };
    if (field === "pinned source") {
      await pinMainBoxKey(suite.node, receiver, {
        nodeId: receiver,
        publicKey: nodeSigningPublicKey(receiverKey),
      });
      changed.endorsements.push(
        endorseKey(source, nodeSigningPublicKey(sourceKey), receiver, receiverKey),
      );
    }
    if (field === "primary receiver") changed.body.nodes[0]!.standing = "sell-only";
    if (field === "revoked source") changed.body.revoked = [source];
    if (field === "evicted source") changed.body.nodes[1]!.standing = "evicted";
    changed.signature = signDocumentBody(changed.body, receiverKey);
    if (field === "changed chart") {
      changed.body.term++;
      changed.signature = signDocumentBody(changed.body, receiverKey);
      const read = database.readNodeMembership;
      let reads = 0;
      const spy = vi.spyOn(database, "readNodeMembership").mockImplementation(async (db) => {
        if (++reads === 2) await database.writeNodeMembershipTx(db, changed);
        return read(db);
      });
      try {
        return await app.request(String(url), init);
      } finally {
        spy.mockRestore();
      }
    }
    await writeNodeMembership(suite.db, changed);
    return app.request(String(url), init);
  });
  expect(result).toBe("needs-attention");
  expect(received).toEqual([]);
});

it.each(["digest", "nonce"])(
  "refuses a validly signed receipt with the wrong %s",
  async (field) => {
    const app = destination();
    expect(
      await send(async (url, init) => {
        const answer = await app.request(String(url), init);
        const receipt = (await answer.json()) as { body: Record<string, CanonicalValue> };
        receipt.body[field] = "different";
        return Response.json(
          await signAsThisBox(
            { node: suite.node, ring, nodeId: receiver },
            "return-receipt",
            receipt.body,
          ),
        );
      }),
    ).toBe("needs-attention");
    expect(received).toEqual(["first"]);
  },
);

it("rejects a matching receipt signed by the source without contacting the main", async () => {
  expect(
    await send(async (_url, init) => {
      const { body } = JSON.parse(String(init?.body)) as { body: Record<string, CanonicalValue> };
      return Response.json(
        await signAsThisBox({ node: suite.node, ring, nodeId: source }, "return-receipt", {
          venue: await returnVenue({ db: suite.db }),
          sourceNodeId: source,
          destinationNodeId: receiver,
          inventory: body.inventory!,
          index: body.index!,
          nonce: body.nonce!,
          digest: returnDigest({ module: body.module!, payload: body.payload! }),
          accounted: true,
        }),
      );
    }),
  ).toBe("needs-attention");
});

it.each([
  "missing pin on a non-primary caller",
  "self pin",
  "other primary",
  "evicted source",
  "revoked source",
  "untrusted chart",
])("does not enable former-main correction with %s", async (field) => {
  const deps = { db: suite.db, node: suite.node, ring, nodeId: receiver };
  expect(await formerMainForReturn(deps)).toBe(source);
  if (field === "missing pin on a non-primary caller") {
    expect(await formerMainForReturn({ ...deps, nodeId: source })).toBeNull();
    return;
  }
  const chart = (await database.readNodeMembership(suite.db))!;
  const receiverKey = await readNodeIdentityKey(suite.node, ring, receiver);
  const changed = {
    ...chart,
    body: {
      ...chart.body,
      nodes: chart.body.nodes.map((row) => ({ ...row })),
      revoked: [...(chart.body.revoked ?? [])],
    },
  };
  if (field === "self pin")
    await pinMainBoxKey(suite.node, receiver, {
      nodeId: receiver,
      publicKey: nodeSigningPublicKey(receiverKey),
    });
  if (field === "other primary") {
    changed.body.nodes[0]!.standing = "sell-only";
    changed.body.nodes[1]!.standing = "serving-primary";
  }
  if (field === "evicted source") changed.body.nodes[1]!.standing = "evicted";
  if (field === "revoked source") changed.body.revoked = [source];
  changed.signature =
    field === "untrusted chart"
      ? Buffer.alloc(64).toString("base64")
      : signDocumentBody(changed.body, receiverKey);
  await writeNodeMembership(suite.db, changed);
  if (field === "untrusted chart")
    await expect(formerMainForReturn(deps)).rejects.toMatchObject({
      code: "membership.held_untrusted",
    });
  else expect(await formerMainForReturn(deps)).toBeNull();
});

it("waits after a lost final confirmation and safely re-enumerates on the next pass", async () => {
  const app = destination();
  let calls = 0;
  const first = await send(async (url, init) => {
    const response = await app.request(String(url), init);
    if (++calls === 2) throw new TypeError("connection lost after commit");
    return response;
  });
  expect(first).toBe("waiting");
  expect(await send(async (url, init) => app.request(String(url), init))).toBe("confirmed");
  expect(received).toEqual(["first", "second", "first", "second"]);
});

it("confirms each accounted batch even when the receiver restarts between batches", async () => {
  expect(await send(async (url, init) => destination().request(String(url), init))).toBe(
    "confirmed",
  );
  expect(received).toEqual(["first", "second"]);
});

it("shows a retryable clock refusal when the receiver cannot yet accept the record date", async () => {
  const seat = modules[0]!.handover!.returnRecords!;
  const receive = vi.spyOn(seat, "receive").mockRejectedValue(
    new AppError("fiscal.return_clock_ahead", {
      recordAt: "2026-07-20T17:20:01.000Z",
      clockAt: "2026-07-20T17:05:00.000Z",
    }),
  );
  try {
    const app = destination();
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("clock");
  } finally {
    receive.mockRestore();
  }
});

it.each([
  ["fiscal.return_clock_ahead", "clock"],
  ["fiscal.return_record_clash", "record-clash"],
] as const)(
  "retries unsigned %s and confirms once the main accepts the return",
  async (code, state) => {
    const app = destination();
    let paused!: () => void;
    let resume!: () => void;
    const waiting = new Promise<void>((resolve) => {
      paused = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const sleep = vi.spyOn(loop, "realSleep").mockImplementationOnce(async () => {
      paused();
      await release;
    });
    let refusing = true;
    let batchesSent = 0;
    const duty = startReturnRecordsDuty({
      db: suite.db,
      node: suite.node,
      ring,
      nodeId: source,
      modules,
      stateDir: join(tmpdir(), "waitron-return-no-state"),
      log: () => {},
      fetch: async (url, init) => {
        batchesSent++;
        return refusing
          ? Response.json({ error: { code } }, { status: 409 })
          : app.request(String(url), init);
      },
    });
    try {
      await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
      await waiting;
      expect(duty.state()).toBe(state);
      expect(batchesSent).toBe(1);
      refusing = false;
      resume();
      await vi.waitFor(() => expect(duty.state()).toBe("confirmed"));
      await duty.stop();
      expect(received).toEqual(["first", "second"]);
    } finally {
      resume();
      await duty.stop();
      sleep.mockRestore();
    }
  },
);

it("distinguishes a signed unaccounted batch from a request refusal", async () => {
  accounted = false;
  const app = destination();
  expect(await send(async (url, init) => app.request(String(url), init))).toBe("clash");
  expect(received).toEqual(["first"]);
});

it("waits for the active exchange to end before shutdown and starts no later batch", async () => {
  const app = destination();
  let begun!: () => void;
  let proceed!: () => void;
  const started = new Promise<void>((resolve) => {
    begun = resolve;
  });
  const release = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const events: string[] = [];
  const duty = startReturnRecordsDuty({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules,
    stateDir: join(tmpdir(), "waitron-return-no-state"),
    log: () => {},
    fetch: async (url, init) => {
      begun();
      await release;
      const response = await app.request(String(url), init);
      events.push("exchange ended");
      return response;
    },
  });
  await started;
  const stopping = duty.stop().then(() => {
    events.push("stopped");
  });
  proceed();
  await stopping;
  expect(events).toEqual(["exchange ended", "stopped"]);
  expect(received).toEqual(["first"]);
  expect(duty.state()).not.toBe("confirmed");
});

it("ends the duty after a signed clash without scheduling another receiver pass", async () => {
  accounted = false;
  const app = destination();
  const pause = vi.spyOn(loop, "realSleep");
  const duty = startReturnRecordsDuty({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules,
    stateDir: join(tmpdir(), "waitron-return-no-state"),
    log: () => {},
    fetch: async (url, init) => app.request(String(url), init),
  });
  try {
    await vi.waitFor(() => expect(duty.state()).toBe("clash"));
    await duty.stop();
    expect(received).toEqual(["first"]);
    expect(pause).not.toHaveBeenCalled();
  } finally {
    await duty.stop();
    pause.mockRestore();
  }
});

it("runs passNow() only after the duty's own pass in flight ends, so batch sends never overlap", async () => {
  const app = destination();
  let inFlight = 0;
  let overlapped = false;
  let begun!: () => void;
  let proceed!: () => void;
  const started = new Promise<void>((resolve) => {
    begun = resolve;
  });
  const release = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const duty = startReturnRecordsDuty({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules,
    stateDir: join(tmpdir(), "waitron-return-no-state"),
    log: () => {},
    fetch: async (url, init) => {
      inFlight++;
      if (inFlight > 1) overlapped = true;
      begun();
      await release;
      try {
        return await app.request(String(url), init);
      } finally {
        inFlight--;
      }
    },
  });
  try {
    await started;
    const extra = duty.passNow();
    // Long enough for an unqueued pass to reach its send while the first exchange is held.
    await new Promise((resolve) => setTimeout(resolve, 250));
    proceed();
    expect(await extra).toBe("confirmed");
    expect(overlapped).toBe(false);
    expect(received).toEqual(["first", "second", "first", "second"]);
  } finally {
    proceed();
    await duty.stop();
  }
});

it("runs one pass on passNow() after the duty has confirmed and stopped", async () => {
  const app = destination();
  const duty = startReturnRecordsDuty({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules,
    stateDir: join(tmpdir(), "waitron-return-no-state"),
    log: () => {},
    fetch: async (url, init) => app.request(String(url), init),
  });
  try {
    await vi.waitFor(() => expect(duty.state()).toBe("confirmed"));
    received = [];
    expect(await duty.passNow()).toBe("confirmed");
    expect(received).toEqual(["first", "second"]);
    expect(duty.state()).toBe("confirmed");
  } finally {
    await duty.stop();
  }
});

async function acceptanceSession(role: "admin" | "staff" = "admin", fresh = true) {
  registerModulePermissions([{ permission: "sample.accept", defaultHolders: [] }]);
  return database.withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, { displayName: `Operator ${role}`, role });
    const session = await startManagementSession(tx, { method: "password", personId: person!.id });
    await setFreshManagementSignIn(tx, session.token, fresh);
    return { cookie: `${MANAGEMENT_COOKIE}=${session.token}`, personId: person!.id };
  });
}

it("accepts two signed clashing batches separately across restarted duties and replays the original decision", async () => {
  accounted = false;
  const session = await acceptanceSession();
  const app = destination();
  expect((await app.request("/management-api/return-clashes")).status).toBe(401);
  expect(await send(async (url, init) => app.request(String(url), init))).toBe("clash");
  let firstDecision: unknown;
  const clashIds: string[] = [];
  for (const index of [0, 1]) {
    const restarted = destination();
    const listing = await restarted.request("/management-api/return-clashes", {
      headers: { cookie: session.cookie },
    });
    expect(listing.status).toBe(200);
    const { clashes } = (await listing.json()) as {
      clashes: { clashId: string; index: number; count: number; accepted: boolean }[];
    };
    const clash = clashes.find((row) => !row.accepted)!;
    expect(clash).toMatchObject({ index, count: 2 });
    clashIds.push(clash.clashId);
    const request = {
      method: "POST",
      headers: { cookie: session.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        actionKey: `accept-${index}`,
        reason: "Keep the main's payment facts",
      }),
    };
    const path = `/management-api/return-clashes/${clash.clashId}/accept`;
    const response = await restarted.request(path, request);
    expect(response.status, await response.clone().text()).toBe(200);
    const decision = await response.json();
    const directory = dirname(suite.node.all<{ file: string }>(sql`pragma database_list`)[0]!.file);
    const reopened = await openVenueDatabase(directory, { exclusive: false });
    try {
      expect(
        await (
          await destination(() => {}, { db: reopened.venue, node: reopened.node }).request(
            path,
            request,
          )
        ).json(),
      ).toEqual(decision);
    } finally {
      await reopened.close();
    }
    if (index === 0) firstDecision = decision;
    const mismatch = await restarted.request(path, {
      ...request,
      body: JSON.stringify({ actionKey: `accept-${index}`, reason: "Changed reason" }),
    });
    expect(mismatch.status).toBe(409);
    expect(await send(async (url, init) => destination().request(String(url), init))).toBe(
      index === 0 ? "clash" : "confirmed",
    );
  }
  expect(firstDecision).toMatchObject({
    decision: {
      purpose: "waitron.handover.return-clash-acceptance.v1",
      body: { personId: session.personId },
    },
  });
  expect(
    suite.node.all<{ n: number }>(
      sql`select count(*) n from node_handover_events where kind = 'return-clash-evidence'`,
    ),
  ).toEqual([{ n: 2 }]);
  expect(
    suite.node.all<{ n: number }>(
      sql`select count(*) n from node_handover_events where kind = 'return-clash-acceptance'`,
    ),
  ).toEqual([{ n: 2 }]);
  expect(
    suite.db
      .all<{ person_id: string; data: string }>(
        sql`select person_id, data from activity_log where kind = 'handover.return_clash_accepted'`,
      )
      .map((row) => ({ personId: row.person_id, data: JSON.parse(row.data) as unknown })),
  ).toEqual(
    clashIds.map((clashId) => ({
      personId: session.personId,
      data: { clashId, sourceNodeId: source, module: "sample" },
    })),
  );

  const directory = await mkdtemp(join(tmpdir(), "a1342-activity-copy-"));
  try {
    const file = join(directory, "venue.db");
    await suite.db.archiveTo(file);
    const copy = await openBackupQuery(file);
    try {
      const archived = [];
      for await (const row of copy.query.rows(
        "select person_id, data from activity_log where kind = 'handover.return_clash_accepted' order by rowid",
      ))
        archived.push({ personId: row.person_id, data: JSON.parse(String(row.data)) as unknown });
      expect(archived).toEqual(
        clashIds.map((clashId) => ({
          personId: session.personId,
          data: { clashId, sourceNodeId: source, module: "sample" },
        })),
      );
    } finally {
      await copy.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  for (const kind of ["return-clash-evidence", "return-clash-acceptance"]) {
    // The sender remembers its confirmed return; forgetting it makes the next pass resend.
    await suite.node
      .delete(nodeDatabase.nodeHandoverEvents)
      .where(eq(nodeDatabase.nodeHandoverEvents.kind, "return_confirmed"));
    const [event] = await suite.node
      .select()
      .from(nodeDatabase.nodeHandoverEvents)
      .where(eq(nodeDatabase.nodeHandoverEvents.kind, kind));
    const corrupt = JSON.parse(event!.envelope!) as Record<string, unknown>;
    corrupt.signature = Buffer.alloc(64).toString("base64");
    await suite.node
      .update(nodeDatabase.nodeHandoverEvents)
      .set({ envelope: JSON.stringify(corrupt) })
      .where(eq(nodeDatabase.nodeHandoverEvents.eventId, event!.eventId));
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("needs-attention");
    await suite.node
      .update(nodeDatabase.nodeHandoverEvents)
      .set({ envelope: event!.envelope })
      .where(eq(nodeDatabase.nodeHandoverEvents.eventId, event!.eventId));
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("confirmed");
  }
});

it.each(["permission", "fresh sign-in", "own page", "writable primary"])(
  "wires the acceptance route's %s gate before a clash lookup",
  async (gate) => {
    const session = await acceptanceSession(
      gate === "permission" ? "staff" : "admin",
      gate !== "fresh sign-in",
    );
    const response = await destination(() => {
      if (gate === "writable primary") throw new AppError("node.read_only", {});
    }).request("/management-api/return-clashes/not-found/accept", {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        ...(gate === "own page" ? { origin: "https://foreign.test" } : {}),
      },
      body: JSON.stringify({ actionKey: "gate", reason: "Keep facts" }),
    });
    const expected = {
      permission: "authorization.not_permitted",
      "fresh sign-in": "management_session.proof_required",
      "own page": "management.origin_refused",
      "writable primary": "node.read_only",
    }[gate];
    expect(response.status).toBe(
      gate === "permission" || gate === "own page" ? 403 : gate === "fresh sign-in" ? 401 : 409,
    );
    expect(await response.json()).toMatchObject({ error: { code: expected } });
  },
);

it("resends after evidence persistence fails and retries a failed decision append without false confirmation", async () => {
  accounted = false;
  const app = destination();
  const append = vi.spyOn(nodeDatabase, "appendHandoverEventTx");
  try {
    append.mockRejectedValueOnce(new Error("evidence disk failure"));
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("needs-attention");
    expect(suite.node.all<{ n: number }>(sql`select count(*) n from node_handover_events`)).toEqual(
      [{ n: 0 }],
    );
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("clash");
    const session = await acceptanceSession();
    const { clashes } = (await (
      await app.request("/management-api/return-clashes", { headers: { cookie: session.cookie } })
    ).json()) as { clashes: { clashId: string }[] };
    const path = `/management-api/return-clashes/${clashes[0]!.clashId}/accept`;
    const request = {
      method: "POST",
      headers: { cookie: session.cookie, "content-type": "application/json" },
      body: JSON.stringify({ actionKey: "retry-disk", reason: "Keep held facts" }),
    };
    append.mockRejectedValueOnce(new Error("decision disk failure"));
    expect((await app.request(path, request)).status).toBe(500);
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("clash");
    expect((await app.request(path, request)).status).toBe(200);
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("clash");
    expect(
      suite.node.all<{ n: number }>(
        sql`select count(*) n from node_handover_events where kind = 'return-clash-acceptance'`,
      ),
    ).toEqual([{ n: 1 }]);
    expect(
      suite.db.all<{ n: number }>(
        sql`select count(*) n from activity_log where kind = 'handover.return_clash_accepted'`,
      ),
    ).toEqual([{ n: 1 }]);
  } finally {
    append.mockRestore();
  }
});

it("lists current clashes after an old source leaves the chart and refuses an unprivileged reader", async () => {
  accounted = false;
  const logs: string[] = [];
  const app = destination(
    () => {},
    suite,
    (_level, event) => {
      logs.push(event);
    },
  );
  expect(await send(async (url, init) => app.request(String(url), init))).toBe("clash");
  const admin = await acceptanceSession();
  const staff = await acceptanceSession("staff");
  const refused = await app.request("/management-api/return-clashes", {
    headers: { cookie: staff.cookie },
  });
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  const inspect = vi
    .spyOn(modules[0]!.handover!.returnRecords!, "inspect")
    .mockRejectedValueOnce(new Error("read failure"));
  try {
    expect(
      (await app.request("/management-api/return-clashes", { headers: { cookie: admin.cookie } }))
        .status,
    ).toBe(500);
  } finally {
    inspect.mockRestore();
  }
  const chart = (await database.readNodeMembership(suite.db))!;
  const body = { ...chart.body, nodes: chart.body.nodes.filter((row) => row.nodeId !== source) };
  await writeNodeMembership(suite.db, {
    ...chart,
    body,
    signature: signDocumentBody(body, await readNodeIdentityKey(suite.node, ring, receiver)),
  });
  const listed = await app.request("/management-api/return-clashes", {
    headers: { cookie: admin.cookie },
  });
  expect(listed.status, await listed.clone().text()).toBe(200);
  expect(await listed.json()).toEqual({ clashes: [], batches: [] });
  expect(logs).toContain("return-clash.evidence_unreadable");
});

it("stores a signed batch once and accounts separately for two clashes inside it", async () => {
  const seat = modules[0]!.handover!.returnRecords!;
  let heldVersion = 0;
  const verify = vi.spyOn(handover, "verifyEnvelope");
  const inspect = vi.spyOn(seat, "inspect").mockImplementation(async (_tx, _source, batch) =>
    ["A", "B"].map((saleId) => ({
      saleId,
      fingerprint: returnDigest([batch, saleId, heldVersion]),
      eligible: true,
      outstanding: [saleId],
      original: saleId,
      incoming: batch,
      held: "held",
    })),
  );
  const receive = vi
    .spyOn(seat, "receive")
    .mockImplementation(async (_tx, _source, batch, _now, accepted = []) =>
      ["A", "B"].every((saleId) => accepted.includes(returnDigest([batch, saleId, heldVersion]))),
    );
  try {
    const app = destination();
    const session = await acceptanceSession();
    const sending = () => send(async (url, init) => app.request(String(url), init));
    expect(await sending()).toBe("clash");
    const list = async () =>
      (
        (await (
          await app.request("/management-api/return-clashes", {
            headers: { cookie: session.cookie },
          })
        ).json()) as { clashes: { clashId: string; accepted: boolean; eligible: boolean }[] }
      ).clashes;
    inspect.mockClear();
    verify.mockClear();
    const initial = await list();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(initial).toHaveLength(2);
    expect(
      suite.node.all<{ n: number }>(
        sql`select count(*) n from node_handover_events where kind = 'return-clash-evidence'`,
      ),
    ).toEqual([{ n: 1 }]);
    for (const [index, clash] of initial.entries()) {
      const response = await app.request(`/management-api/return-clashes/${clash.clashId}/accept`, {
        method: "POST",
        headers: { cookie: session.cookie, "content-type": "application/json" },
        body: JSON.stringify({ actionKey: `group-${index}`, reason: "Keep held facts" }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await sending()).toBe("clash");
      const listed = await list();
      expect(listed.filter((row) => row.accepted)).toHaveLength(index + 1);
      if (index === 0) expect(listed).toHaveLength(2);
      else expect(listed).toHaveLength(4);
    }
    heldVersion++;
    expect(await sending()).toBe("clash");
    const changed = await list();
    expect(changed.filter((row) => row.eligible && !row.accepted)).toHaveLength(2);
    expect(
      suite.node.all<{ n: number }>(
        sql`select count(*) n from node_handover_events where kind = 'return-clash-evidence' and envelope is not null`,
      ),
    ).toEqual([{ n: 2 }]);
  } finally {
    inspect.mockRestore();
    receive.mockRestore();
    verify.mockRestore();
  }
});

it("commits received venue facts before answering a record-clash refusal", async () => {
  const receive = vi
    .spyOn(modules[0]!.handover!.returnRecords!, "receive")
    .mockImplementation(async (tx) => {
      await tx.execute(
        sql`update nodes set name = 'Received before record clash' where id = ${receiver}`,
      );
      return { refusal: "fiscal.return_record_clash" };
    });
  const inspect = vi.spyOn(modules[0]!.handover!.returnRecords!, "inspect");
  try {
    const app = destination();
    let status = 0;
    let refusal: unknown;
    await send(async (url, init) => {
      const response = await app.request(String(url), init);
      status = response.status;
      refusal = await response.clone().json();
      return response;
    });
    expect(status).toBe(409);
    expect(refusal).toMatchObject({ error: { code: "fiscal.return_record_clash" } });
    expect(suite.db.all(sql`select name from nodes where id = ${receiver}`)).toEqual([
      { name: "Received before record clash" },
    ]);
    expect(inspect).not.toHaveBeenCalled();
    expect(
      suite.node.all(sql`select * from node_handover_events where kind = 'return-clash-evidence'`),
    ).toEqual([]);
  } finally {
    receive.mockRestore();
    inspect.mockRestore();
  }
});

async function completionBinding(
  options: {
    operation?: boolean;
    activation?: boolean;
    scenario?: "controlled" | "emergency";
    source?: string;
    state?: nodeDatabase.HandoverOperation["state"];
  } = {},
) {
  const operationId = "receiver-emergency";
  if (options.operation !== false)
    await database.withNodeTransaction(suite.node, (tx) =>
      nodeDatabase.beginHandoverOperationTx(tx, {
        nodeId: receiver,
        operationId,
        role: "destination",
        scenario: options.scenario ?? "emergency",
        sourceNodeId: source,
        destinationNodeId: receiver,
        binding: {},
        fingerprint: "receiver",
        state: options.state ?? "activated",
        waitingReason: null,
      }),
    );
  if (options.activation !== false)
    await suite.db.insert(database.handoverActivations).values({
      operationId,
      scenario: options.scenario ?? "emergency",
      sourceNodeId: options.source ?? source,
      destinationNodeId: receiver,
      evidence: {
        purpose: "waitron.handover.declaration.v1",
        body: {},
        signerNodeId: receiver,
        signature: "signature",
      },
      personId: "person",
      activatedAt: "2026-11-12T10:00:00.000Z",
    });
}

it("records accounted batches against its open emergency takeover and keeps replay rows unchanged", async () => {
  await completionBinding();
  const app = destination();
  accounted = false;
  expect(await send(async (url, init) => app.request(String(url), init))).toBe("clash");
  expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual([]);
  accounted = true;
  for (let attempt = 0; attempt < 2; attempt++)
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("confirmed");
  expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual(
    [0, 1].map((index) => ({
      operationId: "receiver-emergency",
      inventory: returnDigest(
        ["first", "second"].map((payload) => returnDigest({ module: "sample", payload })),
      ),
      batchIndex: index,
      batchCount: 2,
      batchDigest: returnDigest({ module: "sample", payload: ["first", "second"][index]! }),
    })),
  );
});

const batchRows = (operationId: string) =>
  [0, 1].map((index) => ({
    operationId,
    inventory: returnDigest(
      ["first", "second"].map((payload) => returnDigest({ module: "sample", payload })),
    ),
    batchIndex: index,
    batchCount: 2,
    batchDigest: returnDigest({ module: "sample", payload: ["first", "second"][index]! }),
  }));

it.each(["no activation", "other source"])(
  "accepts without completion when binding is %s",
  async (kind) => {
    await completionBinding({
      activation: kind !== "no activation",
      source: kind === "other source" ? receiver : source,
    });
    const app = destination();
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("confirmed");
    expect(received).toEqual(["first", "second"]);
    expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual([]);
  },
);

async function pastActivation(
  operationId: string,
  activatedAt: string,
  ends: { source?: string; destination?: string } = {},
) {
  await suite.db.insert(database.handoverActivations).values({
    operationId,
    scenario: "emergency",
    sourceNodeId: ends.source ?? source,
    destinationNodeId: ends.destination ?? receiver,
    evidence: {
      purpose: "waitron.handover.declaration.v1",
      body: {},
      signerNodeId: receiver,
      signature: "signature",
    },
    personId: "person",
    activatedAt,
  });
}

it("records a return with no open takeover against this box's latest activation from that box", async () => {
  const third = await seedNode(suite.db);
  await pastActivation("b-older", "2026-11-10T10:00:00.000Z");
  await pastActivation("a-latest", "2026-11-11T10:00:00.000Z");
  await pastActivation("c-other-destination", "2026-11-12T10:00:00.000Z", {
    destination: third,
  });
  await pastActivation("d-other-source", "2026-11-12T10:00:00.000Z", { source: third });
  const app = destination();
  expect(await send(async (url, init) => app.request(String(url), init))).toBe("confirmed");
  expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual(
    batchRows("a-latest"),
  );
});

it.each(["activated", "emergency_declared"] as const)(
  "records a return against a past activation and leaves an open takeover from another box in %s alone",
  async (state) => {
    const third = await seedNode(suite.db);
    await database.withNodeTransaction(suite.node, (tx) =>
      nodeDatabase.beginHandoverOperationTx(tx, {
        nodeId: receiver,
        operationId: "receiver-from-third",
        role: "destination",
        scenario: "emergency",
        sourceNodeId: third,
        destinationNodeId: receiver,
        binding: {},
        fingerprint: "receiver",
        state,
        waitingReason: null,
      }),
    );
    await pastActivation("receiver-from-third", "2026-11-12T10:00:00.000Z", { source: third });
    await pastActivation("receiver-earlier", "2026-11-10T10:00:00.000Z");
    const app = destination();
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("confirmed");
    expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual(
      batchRows("receiver-earlier"),
    );
    expect(
      (await nodeDatabase.readHandoverOperation(suite.node, receiver, "receiver-from-third"))
        ?.state,
    ).toBe(state);
  },
);

const takeoverState = async () =>
  (await nodeDatabase.readHandoverOperation(suite.node, receiver, "receiver-emergency"))?.state;

function sendWatchingState(app: Hono, states: unknown[]) {
  return send(async (url, init) => {
    const response = await app.request(String(url), init);
    states.push(await takeoverState());
    return response;
  });
}

it.each(["emergency", "controlled"] as const)(
  "steps its open %s takeover to return_pending at the first batch and closes it once every batch is accounted",
  async (scenario) => {
    await completionBinding({ scenario });
    const app = destination();
    const states: unknown[] = [];
    expect(await sendWatchingState(app, states)).toBe("confirmed");
    expect(states).toEqual(["return_pending", "return_complete"]);
    expect(await nodeDatabase.readOpenHandoverOperation(suite.node, receiver)).toBeNull();
    expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual(
      [0, 1].map((index) => ({
        operationId: "receiver-emergency",
        inventory: returnDigest(
          ["first", "second"].map((payload) => returnDigest({ module: "sample", payload })),
        ),
        batchIndex: index,
        batchCount: 2,
        batchDigest: returnDigest({ module: "sample", payload: ["first", "second"][index]! }),
      })),
    );
  },
);

it("closes its open takeover on a return of one batch holding no records", async () => {
  await completionBinding();
  const read = vi
    .spyOn(modules[0]!.handover!.returnRecords!, "read")
    .mockResolvedValue([{ records: [] }]);
  try {
    const app = destination();
    const states: unknown[] = [];
    expect(await sendWatchingState(app, states)).toBe("confirmed");
    expect(states).toEqual(["return_complete"]);
    expect(received).toEqual([{ records: [] }]);
  } finally {
    read.mockRestore();
  }
});

it("moves its takeover only to return_pending while a return is unaccounted", async () => {
  await completionBinding();
  accounted = false;
  const app = destination();
  const states: unknown[] = [];
  expect(await sendWatchingState(app, states)).toBe("clash");
  expect(states).toEqual(["return_pending"]);
  expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual([]);
});

it.each(["no operation", "no activation", "other source"])(
  "leaves the takeover where it was when the binding is %s",
  async (kind) => {
    await completionBinding({
      operation: kind !== "no operation",
      activation: kind !== "no activation",
      source: kind === "other source" ? receiver : source,
    });
    const app = destination();
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("confirmed");
    expect(await takeoverState()).toBe(kind === "no operation" ? undefined : "activated");
  },
);

it("takes in a batch but sends no receipt while its takeover is before activated, and the resend closes it", async () => {
  await completionBinding({ state: "emergency_declared" });
  const app = destination();
  const answers: { status: number; body: unknown }[] = [];
  expect(
    await send(async (url, init) => {
      const response = await app.request(String(url), init);
      answers.push({ status: response.status, body: await response.clone().json() });
      return response;
    }),
  ).toBe("waiting");
  expect(answers).toEqual([
    {
      status: 409,
      body: { error: { code: "handover.return_refused", params: { reason: "activating" } } },
    },
  ]);
  expect(received).toEqual(["first"]);
  expect(await takeoverState()).toBe("emergency_declared");

  await advanceHandover(
    { node: suite.node, nodeId: receiver },
    "receiver-emergency",
    "activated",
    {},
  );
  const states: unknown[] = [];
  expect(await sendWatchingState(app, states)).toBe("confirmed");
  expect(states).toEqual(["return_pending", "return_complete"]);
  expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual(
    batchRows("receiver-emergency"),
  );
});

it("sends no receipt when closing the takeover fails, and the resend closes it", async () => {
  await completionBinding();
  await suite.node.execute(
    sql`create trigger refuse_return_complete before update on node_handover_operations when new.state = 'return_complete' begin select raise(abort, 'test node write failed'); end`,
  );
  const app = destination();
  const statuses: number[] = [];
  try {
    expect(
      await send(async (url, init) => {
        const response = await app.request(String(url), init);
        statuses.push(response.status);
        return response;
      }),
    ).toBe("needs-attention");
    expect(statuses).toEqual([200, 500]);
    expect(await takeoverState()).toBe("return_pending");
    expect(await suite.db.select().from(database.handoverReturnBatches)).toHaveLength(2);
  } finally {
    await suite.node.execute(sql`drop trigger refuse_return_complete`);
  }
  const states: unknown[] = [];
  expect(await sendWatchingState(app, states)).toBe("confirmed");
  expect(states).toEqual(["return_complete", "return_complete"]);
  expect(await nodeDatabase.readOpenHandoverOperation(suite.node, receiver)).toBeNull();
});

it.each(["false", "refused"])("records no completion fact for a %s batch", async (outcome) => {
  await completionBinding();
  const receive = vi
    .spyOn(modules[0]!.handover!.returnRecords!, "receive")
    .mockResolvedValue(outcome === "false" ? false : { refusal: "fiscal.return_record_clash" });
  try {
    const app = destination();
    expect(await send(async (url, init) => app.request(String(url), init))).toBe(
      outcome === "false" ? "clash" : "record-clash",
    );
    expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual([]);
  } finally {
    receive.mockRestore();
  }
});

it("rolls back the received facts when recording the batch fails", async () => {
  await completionBinding();
  const before = await suite.db
    .select({ name: database.nodes.name })
    .from(database.nodes)
    .where(eq(database.nodes.id, receiver));
  const receive = vi
    .spyOn(modules[0]!.handover!.returnRecords!, "receive")
    .mockImplementation(async (tx) => {
      await tx
        .update(database.nodes)
        .set({ name: "Uncommitted receipt" })
        .where(eq(database.nodes.id, receiver));
      return true;
    });
  await suite.db.execute(
    sql`create trigger fail_return_fact before insert on handover_return_batches begin select raise(abort, 'test receipt write failed'); end`,
  );
  try {
    const app = destination();
    expect(await send(async (url, init) => app.request(String(url), init))).toBe("needs-attention");
    expect(
      await suite.db
        .select({ name: database.nodes.name })
        .from(database.nodes)
        .where(eq(database.nodes.id, receiver)),
    ).toEqual(before);
    expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual([]);
  } finally {
    await suite.db.execute(sql`drop trigger fail_return_fact`);
    receive.mockRestore();
  }
});

async function receiverOverTls(held: "venue authority" | "another authority" | "no authority") {
  const authority = await mintBoxAuthority();
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-return-tls-"));
  if (held !== "no authority") {
    await mkdir(dirname(caCertPath(stateDir)), { recursive: true });
    await writeFile(
      caCertPath(stateDir),
      held === "venue authority" ? authority.caPem : (await mintBoxAuthority()).caPem,
    );
  }
  const app = destination();
  const server = await startBoxServer(authority, async (req) => {
    const response = await app.request(req.path, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body: req.body,
    });
    return { status: response.status, body: await response.text() };
  });
  const chart = (await database.readNodeMembership(suite.db))!;
  const receiverKey = await readNodeIdentityKey(suite.node, ring, receiver);
  const body = {
    ...chart.body,
    nodes: chart.body.nodes.map((row) =>
      row.nodeId === receiver ? { ...row, contactUrl: server.url } : row,
    ),
  };
  await writeNodeMembership(suite.db, {
    ...chart,
    body,
    signature: signDocumentBody(body, receiverKey),
  });
  const lookups: string[] = [];
  const logs: { event: string; fields: unknown }[] = [];
  const pass = () =>
    runReturnRecordsPass({
      db: suite.db,
      node: suite.node,
      ring,
      nodeId: source,
      modules,
      stateDir,
      lookup: async (hostname) => {
        lookups.push(hostname);
        return { addresses: ["127.0.0.1"], remembered: false };
      },
      log: (_level, event, fields) => logs.push({ event, fields }),
      stopped: () => false,
    });
  const close = async () => {
    await server.close();
    await rm(stateDir, { recursive: true, force: true });
  };
  return { server, pass, lookups, logs, close };
}

it("returns the records to the main box over the box transport under the venue authority", async () => {
  const receiving = await receiverOverTls("venue authority");
  try {
    expect(await receiving.pass()).toBe("confirmed");
    expect(received).toEqual(["first", "second"]);
    expect(receiving.server.requests.map((req) => req.path)).toEqual([
      "/api/node/return-records",
      "/api/node/return-records",
    ]);
    expect(receiving.lookups).toContain("localhost");
    expect(receiving.logs).toEqual([]);
  } finally {
    await receiving.close();
  }
});

it("waits and logs the certificate refusal when this box holds no venue authority", async () => {
  const receiving = await receiverOverTls("no authority");
  try {
    expect(await receiving.pass()).toBe("waiting");
    expect(receiving.server.requests).toEqual([]);
    expect(received).toEqual([]);
    expect(receiving.logs).toEqual([
      {
        event: "return-records.unreachable",
        fields: { errorClass: "PeerCertificateRefused", errno: null },
      },
    ]);
  } finally {
    await receiving.close();
  }
});

it("logs the errno under a certificate refusal from a main box the held authority did not sign", async () => {
  const receiving = await receiverOverTls("another authority");
  try {
    expect(await receiving.pass()).toBe("waiting");
    expect(received).toEqual([]);
    expect(receiving.logs).toEqual([
      {
        event: "return-records.unreachable",
        fields: { errorClass: "PeerCertificateRefused", errno: expect.stringMatching(/CERT/) },
      },
    ]);
  } finally {
    await receiving.close();
  }
});

it("names a timed-out send by its error name", async () => {
  const logs: unknown[] = [];
  const result = await runReturnRecordsPass({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules,
    fetch: () =>
      new Promise<Response>((_resolve, reject) => {
        const signal = AbortSignal.timeout(1);
        signal.addEventListener("abort", () => reject(signal.reason as Error));
      }),
    log: (_level, event, fields) => logs.push({ event, fields }),
    stopped: () => false,
  });
  expect(result).toBe("waiting");
  expect(logs).toEqual([
    {
      event: "return-records.unreachable",
      fields: { errorClass: "TimeoutError", errno: null },
    },
  ]);
});

it.each([
  [200, "not json"],
  [200, "null"],
  [409, "not json"],
  [409, "null"],
])(
  "needs attention, and logs no outage, when a reachable main box answers %i with %j",
  async (status, text) => {
    const logs: unknown[] = [];
    const result = await runReturnRecordsPass({
      db: suite.db,
      node: suite.node,
      ring,
      nodeId: source,
      modules,
      fetch: async () => new Response(text, { status }),
      log: (_level, event, fields) => logs.push({ event, fields }),
      stopped: () => false,
    });
    expect(result).toBe("needs-attention");
    expect(logs).toEqual([]);
  },
);

it("logs an unreachable main box once per change of cause across the duty's passes", async () => {
  const sleep = vi.spyOn(loop, "realSleep").mockResolvedValue(undefined);
  const app = destination();
  const failures = ["ECONNREFUSED", "ECONNREFUSED", "ETIMEDOUT"];
  const logs: { event: string; fields: unknown }[] = [];
  const duty = startReturnRecordsDuty({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules,
    stateDir: join(tmpdir(), "waitron-return-no-state"),
    log: (_level, event, fields) => logs.push({ event, fields }),
    fetch: async (url, init) => {
      const code = failures.shift();
      if (code !== undefined) throw Object.assign(new Error("unreachable"), { code });
      return app.request(String(url), init);
    },
  });
  try {
    await vi.waitFor(() => expect(duty.state()).toBe("confirmed"));
    expect(logs).toEqual([
      {
        event: "return-records.unreachable",
        fields: { errorClass: "Error", errno: "ECONNREFUSED" },
      },
      {
        event: "return-records.unreachable",
        fields: { errorClass: "Error", errno: "ETIMEDOUT" },
      },
    ]);
  } finally {
    await duty.stop();
    sleep.mockRestore();
  }
});

const bindingRefusal = () =>
  Response.json(
    { error: { code: "handover.return_refused", params: { reason: "binding" } } },
    {
      status: 409,
    },
  );

const expectedInventory = () =>
  returnDigest(["first", "second"].map((payload) => returnDigest({ module: "sample", payload })));

it("remembers a confirmed return, so a later duty still sends and answers confirmed when refused", async () => {
  const app = destination();
  expect(await send(async (url, init) => app.request(String(url), init))).toBe("confirmed");
  const events = await suite.node
    .select()
    .from(nodeDatabase.nodeHandoverEvents)
    .where(eq(nodeDatabase.nodeHandoverEvents.kind, "return_confirmed"));
  expect(events).toEqual([
    expect.objectContaining({
      nodeId: source,
      operationId: null,
      detail: { destinationNodeId: receiver, inventory: expectedInventory() },
      envelope: expect.stringContaining('"waitron.handover.return-receipt.v1"'),
    }),
  ]);
  received = [];
  let calls = 0;
  const sleep = vi.spyOn(loop, "realSleep").mockResolvedValue(undefined);
  const duty = startReturnRecordsDuty({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules,
    stateDir: join(tmpdir(), "waitron-return-no-state"),
    log: () => {},
    fetch: async () => {
      calls++;
      return bindingRefusal();
    },
  });
  try {
    await vi.waitFor(() => expect(duty.state()).toBe("confirmed"));
    await duty.stop();
    // One refused send, and no second turn once confirmed.
    expect(calls).toBe(1);
    expect(received).toEqual([]);
  } finally {
    await duty.stop();
    sleep.mockRestore();
  }
});

it("resends to a main box that has its records again, and holds one confirmation for one inventory", async () => {
  const app = destination();
  const through = async (url: string | URL | Request, init?: RequestInit) =>
    app.request(String(url), init);
  expect(await send(through)).toBe("confirmed");
  received = [];
  expect(await send(through)).toBe("confirmed");
  expect(received).toEqual(["first", "second"]);
  expect(
    await nodeDatabase.readHandoverEvents(suite.node, source, null, "return_confirmed"),
  ).toHaveLength(1);
});

it("answers from the confirmation of the inventory it would send now, not the first one it held", async () => {
  let payloads = ["first", "second"];
  const changing: WaitronModule[] = [
    {
      ...modules[0]!,
      handover: {
        ...modules[0]!.handover!,
        returnRecords: { ...modules[0]!.handover!.returnRecords!, read: async () => payloads },
      },
    },
  ];
  const pass = (fetch: typeof globalThis.fetch) =>
    runReturnRecordsPass({
      db: suite.db,
      node: suite.node,
      ring,
      nodeId: source,
      modules: changing,
      fetch,
      stopped: () => false,
    });
  const app = destination();
  expect(await pass(async (url, init) => app.request(String(url), init))).toBe("confirmed");
  payloads = ["first", "second", "third"];
  expect(await pass(async (url, init) => app.request(String(url), init))).toBe("confirmed");
  const held = await nodeDatabase.readHandoverEvents(suite.node, source, null, "return_confirmed");
  expect(new Set(held.map((event) => event.detail.inventory)).size).toBe(2);

  // A restart whose send is refused answers from the second inventory's confirmation.
  expect(await pass(async () => bindingRefusal())).toBe("confirmed");
});

it("answers a held confirmation's records' clash as a clash, and an unreachable main box as confirmed", async () => {
  const app = destination();
  const through = async (url: string | URL | Request, init?: RequestInit) =>
    app.request(String(url), init);
  expect(await send(through)).toBe("confirmed");
  expect(
    await send(async () => {
      throw Object.assign(new Error("unreachable"), { code: "ECONNREFUSED" });
    }),
  ).toBe("confirmed");
  expect(
    await send(async () =>
      Response.json({ error: { code: "fiscal.return_clock_ahead" } }, { status: 409 }),
    ),
  ).toBe("clock");
  expect(
    await send(async () =>
      Response.json({ error: { code: "fiscal.return_record_clash" } }, { status: 409 }),
    ),
  ).toBe("record-clash");
  accounted = false;
  received = [];
  expect(await send(through)).toBe("clash");
  expect(received).toEqual(["first"]);
});

async function chartNaming(primary: string, term: number) {
  const signer = primary === source ? source : receiver;
  const signerKey = await readNodeIdentityKey(suite.node, ring, signer);
  const body = {
    term,
    nodes: [
      {
        nodeId: receiver,
        contactUrl: "https://receiver.test",
        standing: primary === receiver ? ("serving-primary" as const) : ("sell-only" as const),
      },
      {
        nodeId: source,
        contactUrl: "https://source.test",
        standing: primary === source ? ("serving-primary" as const) : ("sell-only" as const),
      },
    ],
  };
  const sourceKey = await readNodeIdentityKey(suite.node, ring, source);
  await writeNodeMembership(suite.db, {
    body,
    signerNodeId: signer,
    signature: signDocumentBody(body, signerKey),
    endorsements:
      signer === source
        ? []
        : [endorseKey(receiver, nodeSigningPublicKey(signerKey), source, sourceKey)],
  });
}

it("sends to the successor its restriction names while its held chart still names itself main", async () => {
  await chartNaming(source, 3);
  await database.withNodeTransaction(suite.node, (tx) =>
    nodeDatabase.recordHandoverRestrictionTx(tx, {
      nodeId: source,
      operationId: "source-handover",
      kind: "handed-over",
      successorNodeId: receiver,
      membershipTerm: 3,
    }),
  );
  const app = destination();
  const urls: string[] = [];
  const through = async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    return app.request(String(url), init);
  };
  expect(await send(through)).toBe("waiting");
  expect(received).toEqual([]);
  expect(urls).toEqual(["https://receiver.test/api/node/return-records"]);
  await chartNaming(receiver, 4);
  expect(await send(through)).toBe("confirmed");
  expect(received).toEqual(["first", "second"]);
  expect(
    await nodeDatabase.readHandoverEvent(suite.node, source, "source-handover", "return_confirmed"),
  ).toEqual(
    expect.objectContaining({
      detail: { destinationNodeId: receiver, inventory: expectedInventory() },
    }),
  );
});

it("still needs attention when a main box its held chart names refuses the binding", async () => {
  expect(await send(async () => bindingRefusal())).toBe("needs-attention");
});

it("still takes in and confirms a batch the old main box sends after Will not return", async () => {
  await completionBinding();
  const { personId } = await acceptanceSession();
  await abandonReturn(
    { db: suite.db, node: suite.node, nodeId: receiver },
    { sourceNodeId: source, personId },
  );
  expect(await takeoverState()).toBe("return_abandoned");

  const app = destination();
  expect(await send(async (url, init) => app.request(String(url), init))).toBe("confirmed");

  expect(received).toEqual(["first", "second"]);
  expect(await takeoverState()).toBe("return_abandoned");
  expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual(
    batchRows("receiver-emergency"),
  );
});

it("lets the old main box be removed without the reset statement once it returns after Will not return", async () => {
  await completionBinding();
  const { personId } = await acceptanceSession();
  const receiverDeps = { db: suite.db, node: suite.node, nodeId: receiver };
  await abandonReturn(receiverDeps, { sourceNodeId: source, personId });
  const app = destination();
  expect(await send(async (url, init) => app.request(String(url), init))).toBe("confirmed");

  const listed = await listServers(suite.db, suite.node, receiver);
  expect(listed.nodes.find((n) => n.nodeId === source)).toMatchObject({
    standing: "sell-only",
    removable: true,
    needsResetStatement: false,
  });
  expect(
    await removeStandby(
      { ...receiverDeps, ring, log: () => {} },
      { targetNodeId: source, personId },
    ),
  ).toMatchObject({ removed: true });
});

it("refuses a batch the old main box signed once it is removed after Will not return", async () => {
  await completionBinding();
  const { personId } = await acceptanceSession();
  const receiverDeps = { db: suite.db, node: suite.node, nodeId: receiver };
  await abandonReturn(receiverDeps, { sourceNodeId: source, personId });
  // Both boxes share one database here, so the batch is signed while the shared chart still lists it.
  const signed: { url: string; init: RequestInit }[] = [];
  await send(async (url, init) => {
    signed.push({ url: String(url), init: init! });
    return new Response(null, { status: 503 });
  });
  expect(signed).toHaveLength(1);
  await removeStandby(
    { ...receiverDeps, ring, log: () => {} },
    { targetNodeId: source, personId, resetStatement: true },
  );
  expect(
    (await database.readNodeMembership(suite.db))!.body.nodes.find((n) => n.nodeId === source)
      ?.standing,
  ).toBe("evicted");

  const response = await destination().request(signed[0]!.url, signed[0]!.init);

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "handover.return_refused", params: { reason: "signature" } },
  });
  expect(received).toEqual([]);
  expect(await suite.db.select().from(database.handoverReturnBatches)).toEqual([]);
});
