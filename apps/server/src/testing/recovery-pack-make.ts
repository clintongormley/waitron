import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import type { Hono } from "hono";
import { loadKeyRing } from "@waitron/credentials";
import {
  ensureStreamId,
  setNodePublicKey,
  stampDeployment,
  withTransaction,
  type Database,
} from "@waitron/db";
import { seedNode, seedTaxpayer, seedVenue } from "@waitron/db/testing/seed.js";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import type { ProvisionedNode } from "@waitron/module";
import { writeArchiveSettings, type ArchiveSettings } from "../archive-settings.js";
import { writeStreamSettings } from "../stream-host.js";
import { setFreshManagementSignIn } from "./fresh-management-sign-in.js";

/** What the recovery pack route tests seal the bucket and archive settings with. */
export const PACK_RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
export const PACK_BUCKET = {
  region: "eu-west-1",
  bucket: "venue-bucket",
  prefix: "shop/",
  accessKeyId: "AKIASTREAMRECOGNISABLE",
  secretAccessKey: "stream-secret-recognisable-0123456789",
};
export const PACK_ARCHIVES: Omit<ArchiveSettings, "revision"> = {
  enabled: true,
  cloud: false,
  destinations: [{ kind: "s3", id: "bucket", bucket: { ...PACK_BUCKET, prefix: "archives/" } }],
  schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } },
  retention: { count: 7, days: 30 },
  destinationTimeoutMs: 15 * 60 * 1000,
};

/** A venue with a node, a bucket stream and archives, and an administrator freshly signed in. */
export async function seedPackVenue(
  db: Database,
): Promise<{ node: ProvisionedNode; admin: { personId: string; token: string } }> {
  await seedTaxpayer(db);
  await stampDeployment(db, "preproduction");
  await seedVenue(db, { name: "Sala", invoiceLocales: ["es"] });
  const node = { nodeId: await seedNode(db) };
  await setNodePublicKey(db, node.nodeId, "SIGNER_PUBLIC_KEY");
  await withTransaction(db, async (tx) => {
    await ensureStreamId(tx);
    await writeStreamSettings(tx, PACK_RING, PACK_BUCKET, null);
    await writeArchiveSettings(tx, PACK_RING, PACK_ARCHIVES, null);
  });
  const admin = await openManagementSession(db, "admin");
  await withTransaction(db, (tx) => setFreshManagementSignIn(tx, admin.token));
  return { node, admin };
}

export interface PackPostOptions {
  token?: string | null;
  headers?: Record<string, string>;
  tls?: boolean;
  raw?: string;
  stream?: ReadableStream<Uint8Array>;
  signal?: AbortSignal;
}

/** The recovery pack routes' requests, sent as the box's HTTPS listener hands them on. The caller
 * destroys `sockets` after each test. */
export function packRequests(
  app: Hono,
  options: { token: () => string; sockets: TLSSocket[]; host?: string },
) {
  const host = options.host ?? "box.test";
  function post(
    path: string,
    body: unknown,
    {
      token = options.token(),
      headers = {},
      tls = true,
      raw,
      stream,
      signal,
    }: PackPostOptions = {},
  ) {
    const socket = tls ? new TLSSocket(new Socket()) : undefined;
    if (socket) options.sockets.push(socket);
    return app.request(
      `https://${host}${path}`,
      {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(token === null ? {} : { cookie: `waitron_management_session=${token}` }),
          ...headers,
        },
        body: stream ?? raw ?? JSON.stringify(body),
        ...(stream === undefined ? {} : { duplex: "half" }),
      } as RequestInit,
      socket ? { incoming: { socket } } : undefined,
    );
  }
  return {
    post,
    make: (
      newMasterKey = false,
      extra: PackPostOptions = {},
      body: unknown = { locale: "en", newMasterKey },
    ) => post("/api/backup/recovery-pack", body, extra),
    received: (number: number, extra: PackPostOptions = {}) =>
      post(`/api/backup/recovery-pack/${number}/received`, {}, extra),
    status: (token: string | null = options.token()) =>
      app.request("https://box.test/api/backup/recovery-pack", {
        headers: token === null ? {} : { cookie: `waitron_management_session=${token}` },
      }),
  };
}
