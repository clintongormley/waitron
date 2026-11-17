import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openVenueDatabase, type VenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { signEnvelope } from "@waitron/handover";
import { signingPasskey } from "@waitron/identity/test/passkey-signer.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readTakeFailures } from "@waitron/node-db";
import type { Logger } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { PAIR_COPY_DIR, SPARE_FOLLOW_DIR, VENUE_FILE } from "@waitron/store";
import type { FollowProgress } from "@waitron/stream";
import { createPasswordThrottle } from "./password-throttle.js";
import { mountHandoverEmergencyApi } from "./handover-emergency-api.js";
import { followedCopyId } from "./handover-copy-from-follow.js";
import { SWITCH_PROOF_COOKIE, makeSwitchProof } from "./handover-switch-proof.js";
import { beginHandover } from "./handover-store.js";
import { placeFirstCopy } from "./spare-copy-placement.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import {
  ADMIN,
  ADMIN_EMAIL,
  PASSWORD,
  OPERATION,
  fiscalModules,
  primary,
  standby,
  ring,
  placedSpareFixture,
} from "./testing/handover-placed-copy.js";

const copying = vi.hoisted(() => ({ fail: false }));
vi.mock("./handover-copy-from-follow.js", async (original) => {
  const real = await original<typeof import("./handover-copy-from-follow.js")>();
  return {
    ...real,
    stageFollowedAsCopy: (...args: Parameters<typeof real.stageFollowedAsCopy>) => {
      if (copying.fail) throw new Error("synthetic disk failure while copying");
      return real.stageFollowedAsCopy(...args);
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const mainBox = useVenueDb({ migrations });
const spareBefore = useVenueDb({ migrations });
let root: string;
let placed: VenueDatabase;
let mainKey: string;
const dirs = () => ({
  mainState: join(root, "main-state"),
  spareState: join(root, "spare-state"),
  spareVenue: join(root, "spare-venue"),
});
const fixture = placedSpareFixture({ mainBox, spareBefore, dirs });
const POSITION = { generation: "0000000000000001", appliedTXID: "00000000000000a1" };
const external = { restriction: undefined as undefined | { kind: "superseded" } };
const sockets: TLSSocket[] = [];
const signIn = { email: ADMIN_EMAIL, password: PASSWORD };
const followedVenue = () => join(dirs().spareState, SPARE_FOLLOW_DIR, VENUE_FILE);
const readyFile = () => join(dirs().spareState, PAIR_COPY_DIR, "ready.json");

function progress(overrides: Partial<FollowProgress> = {}): FollowProgress {
  return {
    ...POSITION,
    state: "following",
    uploadedTXID: POSITION.appliedTXID,
    lagMs: 0,
    lastAppliedAt: null,
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "emergency-followed-"));
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  ({ mainKey } = await fixture.setupBoxes());
  mainBox.db.run(sql`vacuum into ${join(dirs().spareVenue, "venue.db")}`);
  spareBefore.node.run(sql`vacuum into ${join(dirs().spareVenue, "node.db")}`);
  await mkdir(join(dirs().spareState, SPARE_FOLLOW_DIR), { recursive: true });
  mainBox.db.run(sql`vacuum into ${followedVenue()}`);
  placed = await openVenueDatabase(dirs().spareVenue);
  external.restriction = undefined;
  copying.fail = false;
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await placed?.close();
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

type StopForSwitch = NonNullable<
  Parameters<typeof mountHandoverEmergencyApi>[1]["follow"]
>["stopForSwitch"];

function service(
  options: {
    progress?: FollowProgress | null;
    catchingUp?: boolean;
    failsAfterStop?: boolean;
    log?: Logger;
  } = {},
) {
  const origin = "https://spare.example";
  const app = new Hono();
  const restart = vi.fn();
  const asked = vi.fn();
  const seen = "progress" in options ? (options.progress ?? null) : progress();
  const stopForSwitch = vi.fn<StopForSwitch>(async () => {
    if (options.failsAfterStop === true) throw new AppError("handover.copy_damaged", {});
    return options.catchingUp === true
      ? { kind: "catching-up" as const, progress: seen }
      : { kind: "stopped" as const, ...POSITION, path: followedVenue() };
  });
  mountHandoverEmergencyApi(
    app,
    {
      db: placed.venue,
      node: placed.node,
      nodeId: standby.nodeId,
      ring,
      stateDir: dirs().spareState,
      venueDir: dirs().spareVenue,
      modules: fiscalModules,
      origin,
      rpId: "spare.example",
      credentialKeyRing: TOTP_KEY_RING,
      passwordThrottle: createPasswordThrottle(),
      follow: { stopForSwitch, progress: () => seen, restart, migrationsRoot: null },
      fetch: async (_url, init) => {
        asked();
        if (external.restriction === undefined)
          throw Object.assign(new Error("synthetic transport fault"), { code: "ECONNREFUSED" });
        const query = JSON.parse(init!.body as string) as { body: { nonce: string } };
        return new Response(
          JSON.stringify(
            signEnvelope(
              "status",
              {
                nonce: query.body.nonce,
                heldMembership: null,
                restriction: null,
                openOperation: null,
                requestedOperation: null,
              },
              { nodeId: primary.nodeId, privateKey: mainKey },
            ),
          ),
        );
      },
    },
    options.log,
  );
  const post = async (body: unknown, step = "followed", headers: Record<string, string> = {}) => {
    const socket = new TLSSocket(new Socket());
    sockets.push(socket);
    const response = await app.request(
      `${origin}/api/node/handover/emergency/${step}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin, ...headers },
        body: JSON.stringify(body),
      },
      { incoming: { socket } },
    );
    const setCookie = response.headers.get("set-cookie");
    return {
      status: response.status,
      ...(setCookie === null ? {} : { setCookie }),
      body: (await response.json()) as {
        state?: string;
        progress?: FollowProgress | null;
        copy?: { source: string; sourceId?: string };
        declaration?: { body: { lastCopy: unknown } };
        error?: { code: string };
        options?: { challenge: string };
      },
    };
  };
  const take = (credentials: unknown = signIn) => post({ signIn: credentials });
  return { post, take, restart, stopForSwitch, asked };
}

async function restarted(s: { restart: ReturnType<typeof vi.fn> }) {
  await vi.waitFor(() => expect(s.restart).toHaveBeenCalledOnce());
}

async function marker(file: "ready.json" | "placed.json", source: string, sourceId: string) {
  await mkdir(join(dirs().spareState, PAIR_COPY_DIR), { recursive: true });
  await writeFile(
    join(dirs().spareState, PAIR_COPY_DIR, file),
    JSON.stringify({ source, sourceId }),
  );
}

it("stops following, stages the followed copy, signs in against it and restarts", async () => {
  const s = service({ progress: progress() });
  const answer = await s.take();
  expect(answer).toEqual({ status: 200, body: { state: "restarting" } });
  // One look: the page asks again every 2 seconds, so the take never holds its turn waiting.
  expect(s.stopForSwitch).toHaveBeenCalledExactlyOnceWith({ catchUpMs: 0 });
  expect(JSON.parse(await readFile(readyFile(), "utf8"))).toEqual({
    source: "followed-copy",
    sourceId: followedCopyId(POSITION),
  });
  await restarted(s);
});

it("a person enrolled after joining can take the copy", async () => {
  const followed = new DatabaseSync(followedVenue());
  followed.exec(
    `update persons set email = 'late@venue.test', email_folded = 'late@venue.test' where email = '${ADMIN_EMAIL}'`,
  );
  followed.close();
  const s = service();
  expect((await s.take({ email: "late@venue.test", password: PASSWORD })).body).toEqual({
    state: "restarting",
  });
  await restarted(s);
});

it("a refused sign-in leaves nothing staged and restarts", async () => {
  const s = service();
  expect((await s.take({ ...signIn, password: "wrong" })).body.error?.code).toBe(
    "password.invalid",
  );
  await expect(readFile(readyFile())).rejects.toMatchObject({ code: "ENOENT" });
  await restarted(s);
});

it("a passkey take signs in against the staged copy's passkey rows, and writes no challenge row", async () => {
  const passkey = signingPasskey("spare.example");
  const followed = new DatabaseSync(followedVenue());
  followed
    .prepare(
      "insert into webauthn_credentials (id, person_id, credential_id, public_key, counter, created_at) values (?, ?, ?, ?, 0, ?)",
    )
    .run(randomUUID(), ADMIN, passkey.credentialId, passkey.publicKey, new Date().toISOString());
  followed.close();
  const s = service();
  const challenge = (await s.post({}, "passkey-challenge")).body.options!.challenge;
  const answer = await s.post({
    signIn: { passkey: passkey.assert(challenge, "https://spare.example") },
  });
  expect(answer.body).toEqual({ state: "restarting" });
  expect(answer.setCookie).toMatch(new RegExp(`^${SWITCH_PROOF_COOKIE}=`));
  expect(placed.venue.all(sql`select * from sign_in_challenges`)).toEqual([]);
  const staged = new DatabaseSync(followedVenue(), { readOnly: true });
  expect(staged.prepare("select * from sign_in_challenges").all()).toEqual([]);
  staged.close();
  await restarted(s);
});

it.each([
  ["accepts this box's proof in place of a password", true, { state: "restarting" }],
  [
    "refuses a proof whose person the followed copy has suspended",
    false,
    { error: { code: "password.invalid" } },
  ],
] as const)("the take %s", async (_name, valid, expected) => {
  const proof = await makeSwitchProof(
    { db: placed.venue, node: placed.node, ring, nodeId: standby.nodeId },
    ADMIN,
  );
  if (!valid) {
    const followed = new DatabaseSync(followedVenue());
    followed.prepare("update persons set status = 'suspended' where id = ?").run(ADMIN);
    followed.close();
  }
  const s = service();
  const answer = await s.post({}, "followed", { cookie: `${SWITCH_PROOF_COOKIE}=${proof}` });
  expect(answer.body).toMatchObject(expected);
  await restarted(s);
});

it.each([
  ["a passkey whose challenge", "passkey.challenge_expired"],
  ["a proof that", "password.invalid"],
] as const)(
  "a take that waited while catching up refuses %s has lapsed before it stops following",
  async (credential, code) => {
    const seen = progress({ uploadedTXID: "00000000000000b2" });
    const s = service({ progress: seen });
    const challenge = (await s.post({}, "passkey-challenge")).body.options!.challenge;
    const proof = await makeSwitchProof(
      { db: placed.venue, node: placed.node, ring, nodeId: standby.nodeId },
      ADMIN,
    );
    const [body, headers] = credential.includes("passkey")
      ? [
          {
            signIn: {
              passkey: signingPasskey("spare.example").assert(challenge, "https://spare.example"),
            },
          },
          {},
        ]
      : [{}, { cookie: `${SWITCH_PROOF_COOKIE}=${proof}` }];
    expect((await s.post(body, "followed", headers)).body).toEqual({ state: "catching-up" });
    vi.setSystemTime(Date.now() + 15 * 60_000);
    seen.uploadedTXID = seen.appliedTXID;
    expect((await s.post(body, "followed", headers)).body.error?.code).toBe(code);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.stopForSwitch).not.toHaveBeenCalled();
    expect(s.restart).not.toHaveBeenCalled();
    expect(await readTakeFailures(placed.node, standby.nodeId)).toBeNull();
    await expect(readFile(readyFile())).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("answers taken without stopping when the placed copy is at the follower's position", async () => {
  await marker("placed.json", "followed-copy", followedCopyId(POSITION));
  const s = service({ progress: progress() });
  expect((await s.take()).body).toEqual({ state: "taken" });
  expect(s.stopForSwitch).not.toHaveBeenCalled();
  expect(s.restart).not.toHaveBeenCalled();
});

it.each([null, progress({ state: "rebuilding", appliedTXID: null })])(
  "answers taken without stopping when the follower is rebuilding after the take's own restart %#",
  async (rebuilding) => {
    await marker("placed.json", "followed-copy", followedCopyId(POSITION));
    const s = service({ progress: rebuilding });
    expect((await s.take()).body).toEqual({ state: "taken" });
    expect(s.stopForSwitch).not.toHaveBeenCalled();
  },
);

it("takes a newer copy when the placed copy is behind a caught-up follower", async () => {
  await marker("placed.json", "followed-copy", followedCopyId(POSITION));
  const s = service({
    progress: progress({ appliedTXID: "00000000000000b2", uploadedTXID: "00000000000000b2" }),
  });
  expect((await s.take()).body).toEqual({ state: "restarting" });
  expect(s.stopForSwitch).toHaveBeenCalledOnce();
  await restarted(s);
});

it("a second press while the first is staged answers restarting and stops nothing", async () => {
  const s = service();
  const [first, second] = await Promise.all([s.take(), s.take()]);
  expect([first.body, second.body]).toEqual([{ state: "restarting" }, { state: "restarting" }]);
  expect(s.stopForSwitch).toHaveBeenCalledOnce();
  await restarted(s);
});

it.each([null, progress({ state: "rebuilding", appliedTXID: null })])(
  "a rebuilding follower answers catching-up at once and is not stopped %#",
  async (rebuilding) => {
    external.restriction = { kind: "superseded" };
    const s = service({ progress: rebuilding });
    expect((await s.take()).body).toEqual({ state: "catching-up" });
    expect(s.stopForSwitch).not.toHaveBeenCalled();
    expect(s.asked).not.toHaveBeenCalled();
    await expect(readFile(readyFile())).rejects.toMatchObject({ code: "ENOENT" });
    expect(s.restart).not.toHaveBeenCalled();
  },
);

it("a following follower last seen behind answers catching-up without asking the main box or stopping", async () => {
  external.restriction = { kind: "superseded" };
  const s = service({ progress: progress({ uploadedTXID: "00000000000000b2" }) });
  expect((await s.take()).body).toEqual({ state: "catching-up" });
  expect(s.stopForSwitch).not.toHaveBeenCalled();
  expect(s.asked).not.toHaveBeenCalled();
  expect(s.restart).not.toHaveBeenCalled();
});

it("a follower found behind at the stop's own look answers catching-up without restarting", async () => {
  const s = service({ catchingUp: true });
  expect((await s.take()).body).toEqual({ state: "catching-up" });
  expect(s.stopForSwitch).toHaveBeenCalledOnce();
  expect(s.restart).not.toHaveBeenCalled();
});

it("a failure inside the stop after it has stopped the follower restarts the box", async () => {
  const s = service({ failsAfterStop: true });
  expect((await s.take()).body.error?.code).toBe("handover.copy_damaged");
  await restarted(s);
});

it("signs in only after staging, so the staged copy is the followed output as it stopped", async () => {
  const atStop = await readFile(followedVenue());
  const s = service();
  expect((await s.take()).body).toEqual({ state: "restarting" });
  const staged = join(dirs().spareState, PAIR_COPY_DIR, VENUE_FILE);
  expect((await readFile(staged)).equals(atStop)).toBe(true);
  const copy = new DatabaseSync(staged, { readOnly: true });
  expect(copy.prepare("select count(*) as n from dashboard_sessions").get()).toEqual({ n: 0 });
  const historyBefore = copy.prepare("select count(*) as n from activity_log").get() as {
    n: number;
  };
  copy.close();
  const followed = new DatabaseSync(followedVenue(), { readOnly: true });
  expect(followed.prepare("select count(*) as n from dashboard_sessions").get()).toEqual({ n: 0 });
  expect(followed.prepare("select count(*) as n from activity_log").get()).toEqual({
    n: historyBefore.n + 2,
  });
  followed.close();
  await restarted(s);
});

it("a refused sign-in keeps its code when the failure count cannot be written", async () => {
  placed.node.run(
    sql.raw(`create trigger refuse_count before insert on node_take_failures
      begin select raise(abort, 'synthetic refusal'); end`),
  );
  const s = service();
  expect((await s.take({ ...signIn, password: "wrong" })).body.error?.code).toBe(
    "password.invalid",
  );
  await restarted(s);
});

it("a successful take still restarts with the copy staged when the failure count cannot be cleared", async () => {
  const refused = service();
  expect((await refused.take({ ...signIn, password: "wrong" })).body.error?.code).toBe(
    "password.invalid",
  );
  await restarted(refused);
  placed.node.run(
    sql.raw(`create trigger refuse_clear before delete on node_take_failures
      begin select raise(abort, 'synthetic refusal'); end`),
  );
  const log = vi.fn<Logger>();
  const s = service({ log });
  expect((await s.take()).body).toEqual({ state: "restarting" });
  expect(JSON.parse(await readFile(readyFile(), "utf8"))).toEqual({
    source: "followed-copy",
    sourceId: followedCopyId(POSITION),
  });
  expect((await readTakeFailures(placed.node, standby.nodeId))?.failures).toBe(1);
  expect(log).toHaveBeenCalledWith("warn", "handover.take_failures_not_cleared", {
    errorCode: expect.any(String),
  });
  await restarted(s);
});

it("refuses while the main box answers, before touching the follower", async () => {
  external.restriction = { kind: "superseded" };
  const s = service();
  expect((await s.take()).body.error?.code).toBe("handover.source_still_answering");
  expect(s.stopForSwitch).not.toHaveBeenCalled();
  expect(s.restart).not.toHaveBeenCalled();
});

it("refuses while a handover operation is open", async () => {
  await beginHandover(
    { node: placed.node, nodeId: standby.nodeId },
    {
      operationId: OPERATION,
      scenario: "controlled",
      venue: { country: "ES", taxId: "89890001K", environment: "preproduction" },
      sourceNodeId: primary.nodeId,
      destinationNodeId: standby.nodeId,
      membership: { term: 1, digest: "a".repeat(64) },
    },
    "destination",
  );
  const s = service();
  expect((await s.take()).body.error?.code).toBe("handover.controlled_unresolved");
  expect(s.stopForSwitch).not.toHaveBeenCalled();
});

it.each(["ready.json", "placed.json"] as const)(
  "does nothing when a backup was chosen (%s)",
  async (file) => {
    await marker(file, "selected-backup", "b".repeat(64));
    const s = service();
    expect((await s.take()).body).toEqual({ state: "taken" });
    expect(s.stopForSwitch).not.toHaveBeenCalled();
    expect(s.restart).not.toHaveBeenCalled();
  },
);

it("wrong sign-ins at the limit are refused before the follower is stopped, across restarts", async () => {
  let refusedAt = 0;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const s = service();
    const answer = await s.take({ ...signIn, password: "wrong" });
    if (answer.body.error?.code === "password.throttled") {
      expect(s.stopForSwitch).not.toHaveBeenCalled();
      expect(s.restart).not.toHaveBeenCalled();
      refusedAt = attempt;
      break;
    }
    expect(answer.body.error?.code).toBe("password.invalid");
    await restarted(s);
  }
  expect(refusedAt).toBe(5);
  expect((await readTakeFailures(placed.node, standby.nodeId))?.failures).toBe(4);
  vi.setSystemTime(Date.now() + 61_000);
  const s = service();
  expect((await s.take()).body).toEqual({ state: "restarting" });
  expect(await readTakeFailures(placed.node, standby.nodeId)).toBeNull();
});

it("a damaged followed copy is refused and the box restarts", async () => {
  await writeFile(followedVenue(), "not a database");
  const s = service();
  expect((await s.take()).body.error?.code).toBe("handover.copy_damaged");
  await expect(readFile(readyFile())).rejects.toMatchObject({ code: "ENOENT" });
  await restarted(s);
});

it("a failure while copying restarts too", async () => {
  copying.fail = true;
  const s = service();
  expect((await s.take()).status).toBe(500);
  await restarted(s);
});

it("after placement, preview reports the followed copy and declare records it", async () => {
  const s = service();
  expect((await s.take()).body).toEqual({ state: "restarting" });
  await restarted(s);
  await placed.close();
  expect(
    await placeFirstCopy({
      stateDir: dirs().spareState,
      venueDir: dirs().spareVenue,
      nodeId: standby.nodeId,
      log: () => {},
    }),
  ).toBe(true);
  placed = await openVenueDatabase(dirs().spareVenue);
  const resumed = service();
  const shown = await resumed.post({ signIn }, "preview");
  expect(shown.body.copy).toMatchObject({
    source: "followed-copy",
    sourceId: followedCopyId(POSITION),
  });
  const declared = await resumed.post(
    {
      operationId: OPERATION,
      expectedCopy: shown.body.copy,
      signIn,
      statements: { sourceSwitchedOff: true, noParallelRecovery: true, missingTailAccepted: true },
      reason: "Synthetic lost source",
      locale: "en",
    },
    "declare",
  );
  expect(declared.status).toBe(200);
  expect(declared.body.declaration?.body.lastCopy).toEqual(shown.body.copy);
});

it("a refused newer take keeps the placed copy's provenance and discards only what it staged", async () => {
  const first = service();
  expect((await first.take()).body).toEqual({ state: "restarting" });
  await restarted(first);
  await placed.close();
  await placeFirstCopy({
    stateDir: dirs().spareState,
    venueDir: dirs().spareVenue,
    nodeId: standby.nodeId,
    log: () => {},
  });
  placed = await openVenueDatabase(dirs().spareVenue);
  const newer = service({
    progress: progress({ appliedTXID: "00000000000000b2", uploadedTXID: "00000000000000b2" }),
  });
  expect((await newer.take({ ...signIn, password: "wrong" })).body.error?.code).toBe(
    "password.invalid",
  );
  await restarted(newer);
  expect(await readdir(join(dirs().spareState, PAIR_COPY_DIR))).toEqual(["placed.json"]);
  const shown = await service().post({ signIn }, "preview");
  expect(shown.body.copy).toMatchObject({
    source: "followed-copy",
    sourceId: followedCopyId(POSITION),
  });
});

it("a refused take with nothing placed before leaves no copy folder", async () => {
  const s = service();
  expect((await s.take({ ...signIn, password: "wrong" })).body.error?.code).toBe(
    "password.invalid",
  );
  await restarted(s);
  await expect(readdir(join(dirs().spareState, PAIR_COPY_DIR))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each([
  ["no sign-in and no proof", undefined, 401, "password.invalid"],
  ["a sign-in that is not an object", "owner", 400, "handover.request_invalid"],
  ["an email that is not text", { email: 1, password: PASSWORD }, 400, "handover.request_invalid"],
  ["no password", { email: ADMIN_EMAIL }, 400, "handover.request_invalid"],
  [
    "a code that is not text",
    { email: ADMIN_EMAIL, password: PASSWORD, totp: 123456 },
    400,
    "handover.request_invalid",
  ],
  ["a passkey that is not an object", { passkey: "answer" }, 400, "handover.request_invalid"],
  ["an empty sign-in", {}, 400, "handover.request_invalid"],
] as const)(
  "refuses %s before the follower is touched",
  async (_name, credentials, status, code) => {
    const s = service();
    const answer = await s.post(credentials === undefined ? {} : { signIn: credentials });
    expect(answer.status).toBe(status);
    expect(answer.body.error?.code).toBe(code);
    expect(s.stopForSwitch).not.toHaveBeenCalled();
    expect(s.asked).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.restart).not.toHaveBeenCalled();
  },
);

it.each([
  ["a copy that fails its checks", "handover.copy_damaged", { failsAfterStop: false }],
  ["a failure inside the stop", "handover.copy_damaged", { failsAfterStop: true }],
] as const)(
  "%s counts toward the limit, which then refuses before the follower is stopped",
  async (_name, code, options) => {
    await writeFile(followedVenue(), "not a database");
    let refusedAt = 0;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const s = service(options);
      const answer = await s.take();
      if (answer.body.error?.code === "password.throttled") {
        expect(s.stopForSwitch).not.toHaveBeenCalled();
        expect(s.restart).not.toHaveBeenCalled();
        refusedAt = attempt;
        break;
      }
      expect(answer.body.error?.code).toBe(code);
      await restarted(s);
    }
    expect(refusedAt).toBe(5);
    expect((await readTakeFailures(placed.node, standby.nodeId))?.failures).toBe(4);
  },
);
