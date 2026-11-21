import { generateKeyPairSync } from "node:crypto";
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
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";

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

  /** The code the main box lists for its one request is among the three it shows. */
  function listedChoices(): string[] {
    const [listed] = requests.listed();
    const view = requests.check(listed!.id);
    if ("refused" in view) throw new Error("not listed");
    return view.choices;
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
      expiresAt: shown.expiresAt,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(paths()).toEqual(["hello", "reveal", "poll"]);
    expect(sent[2]!.status).toBe(200);

    const requestId = requests.listed()[0]!.id;
    const begun = requests.approve.begin(requestId, shown.code);
    if ("refused" in begun) throw new Error("approve refused");
    const locked = lockJoinBundle({
      requestId,
      encryptionKey: begun.encryptionKey,
      bundle: Buffer.from("{}"),
      mainPrivateKey: await readNodeIdentityKey(suite.node, RING, mainNodeId),
    });
    expect(requests.approve.finish(requestId, locked)).toBe(true);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempt.current()).toEqual({ state: "approved", code: shown.code, locked });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(paths()).toEqual(["hello", "reveal", "poll", "poll"]);
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
    ["is not a reveal answer", (): Partial<RevealAnswer> => ({})],
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
    let lost = 0;
    lose = (path) => path.endsWith("/reveal") && ++lost <= 2;
    const attempt = createBoxJoinAttempt(deps());
    const shown = await attempt.start(MAIN_URL);

    expect(paths()).toEqual(["hello", "reveal", "reveal", "reveal"]);
    const reveals = sent.slice(1).map((s) => s.body);
    expect(reveals[1]).toEqual(reveals[0]);
    expect(reveals[2]).toEqual(reveals[0]);
    expect(reveals[0]).toMatchObject({ seq: 1 });
    expect(listedChoices()).toContain(shown.code);
  });

  it("fails after three reveals go unanswered, sending a cancel whose answer is lost too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const silentAfterHello: typeof boxExchange = async (url, options) => {
      const answer = await exchange(url, options);
      if (url.pathname.endsWith("/hello")) return answer;
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(new Error("timed out"))),
      );
    };
    const attempt = createBoxJoinAttempt(deps({ exchange: silentAfterHello }));

    const started = attempt.start(MAIN_URL).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(4 * 3_000);
    expect(await started).toMatchObject({ code: "mirror.bundle_fetch_failed" });
    expect(paths()).toEqual(["hello", "reveal", "reveal", "reveal", "cancel"]);
    expect(sent[4]!.status).toBe(200);
    expect(requests.listed()).toEqual([]);
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

  it.each([
    [
      "a bare refusal, without its parameters",
      409,
      { error: { code: "mirror.join_address_mismatch", params: { from: "x" } } },
      { code: "mirror.join_address_mismatch", params: {} },
    ],
    [
      "the clocks' times",
      409,
      {
        error: {
          code: "mirror.clocks_apart",
          params: {
            primaryAt: "2026-11-21T10:00:00.000Z",
            standbyAt: "2026-11-21T11:00:00.000Z",
            note: "x",
          },
        },
      },
      {
        code: "mirror.clocks_apart",
        params: { primaryAt: "2026-11-21T10:00:00.000Z", standbyAt: "2026-11-21T11:00:00.000Z" },
      },
    ],
    [
      "a limit and when it frees",
      429,
      {
        error: {
          code: "mirror.join_full",
          params: { limit: "address", retryAt: "2026-11-21T10:01:00.000Z" },
        },
      },
      {
        code: "mirror.join_full",
        params: { limit: "address", retryAt: "2026-11-21T10:01:00.000Z" },
      },
    ],
    [
      "no limit it does not know",
      429,
      {
        error: {
          code: "mirror.join_full",
          params: { limit: "elsewhere", retryAt: "2026-11-21T10:01:00.000Z" },
        },
      },
      { code: "mirror.bundle_fetch_failed", params: {} },
    ],
    [
      "no code it does not relay",
      500,
      { error: { code: "mirror.join_failed", params: {} } },
      { code: "mirror.bundle_fetch_failed", params: {} },
    ],
    [
      "nothing for an answer that is not JSON",
      502,
      "Bad gateway",
      { code: "mirror.bundle_fetch_failed", params: {} },
    ],
    [
      "nothing for a hello answer that is not one",
      200,
      { requestId: 1 },
      { code: "mirror.bundle_fetch_failed", params: {} },
    ],
  ])("relays from the main box's hello answer %s", async (_name, status, body, refusal) => {
    const answering: typeof boxExchange = async () => ({
      status,
      text: typeof body === "string" ? body : JSON.stringify(body),
    });
    const attempt = createBoxJoinAttempt(deps({ exchange: answering }));
    const thrown = await attempt.start(MAIN_URL).catch((error: unknown) => error);
    expect(thrown).toMatchObject(refusal);
    expect((thrown as { params: object }).params).toEqual(refusal.params);
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

  it("keeps no attempt across a restart", async () => {
    await createBoxJoinAttempt(deps()).start(MAIN_URL);
    expect(createBoxJoinAttempt(deps()).current()).toBeNull();
  });
});
