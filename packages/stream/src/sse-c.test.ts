import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createBucketClient, type BucketConfig } from "./s3-client.js";
import { prepareBucketEncryption } from "./sse-c.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

type Behavior = {
  getSetting?: number;
  putSetting?: number;
  ignoreKeys?: boolean;
  badBody?: boolean;
  controlStatus?: number;
  alreadyEnabled?: boolean;
  noSettings?: boolean;
  refuseDelete?: boolean;
  otherRule?: boolean;
  dropSettings?: boolean;
  dropRead?: "correct" | "control";
  loseUploadReply?: boolean;
  /** The keyed read sends its headers and part of its body, calls this, and sends no more. */
  stallRead?: () => void;
};

async function provider(behavior: Behavior = {}) {
  const seen: {
    method: string;
    url: string;
    body: string;
    key?: string;
    algorithm?: string;
    md5?: string;
  }[] = [];
  const objects = new Map<string, { body: Buffer; key: string }>();
  let blocked = !behavior.alreadyEnabled;
  const xml = { "content-type": "application/xml" };
  const fail = (res: ServerResponse, status: number) => {
    res.writeHead(status, xml);
    res.end(
      `<Error><Code>${status === 403 ? "AccessDenied" : "InvalidRequest"}</Code><Message>private provider reply</Message></Error>`,
    );
  };
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url!, "http://local");
      const key = req.headers["x-amz-server-side-encryption-customer-key"] as string | undefined;
      seen.push({
        method: req.method!,
        url: req.url!,
        body: body.toString(),
        ...(key === undefined
          ? {}
          : {
              key,
              algorithm: String(req.headers["x-amz-server-side-encryption-customer-algorithm"]),
              md5: String(req.headers["x-amz-server-side-encryption-customer-key-md5"]),
            }),
      });
      if (url.searchParams.has("encryption")) {
        if (req.method === "GET") {
          if (behavior.dropSettings) {
            req.socket.destroy();
            return;
          }
          if (behavior.getSetting !== undefined) return fail(res, behavior.getSetting);
          res.writeHead(200, xml);
          if (behavior.noSettings) {
            res.end("<ServerSideEncryptionConfiguration />");
            return;
          }
          res.end(
            `<ServerSideEncryptionConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>aws:kms</SSEAlgorithm><KMSMasterKeyID>retained-key</KMSMasterKeyID></ApplyServerSideEncryptionByDefault><BucketKeyEnabled>true</BucketKeyEnabled><BlockedEncryptionTypes><EncryptionType>${blocked ? "SSE-C" : "NONE"}</EncryptionType></BlockedEncryptionTypes></Rule>${behavior.otherRule ? "<Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule>" : ""}</ServerSideEncryptionConfiguration>`,
          );
          return;
        }
        if (behavior.putSetting !== undefined) return fail(res, behavior.putSetting);
        blocked = false;
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.method === "PUT") {
        if (blocked) return fail(res, 403);
        if (objects.has(url.pathname) && req.headers["if-none-match"] === "*")
          return fail(res, 412);
        objects.set(url.pathname, { body, key: key! });
        if (behavior.loseUploadReply) {
          req.socket.destroy();
          return;
        }
        res.writeHead(200, { etag: '"encrypted-probe"' });
        res.end();
        return;
      }
      if (req.method === "DELETE") {
        if (behavior.refuseDelete) return fail(res, 403);
        objects.delete(url.pathname);
        res.writeHead(204);
        res.end();
        return;
      }
      const object = objects.get(url.pathname);
      if (!object) return fail(res, 404);
      if (
        (behavior.dropRead === "correct" && key === object.key) ||
        (behavior.dropRead === "control" && key !== object.key)
      ) {
        req.socket.destroy();
        return;
      }
      if (behavior.stallRead && key === object.key) {
        res.writeHead(200, { etag: '"encrypted-probe"', "content-length": "1000" });
        res.write("the first part");
        behavior.stallRead();
        return;
      }
      if (!behavior.ignoreKeys && key !== object.key)
        return fail(res, behavior.controlStatus ?? (key === undefined ? 400 : 403));
      res.writeHead(200, { etag: '"encrypted-probe"' });
      res.end(behavior.badBody ? "wrong object" : object.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const bucket: BucketConfig = {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    region: "us-east-1",
    bucket: "venue-copy",
    prefix: "waitron",
    accessKeyId: "test-access-key",
    secretAccessKey: "not-a-real-secret",
  };
  return { bucket, seen, objects };
}

describe("Save's encryption capability check over the real S3 client", () => {
  it("uses the supplied client for Save instead of creating another client", async () => {
    const unused = await provider();
    const owned = await provider();
    expect(
      await prepareBucketEncryption(unused.bucket, () => createBucketClient(owned.bucket)),
    ).toEqual({ ok: true });
    expect(unused.seen.length).toBe(0);
    expect(owned.seen.length).toBeGreaterThan(0);
  });

  it("unblocks customer keys while preserving the bucket's KMS and bucket-key settings", async () => {
    const { bucket, seen, objects } = await provider();
    expect(await prepareBucketEncryption(bucket)).toEqual({ ok: true });
    const put = seen.find(
      (call) =>
        call.method === "PUT" && new URL(call.url, "http://local").searchParams.has("encryption"),
    )!;
    expect(put.body).toContain("<SSEAlgorithm>aws:kms</SSEAlgorithm>");
    expect(put.body).toContain("<KMSMasterKeyID>retained-key</KMSMasterKeyID>");
    expect(put.body).toContain("<BucketKeyEnabled>true</BucketKeyEnabled>");
    expect(put.body).toContain("<EncryptionType>NONE</EncryptionType>");
    expect(put.body).not.toContain("<EncryptionType>SSE-C</EncryptionType>");
    const writes = seen.filter(
      (call) =>
        call.method === "PUT" && !new URL(call.url, "http://local").searchParams.has("encryption"),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]!.url).toMatch(/^\/venue-copy\/waitron\/waitron-probe\/encryption-/);
    expect(Buffer.from(writes[0]!.key!, "base64")).toHaveLength(32);
    expect(writes[0]!.algorithm).toBe("AES256");
    expect(writes[0]!.md5).toBe(
      createHash("md5").update(Buffer.from(writes[0]!.key!, "base64")).digest("base64"),
    );
    const reads = seen.filter(
      (call) =>
        call.method === "GET" && !new URL(call.url, "http://local").searchParams.has("encryption"),
    );
    expect(reads[0]!.key).toBe(writes[0]!.key);
    expect(Buffer.from(reads[1]!.key!, "base64")).toHaveLength(32);
    expect(reads[1]!.key).not.toBe(writes[0]!.key);
    expect(reads[2]!.key).toBeUndefined();
    expect(
      seen.filter(
        (call) =>
          call.method === "GET" &&
          !new URL(call.url, "http://local").searchParams.has("encryption"),
      ),
    ).toHaveLength(3);
    expect(objects.size).toBe(0);
  });

  it("refuses a provider that accepts but ignores customer keys, and deletes its test object", async () => {
    const { bucket, objects } = await provider({ ignoreKeys: true });
    expect(await prepareBucketEncryption(bucket)).toMatchObject({
      ok: false,
      reason: "encryption_ignored",
    });
    expect(objects.size).toBe(0);
  });

  it.each([403, 501])(
    "an unreadable setting (%s) never causes a blind replacement",
    async (getSetting) => {
      const { bucket, seen } = await provider({ getSetting, alreadyEnabled: true });
      expect(await prepareBucketEncryption(bucket)).toEqual({ ok: true });
      expect(
        seen.some(
          (call) =>
            call.method === "PUT" &&
            new URL(call.url, "http://local").searchParams.has("encryption"),
        ),
      ).toBe(false);
    },
  );

  it("a blocked bucket with no setting permission refuses instead of saving plain copies", async () => {
    const { bucket, seen } = await provider({ getSetting: 403 });
    expect(await prepareBucketEncryption(bucket)).toMatchObject({
      ok: false,
      reason: "encryption_unavailable",
    });
    expect(
      seen.some(
        (call) =>
          call.method === "PUT" && new URL(call.url, "http://local").searchParams.has("encryption"),
      ),
    ).toBe(false);
  });

  it("an already-enabled bucket needs no setting write permission", async () => {
    const { bucket, seen } = await provider({ alreadyEnabled: true, putSetting: 403 });
    expect(await prepareBucketEncryption(bucket)).toEqual({ ok: true });
    expect(
      seen.some(
        (call) =>
          call.method === "PUT" && new URL(call.url, "http://local").searchParams.has("encryption"),
      ),
    ).toBe(false);
  });

  it.each([403, 501])(
    "a refused setting update (%s) cannot bypass the actual keyed upload",
    async (putSetting) => {
      const { bucket, objects } = await provider({ putSetting });
      expect(await prepareBucketEncryption(bucket)).toMatchObject({
        ok: false,
        reason: "encryption_unavailable",
      });
      expect(objects.size).toBe(0);
    },
  );

  it("refuses a keyed read that returns different bytes, then removes the object", async () => {
    const { bucket, objects } = await provider({ badBody: true });
    expect(await prepareBucketEncryption(bucket)).toMatchObject({
      ok: false,
      reason: "encryption_unavailable",
    });
    expect(objects.size).toBe(0);
  });

  it("a settings connection that gives no answer is unreachable, not a provider refusal", async () => {
    const { bucket, seen } = await provider({ dropSettings: true });
    await expect(prepareBucketEncryption(bucket)).rejects.toMatchObject({
      code: "backup.stream_request_failed",
      params: { operation: "get", key: "venue-copy", status: null },
    });
    expect(seen.every((call) => call.method === "GET")).toBe(true);
  });

  it.each(["correct", "control"] as const)(
    "a lost %s read is unreachable and its object is cleaned",
    async (dropRead) => {
      const { bucket, objects } = await provider({ dropRead });
      await expect(prepareBucketEncryption(bucket)).rejects.toMatchObject({
        code: "backup.stream_request_failed",
        params: { operation: "get", status: null },
      });
      expect(objects.size).toBe(0);
    },
  );

  it("cleans an upload whose reply was lost even though Save is refused", async () => {
    const { bucket, objects } = await provider({ loseUploadReply: true });
    expect(await prepareBucketEncryption(bucket)).toMatchObject({
      ok: false,
      reason: "encryption_unavailable",
    });
    expect(objects.size).toBe(0);
  });

  it("preserves another encryption rule when unblocking customer keys", async () => {
    const { bucket, seen } = await provider({ otherRule: true });
    expect(await prepareBucketEncryption(bucket)).toEqual({ ok: true });
    const put = seen.find(
      (call) =>
        call.method === "PUT" && new URL(call.url, "http://local").searchParams.has("encryption"),
    )!;
    expect(put.body).toContain(
      "<Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule>",
    );
  });

  it("uses actual object controls when the settings API returns no rules", async () => {
    const { bucket, seen } = await provider({ alreadyEnabled: true, noSettings: true });
    expect(await prepareBucketEncryption(bucket)).toEqual({ ok: true });
    expect(
      seen.some(
        (call) =>
          call.method === "PUT" && new URL(call.url, "http://local").searchParams.has("encryption"),
      ),
    ).toBe(false);
  });

  it("does not let a refused cleanup hide an ignored-key refusal", async () => {
    const { bucket, objects } = await provider({ ignoreKeys: true, refuseDelete: true });
    expect(await prepareBucketEncryption(bucket)).toMatchObject({
      ok: false,
      reason: "encryption_ignored",
    });
    expect(objects.size).toBe(1);
  });

  it("a missing object is not proof that a wrong key was refused", async () => {
    const { bucket, objects } = await provider({ controlStatus: 404 });
    expect(await prepareBucketEncryption(bucket)).toMatchObject({
      ok: false,
      reason: "encryption_unavailable",
    });
    expect(objects.size).toBe(0);
  });

  it("stops when its signal is cancelled while a read's body stalls after its headers", async () => {
    let headersSent!: () => void;
    const stalled = new Promise<void>((resolve) => (headersSent = resolve));
    const { bucket, seen, objects } = await provider({
      alreadyEnabled: true,
      stallRead: () => headersSent(),
    });
    const controller = new AbortController();
    const ended = prepareBucketEncryption(bucket, undefined, { signal: controller.signal }).then(
      () => "resolved",
      (error: unknown) => error,
    );
    await stalled;
    controller.abort();
    expect(await Promise.race([ended, delay(2_000, "still pending")])).toMatchObject({
      code: "backup.stream_request_failed",
      params: { operation: "get", status: null, name: "AbortError" },
    });
    // The clean-up runs under the same signal, so a cancelled check leaves its object behind.
    expect(seen.some((call) => call.method === "DELETE")).toBe(false);
    expect(objects.size).toBe(1);
  });

  it("sends nothing on a signal already cancelled", async () => {
    const { bucket, seen } = await provider();
    await expect(
      prepareBucketEncryption(bucket, undefined, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({
      code: "backup.stream_request_failed",
      params: { operation: "get", key: "venue-copy", status: null, name: "AbortError" },
    });
    expect(seen).toEqual([]);
  });
});
