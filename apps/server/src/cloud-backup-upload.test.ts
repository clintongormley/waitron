import { it, expect } from "vitest";
import { createServer } from "node:https";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { uploadCloudCapture } from "./cloud-backup-upload.js";
import type { CloudCaptureGrant } from "./cloud-backup.js";
it("uploads with capture credentials and a conditional PUT; retries need no read permission", async () => {
  const tls = mintSelfSignedServerCert({
    hostnames: ["localhost"],
    ipAddresses: ["127.0.0.1"],
    now: new Date(),
  });
  let status = 200;
  const seen: {
    method?: string;
    path?: string;
    body: Buffer;
    authorization?: string;
    token?: string;
    condition?: string;
  }[] = [];
  const server = createServer(
    { key: tls.serverKeyPem, cert: tls.serverCertPem },
    async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      seen.push({
        method: req.method,
        path: req.url,
        body: Buffer.concat(chunks),
        authorization: req.headers.authorization,
        token: String(req.headers["x-amz-security-token"]),
        condition: String(req.headers["if-none-match"]),
      });
      res.writeHead(status);
      res.end(status === 200 ? "" : "<Error><Code>Refused</Code></Error>");
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const id = randomUUID(),
    bytes = Buffer.from("encrypted archive"),
    g: CloudCaptureGrant = {
      id,
      installationId: randomUUID(),
      venueId: randomUUID(),
      keyVersion: 1,
      location: {
        endpoint: `https://127.0.0.1:${(server.address() as { port: number }).port}`,
        bucket: "venue-one",
        region: "local",
      },
      incomingKey: "incoming/" + id,
      recoveryKey: randomBytes(32).toString("base64url"),
      credentials: {
        accessKeyId: "upload-id",
        secretAccessKey: "upload-secret",
        sessionToken: "upload-token",
      },
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    };
  try {
    const result = await uploadCloudCapture(g, bytes, { ca: tls.caCertPem });
    expect(result).toEqual({
      digest: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    });
    expect(seen[0]).toMatchObject({
      method: "PUT",
      path: expect.stringContaining("/venue-one/incoming/" + id),
      body: bytes,
      authorization: expect.stringContaining("upload-id/"),
      token: "upload-token",
      condition: "*",
    });
    status = 412;
    expect(await uploadCloudCapture(g, bytes, { ca: tls.caCertPem })).toEqual(result);
    expect(seen.map((v) => v.method)).toEqual(["PUT", "PUT"]);
    status = 403;
    await expect(uploadCloudCapture(g, bytes, { ca: tls.caCertPem })).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const n = seen.length;
    await expect(
      uploadCloudCapture({ ...g, expiresAt: new Date(0).toISOString() }, bytes, {
        ca: tls.caCertPem,
      }),
    ).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(seen).toHaveLength(n);
    await expect(uploadCloudCapture(g, bytes)).rejects.toMatchObject({ code: "cloud.unavailable" });
    const c = new AbortController();
    c.abort();
    await expect(
      uploadCloudCapture(g, bytes, { ca: tls.caCertPem, signal: c.signal }),
    ).rejects.toMatchObject({ code: "cloud.unavailable" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});
it("refuses HTTP before sending upload credentials to a listening server", async () => {
  const { createServer: plainServer } = await import("node:http");
  let requests = 0;
  const server = plainServer((req, res) => {
    requests++;
    req.resume();
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const id = randomUUID(),
    g: CloudCaptureGrant = {
      id,
      installationId: randomUUID(),
      venueId: randomUUID(),
      keyVersion: 1,
      location: {
        endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        bucket: "venue-one",
        region: "local",
      },
      incomingKey: "incoming/" + id,
      recoveryKey: randomBytes(32).toString("base64url"),
      credentials: { accessKeyId: "upload", secretAccessKey: "secret", sessionToken: "token" },
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    };
  try {
    await expect(uploadCloudCapture(g, Buffer.from("archive"))).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    expect(requests).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});
it("streams a durable archive, checks its receipt, and aborts a stalled transfer", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path");
  const { uploadCloudCaptureFile } = await import("./cloud-backup-upload.js");
  const root = await mkdtemp(join(tmpdir(), "cloud-upload-")),
    path = join(root, "archive.enc"),
    bytes = randomBytes(1024 * 1024);
  await writeFile(path, bytes);
  const receipt = { size: bytes.length, digest: createHash("sha256").update(bytes).digest("hex") };
  const tls = mintSelfSignedServerCert({
    hostnames: ["localhost"],
    ipAddresses: ["127.0.0.1"],
    now: new Date(),
  });
  let requests = 0,
    stall = false;
  const bodies: Buffer[] = [];
  const server = createServer(
    { key: tls.serverKeyPem, cert: tls.serverCertPem },
    async (req, res) => {
      requests++;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      bodies.push(Buffer.concat(chunks));
      if (!stall) res.end();
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const id = randomUUID();
  const grant: CloudCaptureGrant = {
    id,
    installationId: randomUUID(),
    venueId: randomUUID(),
    keyVersion: 1,
    location: {
      endpoint: `https://127.0.0.1:${(server.address() as { port: number }).port}`,
      bucket: "venue",
      region: "local",
    },
    incomingKey: "incoming/" + id,
    recoveryKey: "key",
    credentials: { accessKeyId: "id", secretAccessKey: "secret", sessionToken: "token" },
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  };
  try {
    expect(await uploadCloudCaptureFile(grant, path, receipt, { ca: tls.caCertPem })).toEqual(
      receipt,
    );
    expect(bodies[0]).toEqual(bytes);
    await expect(
      uploadCloudCaptureFile(
        grant,
        path,
        { ...receipt, digest: "0".repeat(64) },
        { ca: tls.caCertPem },
      ),
    ).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(requests).toBe(1);
    await expect(
      uploadCloudCaptureFile(
        grant,
        path,
        { ...receipt, size: receipt.size + 1 },
        { ca: tls.caCertPem },
      ),
    ).rejects.toMatchObject({ code: "cloud.unavailable" });
    await expect(
      uploadCloudCaptureFile(
        { ...grant, expiresAt: new Date(Date.now() + 1000).toISOString() },
        path,
        receipt,
        { ca: tls.caCertPem },
      ),
    ).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(requests).toBe(1);

    stall = true;
    const c = new AbortController();
    const uploading = uploadCloudCaptureFile(grant, path, receipt, {
      ca: tls.caCertPem,
      signal: c.signal,
    });
    const refusing = expect(uploading).rejects.toMatchObject({ code: "cloud.unavailable" });
    await new Promise((r) => setTimeout(r, 100));
    c.abort();
    await refusing;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
it("allows a throttled upload acknowledgement beyond the old thirty-second deadline", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    { setTimeout: delay } = await import("node:timers/promises");
  const { uploadCloudCaptureFile } = await import("./cloud-backup-upload.js");
  const root = await mkdtemp(join(tmpdir(), "cloud-slow-upload-")),
    path = join(root, "archive.enc"),
    bytes = randomBytes(1024 * 1024);
  await writeFile(path, bytes);
  const receipt = { size: bytes.length, digest: createHash("sha256").update(bytes).digest("hex") };
  const tls = mintSelfSignedServerCert({
    hostnames: ["localhost"],
    ipAddresses: ["127.0.0.1"],
    now: new Date(),
  });
  let received: Buffer | undefined;
  const server = createServer(
    { key: tls.serverKeyPem, cert: tls.serverCertPem },
    async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received = Buffer.concat(chunks);
      await delay(31000);
      res.end();
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const id = randomUUID();
  const grant: CloudCaptureGrant = {
    id,
    installationId: randomUUID(),
    venueId: randomUUID(),
    keyVersion: 1,
    location: {
      endpoint: `https://127.0.0.1:${(server.address() as { port: number }).port}`,
      bucket: "venue",
      region: "local",
    },
    incomingKey: "incoming/" + id,
    recoveryKey: "key",
    credentials: { accessKeyId: "id", secretAccessKey: "secret", sessionToken: "token" },
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  };
  try {
    const start = Date.now();
    expect(await uploadCloudCaptureFile(grant, path, receipt, { ca: tls.caCertPem })).toEqual(
      receipt,
    );
    expect(Date.now() - start).toBeGreaterThanOrEqual(30000);
    expect(received).toEqual(bytes);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
}, 45000);
