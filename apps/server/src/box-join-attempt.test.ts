import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { signBytes } from "@waitron/membership";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { createBoxJoinAttempt, type BoxJoinAttemptDeps } from "./box-join-attempt.js";
import { mountBoxJoinApi } from "./box-join-api.js";
import { JOIN_REVEAL_LABEL, revealAnswerFields, signJoinMessage } from "./box-join-code.js";
import { createBoxJoinRequests, type BoxJoinRequests } from "./box-join-requests.js";
import { lockJoinBundle } from "./box-join-seal.js";
import type { boxExchange } from "./mirror-bundle-fetch.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { PAIR_BUNDLE_FIELDS } from "./testing/pair-bundle.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xd).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const NOW = Date.parse("2026-11-21T10:00:00.000Z");
const FROM = "192.168.1.20";
const MAIN_URL = "http://127.0.0.1:8443";

interface RevealAnswer {
  mainNonce: string;
  signature: string;
}

function publicHalf(privateKey: string): string {
  return createPublicKey(
    createPrivateKey({ key: Buffer.from(privateKey, "base64"), format: "der", type: "pkcs8" }),
  )
    .export({ format: "der", type: "spki" })
    .toString("base64");
}

interface Sent {
  path: string;
  body: Record<string, unknown>;
  status?: number;
}

describe("the new box's join attempt", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS], timeoutMs: 60_000 });
  let app: Hono;
  let requests: BoxJoinRequests;
  let mainNodeId: string;
  let sent: Sent[];
  /** Whether the main box's answer to this request is lost after the main box acted on it. */
  let lose: (path: string) => boolean;

  const exchange: typeof boxExchange = async (url, options) => {
    const record: Sent = { path: url.pathname, body: JSON.parse(options.body!) };
    sent.push(record);
    const response = await app.request(
      url.href,
      { method: "POST", headers: { "content-type": "application/json" }, body: options.body },
      { incoming: { socket: { remoteAddress: FROM } } },
    );
    record.status = response.status;
    const text = await response.text();
    if (lose(url.pathname)) throw new Error("answer lost");
    return { status: response.status, text };
  };

  const deps = (overrides: Partial<BoxJoinAttemptDeps> = {}): BoxJoinAttemptDeps => ({
    exchange,
    addresses: () => [FROM, "10.0.0.9"],
    advertisedOrigin: "https://waitron.local:8443",
    spareStorePort: 9000,
    now: () => new Date(NOW),
    steadyNow: () => 0,
    ...overrides,
  });

  const paths = () => sent.map((s) => s.path.replace("/api/node/join/", ""));

  beforeEach(async () => {
    await seedVenue(suite.db, { name: "Main room", invoiceLocales: ["es-ES"] });
    mainNodeId = await seedNode(suite.db);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, mainNodeId);
    requests = createBoxJoinRequests();
    app = new Hono();
    mountBoxJoinApi(app, {
      appDb: suite.db,
      node: suite.node,
      ring: RING,
      designated: { nodeId: mainNodeId },
      requests,
      now: () => new Date(NOW),
    });
    sent = [];
    lose = () => false;
  }, 60_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The main box restarts, so its store no longer knows any request. */
  function restartMainBox() {
    requests = createBoxJoinRequests();
    app = new Hono();
    mountBoxJoinApi(app, {
      appDb: suite.db,
      node: suite.node,
      ring: RING,
      designated: { nodeId: mainNodeId },
      requests,
      now: () => new Date(NOW),
    });
  }

  const mainKey = () => readNodeIdentityKey(suite.node, RING, mainNodeId);

  async function bundleFor(over: Partial<MirrorBundle> = {}): Promise<MirrorBundle> {
    const mainPublicKey = publicHalf(await mainKey());
    return {
      designated: { nodeId: mainNodeId },
      taxpayer: { country: "ES", taxId: "80000001K" },
      primaryNode: { name: "Till 1", filingModule: null, taxModule: null },
      environment: "preproduction",
      boxHostname: "waitron.local",
      boxCaPem: "authority",
      ...PAIR_BUNDLE_FIELDS,
      reservedIdentity: {
        modules: {},
        series: [],
        endorsement: { nodeId: "n", publicKey: "p", endorsedBy: mainNodeId, signature: "s" },
      },
      moduleOverrides: {},
      primaryPublicKey: mainPublicKey,
      credentialsRing: { key: "k", version: 1 },
      backupSettings: null,
      boxCaKeyPem: "authority key",
      ...over,
    };
  }

  /** Approves the one listed request in the main box's store, its bundle locked under `signingKey`. */
  async function approveWith(code: string, bundle: unknown, signingKey?: string) {
    const requestId = requests.listed()[0]!.id;
    const begun = requests.approve.begin(requestId, code);
    if ("refused" in begun) throw new Error("approve refused");
    const locked = lockJoinBundle({
      requestId,
      encryptionKey: begun.encryptionKey,
      bundle: Buffer.from(JSON.stringify(bundle)),
      mainPrivateKey: signingKey ?? (await mainKey()),
    });
    expect(requests.approve.finish(requestId, locked)).toBe(true);
  }

  /** The code the main box lists for its one request is among the three it shows. */
  function listedChoices(): string[] {
    const [listed] = requests.listed();
    const view = requests.check(listed!.id);
    if ("refused" in view) throw new Error("not listed");
    return view.choices;
  }

  /** An exchange that holds every hello until `release` is called. */
  function holdingHello() {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const holding: typeof boxExchange = async (url, options) => {
      if (url.pathname.endsWith("/hello")) await held;
      return exchange(url, options);
    };
    return { holding, release };
  }

  /** Advances fake time until `promise` settles, letting the main box's real work run between. */
  async function settled<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    void promise.then(
      () => (done = true),
      () => (done = true),
    );
    while (!done) {
      await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(500);
    }
    return promise;
  }

  it("says hello, reveals, shows the code with its addresses, and polls until approved", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const attempt = createBoxJoinAttempt(deps());
    const shown = await attempt.start(MAIN_URL);

    expect(shown.addresses).toEqual([FROM, "10.0.0.9"]);
    expect(sent[0]!.body.addresses).toEqual([FROM, "10.0.0.9"]);
    expect(requests.listed()).toMatchObject([{ address: FROM }]);
    expect(listedChoices()).toContain(shown.code);
    expect(attempt.current()).toEqual({
      state: "waiting",
      code: shown.code,
      addresses: [FROM, "10.0.0.9"],
      primaryUrl: MAIN_URL,
      timeLeftMs: 15 * 60_000,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(paths()).toEqual(["hello", "reveal", "poll"]);
    expect(sent[2]!.status).toBe(200);

    const bundle = await bundleFor();
    await approveWith(shown.code, bundle);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempt.current()).toEqual({ state: "approved", code: shown.code });
    const joined = attempt.joined();
    expect(joined).toEqual({
      identity: {
        nodeId: sent[0]!.body.newNodeId,
        publicKey: sent[0]!.body.newPublicKey,
        privateKey: expect.any(String),
      },
      bundle,
      storeUrl: sent[0]!.body.storeUrl,
    });
    expect(publicHalf(joined!.identity.privateKey)).toBe(joined!.identity.publicKey);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(paths()).toEqual(["hello", "reveal", "poll", "poll"]);
    await expect(attempt.start(MAIN_URL)).rejects.toMatchObject({ code: "mirror.join_waiting" });
    expect(attempt.joined()).toEqual(joined);
  });

  it("reports the time left on its own steady clock, from just before the hello", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let steady = 50_000;
    const attempt = createBoxJoinAttempt(
      deps({ steadyNow: () => steady, now: () => new Date(NOW + 8 * 60_000) }),
    );
    const shown = await attempt.start(MAIN_URL);
    expect(shown.timeLeftMs).toBe(15 * 60_000);
    steady += 5 * 60_000;
    expect(attempt.current()).toMatchObject({ state: "waiting", timeLeftMs: 10 * 60_000 });
    steady += 11 * 60_000;
    expect(attempt.current()).toMatchObject({ state: "waiting", timeLeftMs: 0 });
  });

  it("sends its own clock, contact address and store address in the hello", async () => {
    const attempt = createBoxJoinAttempt(deps());
    await attempt.start(MAIN_URL);

    const { newNodeId, contactUrl, storeUrl, at } = sent[0]!.body;
    const name = `box-${(newNodeId as string).slice(0, 4)}.waitron.local`;
    expect({ contactUrl, storeUrl, at }).toEqual({
      contactUrl: `https://${name}:8443`,
      storeUrl: `https://${name}:9000`,
      at: NOW,
    });
    await attempt.cancel();
  });

  it("collects a lost approved answer at the next poll", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let approvedPolls = 0;
    lose = (path) =>
      path.endsWith("/poll") && requests.listed().length === 0 && ++approvedPolls === 1;
    const attempt = createBoxJoinAttempt(deps());
    const shown = await attempt.start(MAIN_URL);
    const bundle = await bundleFor();
    await approveWith(shown.code, bundle);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempt.current()).toMatchObject({ state: "waiting" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(paths()).toEqual(["hello", "reveal", "poll", "poll"]);
    expect(attempt.current()).toEqual({ state: "approved", code: shown.code });
    expect(attempt.joined()?.bundle).toEqual(bundle);
  });

  const otherKey = () =>
    generateKeyPairSync("ed25519")
      .privateKey.export({ format: "der", type: "pkcs8" })
      .toString("base64");

  it.each<[string, () => Promise<{ bundle: unknown; signingKey?: string }>]>([
    [
      "is signed by another key",
      async () => ({ bundle: await bundleFor(), signingKey: otherKey() }),
    ],
    [
      "holds no taxpayer",
      async () => ({ bundle: { ...(await bundleFor()), taxpayer: undefined } }),
    ],
    [
      "names another main key",
      async () => ({ bundle: await bundleFor({ primaryPublicKey: publicHalf(otherKey()) }) }),
    ],
    [
      "names another main box",
      async () => ({ bundle: await bundleFor({ designated: { nodeId: "other-main" } }) }),
    ],
  ])("ends the attempt when the approved answer %s", async (_name, make) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const attempt = createBoxJoinAttempt(deps());
    const shown = await attempt.start(MAIN_URL);
    const { bundle, signingKey } = await make();
    await approveWith(shown.code, bundle, signingKey);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempt.current()).toEqual({ state: "failed", error: "mirror.join_invalid" });
    expect(attempt.joined()).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(paths()).toEqual(["hello", "reveal", "poll"]);
  });

  it.each<[string, (requestId: string) => void, unknown]>([
    [
      "an ended request's reason",
      (requestId) => void requests.dismiss(requestId),
      { state: "ended", reason: "dismissed" },
    ],
    [
      "a main box that no longer knows the request",
      () => restartMainBox(),
      { state: "failed", error: "mirror.join_not_found" },
    ],
  ])("keeps %s as the attempt's state and stops polling", async (_name, end, state) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const attempt = createBoxJoinAttempt(deps());
    await attempt.start(MAIN_URL);
    end(requests.listed()[0]!.id);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempt.current()).toEqual(state);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(paths()).toEqual(["hello", "reveal", "poll"]);
  });

  it("ends the attempt on an ended answer whose reason it does not know", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ending: typeof boxExchange = async (url, options) => {
      const answer = await exchange(url, options);
      if (!url.pathname.endsWith("/poll")) return answer;
      return { status: 200, text: JSON.stringify({ state: "ended", reason: "elsewhere" }) };
    };
    const attempt = createBoxJoinAttempt(deps({ exchange: ending }));
    await attempt.start(MAIN_URL);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempt.current()).toEqual({ state: "ended", reason: "unknown" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(paths()).toEqual(["hello", "reveal", "poll"]);
  });

  it.each<[string, (requestId: string) => void]>([
    ["ended", (requestId) => void requests.dismiss(requestId)],
    ["failed", () => restartMainBox()],
  ])("starts again over an attempt that has %s", async (state, end) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const attempt = createBoxJoinAttempt(deps());
    await attempt.start(MAIN_URL);
    end(requests.listed()[0]!.id);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempt.current()).toMatchObject({ state });

    const shown = await settled(attempt.start(MAIN_URL));
    expect(attempt.current()).toMatchObject({ state: "waiting", code: shown.code });
    expect(paths()).toEqual(["hello", "reveal", "poll", "hello", "reveal"]);
  });

  it.each([
    [
      "is signed by another key",
      (answer: RevealAnswer): RevealAnswer => {
        const other = generateKeyPairSync("ed25519");
        const key = other.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
        return { ...answer, signature: signBytes("forged", key) };
      },
    ],
    [
      "names a main nonce the commitment does not match, signed by the main box",
      (_answer: RevealAnswer, resign: (mainNonce: Buffer) => string): RevealAnswer => {
        const mainNonce = Buffer.alloc(32, 7);
        return { mainNonce: mainNonce.toString("base64"), signature: resign(mainNonce) };
      },
    ],
  ])("ends and cancels the attempt when the reveal answer %s", async (_name, tamper) => {
    const mainPrivateKey = await readNodeIdentityKey(suite.node, RING, mainNodeId);
    const tampering: typeof boxExchange = async (url, options) => {
      const answer = await exchange(url, options);
      if (!url.pathname.endsWith("/reveal")) return answer;
      const { requestId, seq, newNonce } = JSON.parse(options.body!) as Record<string, string>;
      const resign = (mainNonce: Buffer) =>
        signJoinMessage(
          JOIN_REVEAL_LABEL,
          requestId!,
          Number(seq),
          revealAnswerFields(
            requests.requestFor(requestId!)!.hello,
            Buffer.from(newNonce!, "base64"),
            mainNonce,
          ),
          mainPrivateKey,
        );
      const changed = tamper(JSON.parse(answer.text) as RevealAnswer, resign);
      return { status: answer.status, text: JSON.stringify(changed) };
    };
    const attempt = createBoxJoinAttempt(deps({ exchange: tampering }));

    await expect(attempt.start(MAIN_URL)).rejects.toMatchObject({ code: "mirror.join_invalid" });
    expect(paths()).toEqual(["hello", "reveal", "cancel"]);
    expect(sent[2]!.status).toBe(200);
    expect(requests.listed()).toEqual([]);
    expect(attempt.current()).toBeNull();
  });

  it("sends a lost reveal again with the same nonce and seq", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let lost = 0;
    lose = (path) => path.endsWith("/reveal") && ++lost <= 2;
    const attempt = createBoxJoinAttempt(deps());
    const shown = await settled(attempt.start(MAIN_URL));

    expect(paths()).toEqual(["hello", "reveal", "reveal", "reveal"]);
    const reveals = sent.slice(1).map((s) => s.body);
    expect(reveals[1]).toEqual(reveals[0]);
    expect(reveals[2]).toEqual(reveals[0]);
    expect(reveals[0]).toMatchObject({ seq: 1 });
    expect(listedChoices()).toContain(shown.code);
  });

  it("starts each reveal try three seconds after the last began, then fails and cancels", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let reached = () => {};
    const firstReveal = new Promise<void>((resolve) => (reached = resolve));
    let reveals = 0;
    // The first reveal is never answered; every later message fails at once.
    const lossy: typeof boxExchange = async (url, options) => {
      if (url.pathname.endsWith("/hello")) return exchange(url, options);
      sent.push({ path: url.pathname, body: JSON.parse(options.body!) });
      if (url.pathname.endsWith("/reveal") && ++reveals === 1) {
        reached();
        return new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () => reject(new Error("timed out"))),
        );
      }
      throw new Error("connection reset");
    };
    const attempt = createBoxJoinAttempt(deps({ exchange: lossy }));
    let outcome: unknown;
    const started = attempt.start(MAIN_URL).catch((error: unknown) => (outcome = error));
    await firstReveal;

    await vi.advanceTimersByTimeAsync(3_000);
    expect(paths()).toEqual(["hello", "reveal", "reveal"]);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(paths()).toEqual(["hello", "reveal", "reveal"]);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await started;
    expect(paths()).toEqual(["hello", "reveal", "reveal", "reveal", "cancel"]);
    expect(outcome).toMatchObject({ code: "mirror.bundle_fetch_failed" });
    expect(attempt.current()).toBeNull();
  });

  it("raises seq by one for every request, a lost poll's included", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let polls = 0;
    lose = (path) => path.endsWith("/poll") && ++polls === 1;
    const attempt = createBoxJoinAttempt(deps());
    await attempt.start(MAIN_URL);
    await vi.advanceTimersByTimeAsync(6_000);
    await attempt.cancel();

    expect(paths()).toEqual(["hello", "reveal", "poll", "poll", "poll", "cancel"]);
    expect(sent.slice(1).map((s) => s.body.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(sent.slice(1).map((s) => s.status)).toEqual([200, 200, 200, 200, 200]);
  });

  it("answers an exchange that fails as the main box not answering", async () => {
    const attempt = createBoxJoinAttempt(deps({ exchange: undefined, addresses: undefined }));
    await expect(attempt.start("http://127.0.0.1:1")).rejects.toMatchObject({
      code: "mirror.bundle_fetch_failed",
    });
    expect(attempt.current()).toBeNull();
  });

  const refusal = (code: string, params: object = {}) => ({ error: { code, params } });
  const failed = { code: "mirror.bundle_fetch_failed", params: {} };
  const answer = {
    requestId: "r",
    mainNodeId: "m",
    mainPublicKey: "k",
    commitment: "c",
    expiresAt: "2026-11-21T10:15:00.000Z",
  };
  const T1 = "2026-11-21T10:00:00.000Z";
  const T2 = "2026-11-21T11:00:00.000Z";

  it.each<[string, number, unknown, { code: string; params: object }]>([
    [
      "a bare refusal, without its parameters",
      409,
      refusal("mirror.join_address_mismatch", { from: "x" }),
      { code: "mirror.join_address_mismatch", params: {} },
    ],
    [
      "a refusal of the box's name",
      409,
      refusal("mirror.standby_name_taken"),
      { code: "mirror.standby_name_taken", params: {} },
    ],
    [
      "the hello's shape refusal",
      400,
      refusal("mirror.standby_invalid"),
      { code: "mirror.standby_invalid", params: {} },
    ],
    [
      "the clocks' two times alone",
      409,
      refusal("mirror.clocks_apart", { primaryAt: T1, standbyAt: T2, note: "x" }),
      { code: "mirror.clocks_apart", params: { primaryAt: T1, standbyAt: T2 } },
    ],
    [
      "a limit and when it frees",
      429,
      refusal("mirror.join_full", { limit: "address", retryAt: T2, max: 5, minutes: 1 }),
      { code: "mirror.join_full", params: { limit: "address", retryAt: T2, max: 5, minutes: 1 } },
    ],
    [
      "no limit without its numbers",
      429,
      refusal("mirror.join_full", { limit: "address", retryAt: T2, max: "5", minutes: 1 }),
      failed,
    ],
    [
      "no limit it does not know",
      429,
      refusal("mirror.join_full", { limit: "elsewhere", retryAt: T2 }),
      failed,
    ],
    ["no code it does not relay", 500, refusal("mirror.join_failed"), failed],
    ["nothing for an answer that is not JSON", 502, "Bad gateway", failed],
    [
      "nothing for a hello answer with a field that is not text",
      200,
      { ...answer, requestId: 1 },
      failed,
    ],
    [
      "nothing for a hello answer whose expiry is not a time",
      200,
      { ...answer, expiresAt: "soon" },
      failed,
    ],
  ])("relays from the main box's hello answer %s", async (_name, status, body, relayed) => {
    const answering: typeof boxExchange = async () => ({
      status,
      text: typeof body === "string" ? body : JSON.stringify(body),
    });
    const attempt = createBoxJoinAttempt(deps({ exchange: answering }));
    const thrown = await attempt.start(MAIN_URL).catch((error: unknown) => error);
    expect(thrown).toMatchObject(relayed);
    expect((thrown as { params: object }).params).toEqual(relayed.params);
  });

  it("relays a refused reveal and keeps no attempt", async () => {
    const refusing: typeof boxExchange = async (url, options) =>
      url.pathname.endsWith("/reveal")
        ? { status: 409, text: JSON.stringify({ error: { code: "mirror.join_code_taken" } }) }
        : exchange(url, options);
    const attempt = createBoxJoinAttempt(deps({ exchange: refusing }));

    await expect(attempt.start(MAIN_URL)).rejects.toMatchObject({
      code: "mirror.join_code_taken",
    });
    expect(attempt.current()).toBeNull();
  });

  it("cancels with a signed message, forgets the attempt and stops polling", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const holdingPoll: typeof boxExchange = async (url, options) => {
      const answer = await exchange(url, options);
      if (url.pathname.endsWith("/poll")) await held;
      return answer;
    };
    const attempt = createBoxJoinAttempt(deps({ exchange: holdingPoll }));
    await attempt.start(MAIN_URL);
    await vi.advanceTimersByTimeAsync(2_000);
    await attempt.cancel();
    release();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(paths()).toEqual(["hello", "reveal", "poll", "cancel"]);
    expect(sent[3]!.status).toBe(200);
    expect(requests.listed()).toEqual([]);
    expect(attempt.current()).toBeNull();
  });

  it("keeps the attempt when the main box is approving it, and refuses the cancel", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const attempt = createBoxJoinAttempt(deps());
    const shown = await attempt.start(MAIN_URL);
    const requestId = requests.listed()[0]!.id;
    expect(requests.approve.begin(requestId, shown.code)).not.toHaveProperty("refused");

    await expect(attempt.cancel()).rejects.toMatchObject({ code: "mirror.join_approving" });
    expect(attempt.current()).toMatchObject({ state: "waiting", code: shown.code });

    const bundle = await bundleFor();
    const locked = lockJoinBundle({
      requestId,
      encryptionKey: (sent[0]!.body as { encryptionKey: string }).encryptionKey,
      bundle: Buffer.from(JSON.stringify(bundle)),
      mainPrivateKey: await mainKey(),
    });
    expect(requests.approve.finish(requestId, locked)).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempt.current()).toEqual({ state: "approved", code: shown.code });
    expect(attempt.joined()?.bundle).toEqual(bundle);
  });

  it("refuses to start while a start runs or an attempt waits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { holding, release } = holdingHello();
    const attempt = createBoxJoinAttempt(deps({ exchange: holding }));
    const first = attempt.start(MAIN_URL);

    await expect(attempt.start(MAIN_URL)).rejects.toMatchObject({ code: "mirror.join_waiting" });
    release();
    await first;
    await expect(attempt.start(MAIN_URL)).rejects.toMatchObject({ code: "mirror.join_waiting" });
    expect(paths()).toEqual(["hello", "reveal"]);
  });

  it("ends a start that a cancel arrived during, once the main box has listed it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { holding, release } = holdingHello();
    const attempt = createBoxJoinAttempt(deps({ exchange: holding }));
    const started = attempt.start(MAIN_URL);
    const cancelled = attempt.cancel();
    release();
    await Promise.all([started, cancelled]);

    expect(paths()).toEqual(["hello", "reveal", "cancel"]);
    expect(sent[2]!.status).toBe(200);
    expect(requests.listed()).toEqual([]);
    expect(attempt.current()).toBeNull();
  });

  it("keeps no attempt across a restart", async () => {
    await createBoxJoinAttempt(deps()).start(MAIN_URL);
    expect(createBoxJoinAttempt(deps()).current()).toBeNull();
  });
});
