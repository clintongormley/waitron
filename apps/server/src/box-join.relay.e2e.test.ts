// A relay between a joining box S and the main box M, both real and started in this process
// (`./testing/spare-join-pair.ts`). The relay presents M's own certificate files, copied from M's
// state folder as a backup holder would, so TLS hides nothing from it; on loopback it shares S's
// address, as a relay that has taken over that address would. Not tested, because it is the
// remaining risk and not a defence: a relay holding M's node key swapping the bundle.
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPairLink } from "@waitron/node-db";
import {
  JOIN_CANCEL_LABEL,
  JOIN_POLL_LABEL,
  JOIN_REVEAL_LABEL,
  joinCode,
  pollMessageFields,
  revealMessageFields,
  signJoinHello,
  signJoinMessage,
  type JoinField,
  type JoinHello,
} from "./box-join-code.js";
import { parseEnvFile } from "./env-file.js";
import { generateStandbyIdentity } from "./reserved-identity.js";
import {
  BOOT_MS,
  joinState,
  managementHeaders,
  readOutside,
} from "./testing/spare-join-scenario.js";
import { JoinPairs, type JoinPair } from "./testing/spare-join-pair.js";

const UNTIMED_MS = 60_000;
// S starts for setup and once after joining; M starts once.
const RELAY_TIMEOUT_MS = 3 * BOOT_MS + UNTIMED_MS;

interface Crossing {
  path: string;
  /** What reached M from the relay, and M's answer, as the relay read them. */
  sent: string;
  status: number;
  answered: string;
}

interface Relay {
  /** At M's own name, as S is given it. */
  url: string;
  /** The same listener at its loopback address, for this test's own requests. */
  loopbackUrl: string;
  crossed: Crossing[];
  close: () => Promise<void>;
}

/** How a relay that holds no key of S's re-signs each signed message after rewriting the hello. */
const RESIGNED: Record<string, (body: Record<string, unknown>) => [string, JoinField[]]> = {
  "/api/node/join/reveal": (b) => [
    JOIN_REVEAL_LABEL,
    revealMessageFields(Buffer.from(b.newNonce as string, "base64")),
  ],
  "/api/node/join/poll": (b) => [JOIN_POLL_LABEL, pollMessageFields(b.at as number)],
  "/api/node/join/cancel": () => [JOIN_CANCEL_LABEL, []],
};

/**
 * Relays every request at its address to M. With `rewriteStore`, it points the hello's store
 * address at itself and signs the hello and every later message with a key of its own; with
 * `holdCancel` too, it answers S's cancel itself and M never hears it.
 */
async function startRelay(
  pair: JoinPair,
  options: { rewriteStore?: boolean; holdCancel?: boolean } = {},
): Promise<Relay> {
  const pem = await readFile(join(pair.dirsM.state, "tls", "server.pem"));
  const own = generateStandbyIdentity();
  const crossed: Crossing[] = [];
  let port = 0;
  const rewrite = (path: string, text: string): string => {
    if (!options.rewriteStore || text === "") return text;
    const body = JSON.parse(text) as Record<string, unknown>;
    if (path === "/api/node/join/hello") {
      const store = new URL(body.storeUrl as string);
      store.port = String(port);
      const hello = { ...body, storeUrl: store.origin, newPublicKey: own.publicKey };
      const signature = signJoinHello(
        hello as unknown as JoinHello,
        body.at as number,
        own.privateKey,
      );
      return JSON.stringify({ ...hello, signature });
    }
    const fields = RESIGNED[path]?.(body);
    if (fields === undefined) return text;
    const signature = signJoinMessage(
      fields[0],
      body.requestId as string,
      body.seq as number,
      fields[1],
      own.privateKey,
    );
    return JSON.stringify({ ...body, signature });
  };
  const server: Server = createServer({ key: pem, cert: pem }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        const path = req.url ?? "/";
        if (options.holdCancel && path === "/api/node/join/cancel") {
          res.writeHead(200, { "content-type": "application/json" }).end("{}");
          return;
        }
        const sent = rewrite(path, Buffer.concat(chunks).toString("utf8"));
        const forwarded = await fetch(`${pair.urlM}${path}`, {
          ...pair.viaM,
          method: req.method ?? "GET",
          headers: { "content-type": req.headers["content-type"] ?? "application/json" },
          ...(req.method === "GET" ? {} : { body: sent }),
        });
        const answered = await forwarded.text();
        crossed.push({ path, sent, status: forwarded.status, answered });
        res
          .writeHead(forwarded.status, {
            "content-type": forwarded.headers.get("content-type") ?? "text/plain",
          })
          .end(answered);
      })().catch((error: unknown) => res.writeHead(502).end(String(error)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  const url = new URL(pair.primaryUrl);
  url.port = String(port);
  return {
    url: url.origin,
    loopbackUrl: `https://127.0.0.1:${port}`,
    crossed,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The text of every crossing, and of every base64 string inside its JSON, as a reader sees it. */
function readableText(crossed: readonly Crossing[]): string {
  const texts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") texts.push(value, Buffer.from(value, "base64").toString("utf8"));
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
  };
  for (const { sent, answered } of crossed)
    for (const text of [sent, answered]) {
      texts.push(text);
      try {
        walk(JSON.parse(text));
      } catch {
        // Not JSON: its text is already read.
      }
    }
  return texts.join("\n");
}

/** M's recovery key, which the bundle carries in its `backupSettings`. */
async function recoveryKeyOf(pair: JoinPair): Promise<string> {
  const settings = parseEnvFile(await readFile(join(pair.dirsM.state, "backup.env"), "utf8"));
  expect(settings.WAITRON_BACKUP_RECOVERY_KEY).toEqual(expect.any(String));
  return settings.WAITRON_BACKUP_RECOVERY_KEY!;
}

/**
 * Which of the bundle's secrets appear in `text`: `PRIVATE KEY`, each base64 line of M's
 * certificate authority key, and M's recovery key.
 */
async function bundleSecretsIn(pair: JoinPair, text: string): Promise<string[]> {
  const pem = await readFile(join(pair.dirsM.state, "tls", "ca.key"), "utf8");
  const lines = pem.split(/\r?\n/).filter((l) => l !== "" && !l.startsWith("-"));
  expect(lines.length).toBeGreaterThan(1);
  const parts = ["PRIVATE KEY", ...lines, await recoveryKeyOf(pair)];
  return parts.filter((part) => text.includes(part));
}

const crossingTo = (relay: Relay, path: string) =>
  relay.crossed.find((c) => c.path === `/api/node/join/${path}`);

describe("a relay between a joining box and the main box", () => {
  const pairs = new JoinPairs();
  const relays: Relay[] = [];

  beforeAll(() => pairs.open("waitron-join-relay-"));

  afterAll(async () => {
    for (const relay of relays) await relay.close();
    const failures = await pairs.close();
    if (failures.length > 0) throw new AggregateError(failures, "join relay teardown failed");
  });

  it(
    "a relay holding the main box's certificate files carries a finished join and reads neither the main box's certificate authority key nor its recovery key",
    async () => {
      const pair = await pairs.start("pure", "preproduction", undefined);
      const relay = await startRelay(pair);
      relays.push(relay);
      const joined = await pair.adopt(relay.url);
      expect(joined.status, JSON.stringify(joined.body)).toBe(200);
      expect(joined.body).toMatchObject({ adopted: true, restarting: true });
      // The locked bundle crossed the relay.
      const approved = relay.crossed.filter((c) => c.answered.includes('"state":"approved"'));
      expect(approved.length).toBeGreaterThan(0);
      expect(await bundleSecretsIn(pair, readableText(relay.crossed))).toEqual([]);

      // Control, a stand-in rather than the lock switched off: the test sends through the same
      // relay what the approve route would carry with no lock, the bundle's JSON in base64 where
      // the ciphertext goes (`box-join-api.ts`'s `lockJoinBundle` call), with the two secrets.
      const caKeyPem = await readFile(join(pair.dirsM.state, "tls", "ca.key"), "utf8");
      const recoveryKey = await recoveryKeyOf(pair);
      const unlocked = Buffer.from(
        JSON.stringify({
          boxCaKeyPem: caKeyPem,
          backupSettings: { WAITRON_BACKUP_RECOVERY_KEY: recoveryKey },
        }),
      ).toString("base64");
      const sent = await fetch(`${relay.loopbackUrl}/api/node/join/poll`, {
        ...pair.viaM,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "approved", locked: { ciphertext: unlocked } }),
      });
      await sent.arrayBuffer();
      const found = await bundleSecretsIn(pair, readableText(relay.crossed));
      expect(found).toContain("PRIVATE KEY");
      expect(found).toContain(recoveryKey);
      expect(found.length).toBeGreaterThan(2);
    },
    RELAY_TIMEOUT_MS,
  );

  it(
    // The store address's own guard is "signs the reveal answer over every hello field, Nn and Nm" in box-join-api.test.ts.
    "a relay that rewrites the hello and signs it with its own key is refused by the new box at reveal, and the main box writes no pair link",
    async () => {
      const pair = await pairs.start("rewrite", "preproduction", undefined);
      const relay = await startRelay(pair, { rewriteStore: true });
      relays.push(relay);
      const before = await joinState(pair.dirsM.venue, pair.m.nodeId);
      const refused = await pair.adopt(relay.url);
      expect(refused.status, JSON.stringify(refused.body)).toBe(400);
      expect(refused.body).toEqual({ error: { code: "mirror.join_invalid", params: {} } });
      // M took the rewritten hello and answered the reveal: the refusal is S's own.
      const hello = JSON.parse(crossingTo(relay, "hello")!.sent) as { storeUrl: string };
      expect(new URL(hello.storeUrl).port).toBe(new URL(relay.url).port);
      expect(crossingTo(relay, "reveal")!.status).toBe(200);
      // S's start answers once its cancel is answered, so M has ended the request.
      expect(crossingTo(relay, "cancel")!.status).toBe(200);
      const managing = await managementHeaders(pair.urlM, pair.boxM.origin, pair.viaM);
      const servers = await fetch(`${pair.urlM}/management-api/servers`, {
        ...pair.viaM,
        headers: { ...managing, origin: pair.urlM },
      });
      expect(((await servers.json()) as { joinRequests: unknown[] }).joinRequests).toEqual([]);
      expect(await joinState(pair.dirsM.venue, pair.m.nodeId)).toEqual(before);
    },
    RELAY_TIMEOUT_MS,
  );

  it(
    "control: with the new box's cancel held and the main box's code tapped, the rewritten store address reaches the main box's pair link",
    async () => {
      const pair = await pairs.start("tapped", "preproduction", undefined);
      const relay = await startRelay(pair, { rewriteStore: true, holdCancel: true });
      relays.push(relay);
      const refused = await pair.adopt(relay.url);
      expect(refused.body).toEqual({ error: { code: "mirror.join_invalid", params: {} } });
      // The code M shows, worked out from what crossed the relay.
      const hello = JSON.parse(crossingTo(relay, "hello")!.sent) as JoinHello;
      const opened = JSON.parse(crossingTo(relay, "hello")!.answered) as Record<string, string>;
      const reveal = JSON.parse(crossingTo(relay, "reveal")!.sent) as { newNonce: string };
      const revealed = JSON.parse(crossingTo(relay, "reveal")!.answered) as { mainNonce: string };
      const code = joinCode({
        ...hello,
        mainNodeId: opened.mainNodeId!,
        mainPublicKey: opened.mainPublicKey!,
        requestId: opened.requestId!,
        newNonce: Buffer.from(reveal.newNonce, "base64"),
        mainNonce: Buffer.from(revealed.mainNonce, "base64"),
      });
      const managing = await managementHeaders(pair.urlM, pair.boxM.origin, pair.viaM);
      const approved = await fetch(
        `${pair.urlM}/management-api/box-joins/${opened.requestId!}/approve`,
        {
          ...pair.viaM,
          method: "POST",
          headers: { ...managing, origin: pair.urlM },
          body: JSON.stringify({ code }),
        },
      );
      expect(approved.status, await approved.text()).toBe(202);
      const link = await readOutside(pair.dirsM.venue, (store) =>
        readPairLink(store.node, pair.m.nodeId),
      );
      expect(link?.storeUrl).toBe(hello.storeUrl);
      expect(new URL(link!.storeUrl).port).toBe(new URL(relay.url).port);
    },
    RELAY_TIMEOUT_MS,
  );
});
