import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CORE_MIGRATIONS,
  stampDeployment,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import { verifyEnvelope } from "@waitron/handover";
import {
  canonicalize,
  endorseKey,
  signDocumentBody,
  type CanonicalValue,
} from "@waitron/membership";
import {
  NODE_MIGRATIONS,
  appendHandoverEventTx,
  recordHandoverRestrictionTx,
} from "@waitron/node-db";
import type { WaitronModule } from "@waitron/module";
import { REPLACED_RESET_FILE } from "@waitron/store";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { signAsThisBox } from "./handover-signing.js";
import { returnDigest } from "./return-records.js";
import { startResetOrderDuty } from "./reset-order-duty.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const HELD = [{ chain: "earlier-box", count: 3 }];
const LACKING = [{ chain: "earlier-box", reason: "record_missing" }];
const modules: WaitronModule[] = [
  {
    name: "sample",
    version: "1.0.0",
    tier: "mandatory",
    handover: {
      summarise: async () => null,
      returnRecords: {
        read: async () => ["first"],
        receive: async () => true,
        acceptPermission: "sample.accept",
        inspect: async () => [],
      },
      holdings: async () => HELD,
      lacking: async () => [],
    },
  },
];
const OPERATION = "source-handover";

let source: string;
let receiver: string;
let stateDir: string;

/** What the stand-in main box saw: each query's body, and the marker on disk as it arrived. */
type Seen = { body: Record<string, CanonicalValue>; marker: string | null };

async function markerOnDisk(): Promise<string | null> {
  try {
    return await readFile(join(stateDir, REPLACED_RESET_FILE), "utf8");
  } catch {
    return null;
  }
}

/** A stand-in main box: it verifies the old box's query and answers with what `reply` gives. */
async function standIn(
  reply: (seen: Seen, index: number) => Promise<Response> | Response,
): Promise<{ seen: Seen[]; fetch: typeof fetch }> {
  const sourceKey = nodeSigningPublicKey(await readNodeIdentityKey(suite.node, ring, source));
  const seen: Seen[] = [];
  return {
    seen,
    fetch: async (url, init) => {
      expect(String(url)).toBe("https://receiver.test/api/node/reset-order");
      const verified = verifyEnvelope<Record<string, CanonicalValue>>(
        JSON.parse(String(init?.body)),
        "reset-query",
        (id) => (id === source ? sourceKey : undefined),
      );
      if (!verified.valid) throw new Error(`the stand-in refused the query: ${verified.reason}`);
      const entry = { body: verified.body, marker: await markerOnDisk() };
      seen.push(entry);
      return reply(entry, seen.length - 1);
    },
  };
}

async function signedOrder(
  seen: Seen,
  order: { orderId: string; acceptLoss: boolean } | null,
  lacking: Record<string, CanonicalValue[]> = { sample: [] },
) {
  return Response.json(
    await signAsThisBox({ node: suite.node, ring, nodeId: receiver }, "reset-order", {
      nonce: seen.body.nonce!,
      sourceNodeId: source,
      order,
      lacking,
    }),
  );
}

const refused = () =>
  Response.json(
    { error: { code: "handover.reset_query_refused", params: { reason: "standing" } } },
    { status: 409 },
  );

/** A clock that only the duty's sleeps move. */
function clock() {
  let at = Date.parse("2026-11-22T10:00:00Z");
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => new Date(at),
    sleep: async (ms: number) => {
      sleeps.push(ms);
      at += ms;
    },
  };
}

/** A clock whose `parkAt`th sleep waits until `resume` or the duty's stop. */
function parkedClock(parkAt = 2) {
  const time = clock();
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const sleep = vi.fn(async (ms: number, signal?: AbortSignal) => {
    time.sleeps.push(ms);
    if (time.sleeps.length === parkAt)
      await Promise.race([
        paused,
        new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve())),
      ]);
  });
  return { time: { ...time, sleep }, sleep, resume };
}

function start(
  fetch: typeof globalThis.fetch,
  time: ReturnType<typeof clock> = clock(),
  over: {
    log?: (level: string, event: string, fields?: object) => void;
    stateDir?: string;
    modules?: WaitronModule[];
    returnPass?: () => Promise<unknown>;
  } = {},
) {
  const restart = vi.fn();
  const returnPass = vi.fn(over.returnPass ?? (async () => "confirmed"));
  const duty = startResetOrderDuty({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules: over.modules ?? modules,
    stateDir: over.stateDir ?? stateDir,
    venueDir: join(over.stateDir ?? stateDir, "venue"),
    returnPass,
    fetch,
    log: over.log ?? (() => {}),
    now: time.now,
    sleep: time.sleep,
    restart,
  });
  return { duty, restart, time, returnPass };
}

/** The old box's chart, naming the new main box main at `receiverUrl`. */
async function holdChart(receiverUrl: string) {
  const sourceKey = await readNodeIdentityKey(suite.node, ring, source);
  const receiverKey = await readNodeIdentityKey(suite.node, ring, receiver);
  const body = {
    term: 3,
    nodes: [
      {
        nodeId: receiver,
        contactUrl: receiverUrl,
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
}

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-reset-duty-"));
  await mkdir(join(stateDir, "venue"));
  await seedVenue(suite.db, { name: "Reset venue" });
  await stampDeployment(suite.db, "preproduction");
  source = await seedNode(suite.db);
  receiver = await seedNode(suite.db);
  for (const nodeId of [source, receiver])
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  const sourceKey = await readNodeIdentityKey(suite.node, ring, source);
  await pinMainBoxKey(suite.node, receiver, {
    nodeId: source,
    publicKey: nodeSigningPublicKey(sourceKey),
  });
  await holdChart("https://receiver.test");
  await withNodeTransaction(suite.node, async (tx) => {
    await recordHandoverRestrictionTx(tx, {
      nodeId: source,
      operationId: OPERATION,
      kind: "handed-over",
      successorNodeId: receiver,
      membershipTerm: 3,
    });
    await appendHandoverEventTx(tx, {
      nodeId: source,
      operationId: OPERATION,
      kind: "return_confirmed",
      detail: {
        destinationNodeId: receiver,
        inventory: returnDigest([returnDigest({ module: "sample", payload: "first" })]),
      },
    });
  });
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

it("saves the wiping marker before the acknowledgement, which carries setAside and the lacking chains, then restarts", async () => {
  const main = await standIn((seen) =>
    signedOrder(seen, { orderId: "order-1", acceptLoss: false }, { sample: LACKING }),
  );
  const { duty, restart } = start(main.fetch);
  await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  await duty.stop();
  expect(main.seen).toEqual([
    {
      body: expect.objectContaining({
        sourceNodeId: source,
        destinationNodeId: receiver,
        holdings: { sample: HELD },
      }),
      marker: null,
    },
    {
      body: expect.objectContaining({
        holdings: { sample: HELD },
        ack: { orderId: "order-1", setAside: true, lacking: { sample: LACKING } },
      }),
      marker: expect.any(String),
    },
  ]);
  expect(main.seen[0]!.body.ack).toBeUndefined();
  expect(JSON.parse(main.seen[1]!.marker!)).toEqual({ phase: "wiping", setAside: true });
  expect(duty.answer()).toEqual({
    order: { orderId: "order-1", acceptLoss: false },
    lacking: { sample: LACKING },
  });
});

it("acknowledges an order with nothing lacking as not set aside", async () => {
  const main = await standIn((seen) =>
    signedOrder(seen, { orderId: "order-1", acceptLoss: false }),
  );
  const { duty, restart } = start(main.fetch);
  await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  await duty.stop();
  expect(main.seen[1]!.body.ack).toEqual({ orderId: "order-1", setAside: false, lacking: {} });
  expect(JSON.parse(main.seen[1]!.marker!)).toEqual({ phase: "wiping", setAside: false });
});

it("retries the acknowledgement every 10 seconds for 2 minutes, then restarts anyway", async () => {
  const main = await standIn((seen, index) => {
    if (index === 0) return signedOrder(seen, { orderId: "order-1", acceptLoss: false });
    throw Object.assign(new Error("unreachable"), { code: "ECONNREFUSED" });
  });
  const { duty, restart, time } = start(main.fetch);
  await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  await duty.stop();
  const acks = main.seen.filter((seen) => seen.body.ack !== undefined);
  expect(acks).toHaveLength(12);
  expect(acks.every((seen) => seen.marker !== null)).toBe(true);
  expect(time.sleeps).toEqual(Array.from({ length: 12 }, () => 10_000));
});

it("stops retrying once the main box refuses the acknowledgement, and restarts", async () => {
  const main = await standIn((seen, index) =>
    index === 0 ? signedOrder(seen, { orderId: "order-1", acceptLoss: false }) : refused(),
  );
  const { duty, restart, time } = start(main.fetch);
  await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  await duty.stop();
  expect(main.seen).toHaveLength(2);
  expect(time.sleeps).toEqual([]);
});

it("keeps an answer without an order, saves nothing, and asks again 30 seconds later", async () => {
  let asked = 0;
  const main = await standIn((seen) => {
    asked++;
    return signedOrder(seen, null, { sample: LACKING });
  });
  const { time, sleep, resume } = parkedClock();
  const { duty, restart } = start(main.fetch, time);
  expect(duty.answer()).toBeNull();
  await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(2));
  expect(asked).toBe(2);
  expect(time.sleeps).toEqual([30_000, 30_000]);
  expect(duty.answer()).toEqual({ order: null, lacking: { sample: LACKING } });
  expect(await markerOnDisk()).toBeNull();
  expect(restart).not.toHaveBeenCalled();
  resume();
  await duty.stop();
});

it("asks every 5 minutes while the main box refuses, and keeps no answer", async () => {
  const main = await standIn(() => refused());
  const { time, sleep, resume } = parkedClock();
  const { duty, restart } = start(main.fetch, time);
  await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(2));
  expect(main.seen).toHaveLength(2);
  expect(time.sleeps).toEqual([300_000, 300_000]);
  expect(duty.answer()).toBeNull();
  expect(await markerOnDisk()).toBeNull();
  expect(restart).not.toHaveBeenCalled();
  resume();
  await duty.stop();
});

it("sends no acknowledgement and keeps asking when the marker cannot be saved", async () => {
  const main = await standIn((seen) =>
    signedOrder(seen, { orderId: "order-1", acceptLoss: false }),
  );
  const parked = parkedClock();
  const logs: string[] = [];
  const { duty, restart } = start(main.fetch, parked.time, {
    stateDir: join(stateDir, "missing"),
    log: (_level, event) => logs.push(event),
  });
  await vi.waitFor(() => expect(parked.sleep).toHaveBeenCalledTimes(2));
  expect(main.seen).toHaveLength(2);
  expect(main.seen.every((seen) => seen.body.ack === undefined)).toBe(true);
  expect(parked.time.sleeps).toEqual([30_000, 30_000]);
  expect(logs).toEqual(["reset-order.save_failed"]);
  expect(restart).not.toHaveBeenCalled();
  parked.resume();
  await duty.stop();
});

it("shows no order while the marker cannot be saved, nor once the main box refuses, and shows it once saved", async () => {
  const missing = join(stateDir, "missing");
  const current: { duty?: ReturnType<typeof start>["duty"] } = {};
  const shown: unknown[] = [];
  const main = await standIn(async (seen, index) => {
    shown.push(current.duty?.answer()?.order ?? null);
    if (index === 1) return refused();
    if (index === 2) await mkdir(join(missing, "venue"), { recursive: true });
    return signedOrder(seen, { orderId: "order-1", acceptLoss: false });
  });
  const parked = parkedClock(3);
  const logs: string[] = [];
  const started = start(main.fetch, parked.time, {
    stateDir: missing,
    log: (level, event) => {
      if (level === "warn") logs.push(event);
    },
  });
  current.duty = started.duty;
  const { duty } = started;
  await vi.waitFor(() => expect(started.restart).toHaveBeenCalledTimes(1));
  await duty.stop();
  // Asked when the save had failed, after the refusal, then with the order saved and acknowledged.
  expect(shown).toEqual([null, null, null, { orderId: "order-1", acceptLoss: false }]);
  expect(duty.answer()?.order).toEqual({ orderId: "order-1", acceptLoss: false });
  expect(logs).toEqual(["reset-order.save_failed", "reset-order.refused"]);
});

it("logs each cause once, and again only when it changes", async () => {
  const answers = ["ECONNREFUSED", "ECONNREFUSED", "malformed"];
  const main = await standIn(() => {
    const next = answers.shift();
    if (next === "malformed") return new Response("{}", { status: 500 });
    if (next !== undefined) throw Object.assign(new Error("unreachable"), { code: next });
    return refused();
  });
  const time = clock();
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const sleep = vi.fn(async (ms: number) => {
    time.sleeps.push(ms);
    if (time.sleeps.length === 5) await paused;
  });
  const logs: { event: string; fields?: object }[] = [];
  const { duty } = start(
    main.fetch,
    { ...time, sleep },
    { log: (_level, event, fields) => logs.push({ event, fields }) },
  );
  await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(5));
  expect(logs).toEqual([
    { event: "reset-order.unreachable", fields: { errorClass: "Error", errno: "ECONNREFUSED" } },
    { event: "reset-order.check_failed", fields: { check: "answer" } },
    { event: "reset-order.refused", fields: { reason: "standing" } },
  ]);
  resume();
  await duty.stop();
});

it("goes back to asking every 30 seconds after an answer that is not a refusal", async () => {
  const main = await standIn((seen, index) => (index < 2 ? refused() : signedOrder(seen, null)));
  const { time, sleep, resume } = parkedClock(4);
  const { duty } = start(main.fetch, time);
  await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(4));
  expect(time.sleeps).toEqual([300_000, 300_000, 30_000, 30_000]);
  resume();
  await duty.stop();
});

it("reads its holdings once per start and sends them with every question", async () => {
  const holdings = vi.fn(async () => HELD);
  const counted: WaitronModule[] = [
    { ...modules[0]!, handover: { ...modules[0]!.handover!, holdings } },
  ];
  const main = await standIn((seen) => signedOrder(seen, null));
  const { time, sleep, resume } = parkedClock(3);
  const { duty } = start(main.fetch, time, { modules: counted });
  await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(3));
  expect(main.seen).toHaveLength(3);
  expect(
    main.seen.every((seen) => canonicalize(seen.body.holdings!) === canonicalize({ sample: HELD })),
  ).toBe(true);
  expect(holdings).toHaveBeenCalledTimes(1);
  resume();
  await duty.stop();
});

it("logs a question that throws once, and asks again on the next turn", async () => {
  let throws = 2;
  const throwing: WaitronModule[] = [
    {
      ...modules[0]!,
      handover: {
        ...modules[0]!.handover!,
        holdings: async () => {
          if (throws-- > 0) throw new Error("holdings unreadable");
          return HELD;
        },
      },
    },
  ];
  const main = await standIn((seen) => signedOrder(seen, null));
  const { time, sleep, resume } = parkedClock(3);
  const logs: string[] = [];
  const { duty } = start(main.fetch, time, {
    modules: throwing,
    log: (_level, event) => logs.push(event),
  });
  await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(3));
  expect(logs).toEqual(["reset-order.failed"]);
  expect(main.seen).toHaveLength(1);
  expect(time.sleeps).toEqual([30_000, 30_000, 30_000]);
  expect(duty.answer()).toEqual({ order: null, lacking: { sample: [] } });
  resume();
  await duty.stop();
});

it("sends nothing while its chart gives the main box no address, and asks again 30 seconds later", async () => {
  await holdChart("");
  const main = await standIn((seen) => signedOrder(seen, null));
  const { time, sleep, resume } = parkedClock();
  const { duty, restart } = start(main.fetch, time);
  await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(2));
  expect(main.seen).toEqual([]);
  expect(time.sleeps).toEqual([30_000, 30_000]);
  expect(duty.answer()).toBeNull();
  expect(restart).not.toHaveBeenCalled();
  resume();
  await duty.stop();
});

it("stopped during the acknowledgement's retries, keeps the marker, sends no more and does not restart", async () => {
  const main = await standIn((seen, index) => {
    if (index === 0) return signedOrder(seen, { orderId: "order-1", acceptLoss: false });
    throw Object.assign(new Error("unreachable"), { code: "ECONNREFUSED" });
  });
  const { time, sleep } = parkedClock(1);
  const { duty, restart } = start(main.fetch, time);
  await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
  await duty.stop();
  expect(main.seen).toHaveLength(2);
  expect(JSON.parse((await markerOnDisk())!)).toEqual({ phase: "wiping", setAside: false });
  expect(restart).not.toHaveBeenCalled();
});

it("stopped while the order arrives, saves nothing, sends no acknowledgement and does not restart", async () => {
  let stopping: Promise<void> | undefined;
  const { time } = parkedClock();
  const main = await standIn((seen) => {
    stopping = duty.stop();
    return signedOrder(seen, { orderId: "order-1", acceptLoss: false });
  });
  const { duty, restart } = start(main.fetch, time);
  await vi.waitFor(() => expect(stopping).toBeDefined());
  await stopping;
  expect(main.seen).toHaveLength(1);
  expect(await markerOnDisk()).toBeNull();
  expect(restart).not.toHaveBeenCalled();
});

it("runs one more return pass for a loss order before it saves the marker", async () => {
  const main = await standIn((seen) => signedOrder(seen, { orderId: "order-1", acceptLoss: true }));
  const markerAtPass: (string | null)[] = [];
  const sentAtPass: number[] = [];
  const { duty, restart, returnPass } = start(main.fetch, clock(), {
    returnPass: async () => {
      markerAtPass.push(await markerOnDisk());
      sentAtPass.push(main.seen.length);
      return "confirmed";
    },
  });
  await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  await duty.stop();
  expect(returnPass).toHaveBeenCalledTimes(1);
  expect(markerAtPass).toEqual([null]);
  expect(sentAtPass).toEqual([1]);
  expect(main.seen[1]!.body.ack).toEqual({ orderId: "order-1", setAside: true, lacking: {} });
  expect(JSON.parse(main.seen[1]!.marker!)).toEqual({ phase: "wiping", setAside: true });
});

it("runs no extra return pass for an order without a loss", async () => {
  const main = await standIn((seen) =>
    signedOrder(seen, { orderId: "order-1", acceptLoss: false }),
  );
  const { duty, restart, returnPass } = start(main.fetch);
  await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  await duty.stop();
  expect(returnPass).not.toHaveBeenCalled();
});

it("saves no marker, sends no acknowledgement and logs once when the set-aside's renames are refused", async () => {
  // A file where the set-aside folder goes makes the Move's prepare step refuse.
  await writeFile(join(stateDir, "records"), "not a folder");
  const main = await standIn((seen) =>
    signedOrder(seen, { orderId: "order-1", acceptLoss: false }, { sample: LACKING }),
  );
  const parked = parkedClock(3);
  const logs: { event: string; fields?: object }[] = [];
  const { duty, restart } = start(main.fetch, parked.time, {
    log: (_level, event, fields) => logs.push({ event, fields }),
  });
  await vi.waitFor(() => expect(parked.sleep).toHaveBeenCalledTimes(3));
  expect(main.seen).toHaveLength(3);
  expect(main.seen.every((seen) => seen.body.ack === undefined && seen.marker === null)).toBe(true);
  expect(await markerOnDisk()).toBeNull();
  expect(parked.time.sleeps).toEqual([30_000, 30_000, 30_000]);
  expect(logs).toEqual([
    {
      event: "replaced-reset.set_aside_unavailable",
      fields: { reason: expect.stringContaining("records") },
    },
  ]);
  expect(restart).not.toHaveBeenCalled();
  parked.resume();
  await duty.stop();
});

it("logs a set-aside test that fails without a refusal as a failure, saves nothing and asks again", async () => {
  await rm(join(stateDir, "venue"), { recursive: true });
  const main = await standIn((seen) => signedOrder(seen, { orderId: "order-1", acceptLoss: true }));
  const parked = parkedClock();
  const logs: { event: string; fields?: object }[] = [];
  const { duty, restart } = start(main.fetch, parked.time, {
    log: (_level, event, fields) => logs.push({ event, fields }),
  });
  await vi.waitFor(() => expect(parked.sleep).toHaveBeenCalledTimes(2));
  expect(main.seen.every((seen) => seen.body.ack === undefined)).toBe(true);
  expect(await markerOnDisk()).toBeNull();
  expect(logs).toEqual([
    { event: "reset-order.failed", fields: { errorCode: expect.any(String) } },
  ]);
  expect(restart).not.toHaveBeenCalled();
  parked.resume();
  await duty.stop();
});

it("stopped during a loss order's extra return pass, saves nothing, sends nothing and does not restart", async () => {
  let stopping: Promise<void> | undefined;
  const main = await standIn((seen) => signedOrder(seen, { orderId: "order-1", acceptLoss: true }));
  const { duty, restart, returnPass } = start(main.fetch, clock(), {
    returnPass: async () => {
      stopping = duty.stop();
      return "confirmed";
    },
  });
  await vi.waitFor(() => expect(stopping).toBeDefined());
  await stopping;
  expect(returnPass).toHaveBeenCalledTimes(1);
  expect(main.seen).toHaveLength(1);
  expect(await markerOnDisk()).toBeNull();
  expect(restart).not.toHaveBeenCalled();
});

it("runs a loss order's extra return pass once while the set-aside's renames keep being refused", async () => {
  await writeFile(join(stateDir, "records"), "not a folder");
  const main = await standIn((seen) => signedOrder(seen, { orderId: "order-1", acceptLoss: true }));
  const parked = parkedClock();
  const logs: string[] = [];
  const { duty, restart, returnPass } = start(main.fetch, parked.time, {
    log: (_level, event) => logs.push(event),
  });
  await vi.waitFor(() => expect(parked.sleep).toHaveBeenCalledTimes(2));
  expect(main.seen).toHaveLength(2);
  expect(returnPass).toHaveBeenCalledTimes(1);
  expect(logs).toEqual(["replaced-reset.set_aside_unavailable"]);
  expect(await markerOnDisk()).toBeNull();
  expect(restart).not.toHaveBeenCalled();
  parked.resume();
  await duty.stop();
});
