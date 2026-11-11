import { expect, it, vi, afterEach, onTestFinished } from "vitest";
import { readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash, X509Certificate } from "node:crypto";
import { createServer } from "node:https";
import { connect } from "node:tls";
import { watchTlsFiles } from "./tls.js";
import forge from "node-forge";
import { installationFixture } from "../test/cloud-installation-fixture.js";

const hostname = "staff.sol.example.test";

it("submits only the box CSR with its signed installation proof and installs the matching chain", async () => {
  const f = await fixture();

  f.ready();
  await f.pass();
  const body = f.calls.find((call) => call.action === "staff-certificate-submit")!.body;
  expect(body).toEqual({
    version: 1,
    hostname,
    revision: 0,
    csr: expect.any(String),
    previousRequestId: null,
  });
  expect(body.csr).not.toContain("PRIVATE KEY");
  expect(forge.pki.certificationRequestFromPem(String(body.csr)).verify()).toBe(true);
  expect(new X509Certificate(await f.readChain()).checkHost(hostname)).toBe(hostname);
  expect(f.calls).toHaveLength(2);
  await f.pass();
  expect(f.calls).toHaveLength(2);
});

afterEach(() => {
  vi.useRealTimers();
});

async function fixture() {
  let patch: Record<string, unknown> = {},
    discoveryPatch: Record<string, unknown> = {};
  let lose = false,
    loseBefore = false,
    ready = false,
    revision = 0,
    days = 90;
  let original: { id: string; body: Record<string, unknown> } | undefined,
    certificate: string | undefined;
  const calls: { action: string; operationId: string; body: Record<string, unknown> }[] = [];
  let response: { status: number; body: string | Buffer } | undefined;
  let waiting = async () => {};
  const f = await installationFixture(undefined, {
    staffCertificate: async (v, saved, req, res) => {
      expect(req.url).toBe(`/api/installations/${v[2]}`);
      expect(v[6]).toBe(JSON.stringify((saved.lifecycle as { lease: unknown }).lease));
      await waiting();
      if (response) {
        res.writeHead(response.status);
        res.end(response.body);
        return;
      }
      const action = String(v[2]),
        body = JSON.parse(String(v[7]));
      calls.push({ action, operationId: String(v[4]), body });
      res.setHeader("content-type", "application/json");
      const digest = () => createHash("sha256").update(String(original!.body.csr)).digest("hex");
      if (action === "staff-certificate-status" && body.requestId === null) {
        res.end(
          JSON.stringify({
            version: 1,
            installationId: v[3],
            hostname,
            revision,
            request: original
              ? {
                  requestId: original.id,
                  hostname: original.body.hostname,
                  revision: original.body.revision,
                  csrDigest: digest(),
                }
              : null,
            ...discoveryPatch,
          }),
        );
        return;
      }
      if (action === "staff-certificate-submit") {
        if (loseBefore) {
          loseBefore = false;
          req.socket.destroy();
          return;
        }
        if (
          body.revision !== revision ||
          (original?.id !== v[4] && body.previousRequestId !== (original?.id ?? null))
        ) {
          res.writeHead(409);
          res.end('{"error":"conflict"}');
          return;
        }
        if (original?.id !== v[4]) {
          original = { id: String(v[4]), body };
          certificate = undefined;
        } else expect(body).toEqual(original!.body);
        if (lose) {
          lose = false;
          req.socket.destroy();
          return;
        }
      } else if (
        !original ||
        body.requestId !== original.id ||
        original.body.revision !== revision
      ) {
        res.writeHead(409);
        res.end('{"error":"conflict"}');
        return;
      }
      const csr = String(original!.body.csr);
      if (ready && certificate === undefined) {
        const request = forge.pki.certificationRequestFromPem(csr);
        const key = forge.pki.privateKeyFromPem(
          await readFile(join(f.stateDir, "cloud/staff.key"), "utf8"),
        );
        const cert = forge.pki.createCertificate();
        cert.publicKey = request.publicKey!;
        cert.serialNumber = String(calls.length).padStart(2, "0");
        cert.validity.notBefore = new Date(Date.now() - 1000);
        cert.validity.notAfter = new Date(Date.now() + days * 86400000);
        cert.setSubject([{ name: "commonName", value: hostname }]);
        cert.setIssuer(cert.subject.attributes);
        cert.setExtensions([{ name: "subjectAltName", altNames: [{ type: 2, value: hostname }] }]);
        cert.sign(key, forge.md.sha256.create());
        certificate = forge.pki.certificateToPem(cert);
      }
      res.end(
        JSON.stringify({
          version: 1,
          installationId: v[3],
          requestId: original!.id,
          hostname,
          revision: original!.body.revision,
          csrDigest: digest(),
          state: ready ? "ready" : "pending",
          ...(ready && certificate ? { certificate } : {}),
          ...patch,
        }),
      );
    },
  });
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= f.close());
  onTestFinished(close);
  return {
    ...f,
    close,
    pass: (signal?: AbortSignal) => f.client.staffCertificate(hostname, signal),
    readKey: () => readFile(join(f.stateDir, "cloud/staff.key"), "utf8"),
    readChain: () => readFile(join(f.stateDir, "cloud/staff.crt"), "utf8"),
    submits: () => calls.filter((call) => call.action === "staff-certificate-submit"),
    calls,
    hold: (fn: () => Promise<void>) => {
      waiting = fn;
    },
    respond: (status: number, body: string | Buffer) => {
      response = { status, body };
    },
    ready: () => {
      ready = true;
      certificate = undefined;
    },
    pause: () => {
      ready = false;
    },
    lose: () => {
      lose = true;
    },
    loseBefore: () => {
      loseBefore = true;
    },
    reply: (value: Record<string, unknown>) => {
      patch = value;
    },
    discovery: (value: Record<string, unknown>) => {
      discoveryPatch = value;
    },
    revision: (value: number) => {
      revision = value;
      f.patch({ revision });
    },
    lifetime: (value: number) => {
      days = value;
    },
    current: () => original?.id,
  };
}

it("resumes a pending request with status after a restart, then installs it", async () => {
  const f = await fixture();

  await f.pass();
  const { createCloudConnection } = await import("./cloud-client.js");
  const restarted = createCloudConnection(f.options);
  await restarted.staffCertificate(hostname);
  expect(f.calls.map((c) => c.action)).toEqual([
    "staff-certificate-status",
    "staff-certificate-submit",
    "staff-certificate-status",
    "staff-certificate-status",
  ]);
  const submitted = f.calls.find((call) => call.action === "staff-certificate-submit")!;
  const polled = f.calls.find(
    (call) => call.action === "staff-certificate-status" && call.body.requestId !== null,
  )!;
  expect(polled.body).toEqual({ version: 1, requestId: submitted.operationId });
  f.ready();
  await restarted.staffCertificate(hostname);
  expect(await f.readChain()).toContain("BEGIN CERTIFICATE");
  expect((await stat(join(f.stateDir, "cloud/staff.key"))).mode & 0o077).toBe(0);
});

it("discovers the accepted submit after a lost response, without a new request or key", async () => {
  const f = await fixture();

  f.lose();
  await expect(f.pass()).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  const key = await f.readKey();
  await f.pass();
  const submitted = f.submits();
  expect(submitted).toHaveLength(1);
  expect(f.calls.at(-1)!.body).toEqual({ version: 1, requestId: submitted[0]!.operationId });
  expect(await f.readKey()).toBe(key);
});

it("renews at thirty days remaining while keeping its key and request identity", async () => {
  const f = await fixture();
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    f.ready();
    await f.pass();
    const key = await f.readKey();
    const certificate = await f.readChain();
    server = createServer({ key, cert: certificate });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    watchTlsFiles(
      server,
      {
        keyFile: join(f.stateDir, "cloud/staff.key"),
        certFile: join(f.stateDir, "cloud/staff.crt"),
      },
      hostname,
      () => {},
      5,
    );
    const fingerprint = () =>
      new Promise<string>((resolve, reject) => {
        const socket = connect({
          host: "127.0.0.1",
          port,
          servername: hostname,
          rejectUnauthorized: false,
        });
        socket.once("error", reject);
        socket.once("secureConnect", () => {
          resolve(socket.getPeerCertificate().fingerprint256);
          socket.destroy();
        });
      });
    expect(await fingerprint()).toBe(new X509Certificate(certificate).fingerprint256);
    vi.setSystemTime(start + 59 * 86400000);
    await f.pass();
    expect(f.submits()).toHaveLength(1);
    const requestId = f.current();
    vi.setSystemTime(start + 61 * 86400000);
    f.pause();
    await f.pass();
    await f.pass();
    expect(f.submits()).toHaveLength(1);
    expect(await f.readChain()).toBe(certificate);
    f.ready();
    await f.pass();
    expect(f.current()).toBe(requestId);
    expect(f.submits()).toHaveLength(1);
    expect(await f.readKey()).toBe(key);
    const renewed = await f.readChain();
    expect(renewed).not.toBe(certificate);
    await vi.waitFor(async () =>
      expect(await fingerprint()).toBe(new X509Certificate(renewed).fingerprint256),
    );
    await f.pass();
    expect(f.submits()).toHaveLength(1);
  } finally {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    await f.close();
  }
});

it.each([
  { version: 2 },
  { installationId: "another-installation" },
  { requestId: "another-request" },
  { hostname: "staff.other.example.test" },
  { revision: 1 },
  { csrDigest: "wrong" },
  { state: "unknown" },
  { state: "ready", certificate: "broken" },
])("refuses a mismatched or invalid certificate reply: %j", async (patch) => {
  const f = await fixture();

  f.reply(patch);
  await expect(f.pass()).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  await expect(f.readChain()).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("the scheduled Cloud worker waits for a ready chain before opening the entrance and skips a secondary", async () => {
  const f = await fixture(),
    controller = new AbortController();
  const { runCloudConnectionForTest } = await import("./testing/cloud-connection-job.js");
  let primary = false,
    ticks = 0;
  const opened: string[] = [];
  try {
    await runCloudConnectionForTest({
      connection: f.client,
      signal: controller.signal,
      isPrimary: () => primary,
      staffHostname: hostname,
      onStaffCertificate: async () => {
        opened.push(await f.readChain());
      },
      sleep: async () => {
        ticks++;
        if (ticks === 1) {
          expect(f.calls).toHaveLength(0);
          primary = true;
        } else if (ticks === 2) {
          expect(opened).toHaveLength(0);
          f.ready();
        } else controller.abort();
      },
    });
    expect(f.calls.map((c) => c.action)).toEqual([
      "staff-certificate-status",
      "staff-certificate-submit",
      "staff-certificate-status",
      "staff-certificate-status",
    ]);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain("BEGIN CERTIFICATE");
  } finally {
    controller.abort();
    await f.close();
  }
});

it.each([
  [503, "{}"],
  [200, "broken"],
  [200, "null"],
  [200, "x".repeat(32769)],
  [200, Buffer.from([0xff])],
  [302, "{}"],
])("bounds or refuses HTTP replies (%i)", async (status, body) => {
  const f = await fixture();

  f.respond(Number(status), body as string | Buffer);
  await expect(f.pass()).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  await expect(f.readChain()).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each([
  [403, "revoked"],
  [401, "invalid_proof"],
])("records installation refusals after releasing its turn (%i)", async (status, error) => {
  const f = await fixture();

  f.respond(Number(status), JSON.stringify({ error }));
  await expect(f.pass()).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  const state = JSON.parse(await readFile(join(f.stateDir, "cloud/connection.json"), "utf8"));
  expect(state.lifecycle.lease).toBeUndefined();
  expect(state.lifecycle.revoked).toBe(error === "revoked");
});

it("a cancelled pass sends nothing", async () => {
  const f = await fixture(),
    controller = new AbortController();

  controller.abort();
  await expect(f.pass(controller.signal)).rejects.toBeDefined();
  expect(f.calls).toHaveLength(0);
  await expect(f.readKey()).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each(["production", "revoked", "no-lease", "no-view", "no-registration"])(
  "certificate exchange stays closed for %s",
  async (gate) => {
    const f = await fixture();

    await f.client.refresh();
    const state = JSON.parse(await readFile(join(f.stateDir, "cloud/connection.json"), "utf8"));
    if (gate === "production") state.environment = "production";
    if (gate === "revoked") state.lifecycle.revoked = true;
    if (gate === "no-lease") delete state.lifecycle.lease;
    if (gate === "no-view") delete state.lifecycle.view;
    if (gate === "no-registration") delete state.view.registration;
    const { refreshStaffCertificate } = await import("./cloud-staff-certificate.js");
    await expect(refreshStaffCertificate(state, f.stateDir, hostname)).rejects.toMatchObject({
      code: "cloud.not_configured",
    });
    expect(f.calls).toHaveLength(0);
  },
);

it("keeps a fresh installed certificate when Cloud changes another configuration revision", async () => {
  const f = await fixture();

  f.ready();
  await f.pass();
  const certificate = await f.readChain();
  f.patch({ revision: 1 });
  await f.client.refresh();
  await f.pass();
  expect(f.calls).toHaveLength(2);
  expect(await f.readChain()).toBe(certificate);
});

it("keeps Cloud refresh available while a certificate reply waits", async () => {
  const f = await fixture();
  let release = () => {},
    arrived = () => {};
  const reached = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.hold(async () => {
    arrived();
    await held;
  });
  const certificate = f.pass();
  try {
    await reached;
    await expect(f.client.refresh()).resolves.toMatchObject({ installation: { state: "active" } });
  } finally {
    release();
    await certificate;
    await f.close();
  }
}, 15000);

it("does not install a certificate if Stop Cloud access completes while its reply waits", async () => {
  const f = await fixture();
  let release = () => {},
    arrived = () => {};
  const reached = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.ready();
  f.hold(async () => {
    arrived();
    await held;
  });
  const certificate = f.pass().catch((error) => error);
  try {
    await reached;
    await f.client.revoke(async () => {});
    release();
    expect(await certificate).toMatchObject({ code: "cloud.not_configured" });
    await expect(f.readChain()).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    release();
    await certificate;
    await f.close();
  }
}, 15000);

it.each(["before demotion", "after demotion", "after abort"])(
  "does not open the staff entrance on %s",
  async (stage) => {
    const f = await fixture(),
      controller = new AbortController();
    const { runCloudConnectionForTest } = await import("./testing/cloud-connection-job.js");
    let primary = true,
      opened = 0;
    f.ready();
    const refresh = f.client.refresh.bind(f.client),
      certificate = f.client.staffCertificate.bind(f.client);
    vi.spyOn(f.client, "refresh").mockImplementation(async (signal) => {
      const status = await refresh(signal);
      if (stage === "before demotion") primary = false;
      return status;
    });
    vi.spyOn(f.client, "staffCertificate").mockImplementation(async (...args) => {
      const ready = await certificate(...args);
      if (stage === "after abort") controller.abort();
      else primary = false;
      return ready;
    });
    try {
      await runCloudConnectionForTest({
        connection: f.client,
        signal: controller.signal,
        isPrimary: () => primary,
        staffHostname: hostname,
        onStaffCertificate: () => {
          opened++;
        },
        sleep: async () => {
          controller.abort();
        },
      });
      expect(opened).toBe(0);
      expect(f.calls.some((call) => call.action === "staff-certificate-submit")).toBe(
        stage !== "before demotion",
      );
    } finally {
      controller.abort();
      await f.close();
    }
  },
);

it("a revoked installation does not attempt certificate work or log a spurious failure", async () => {
  const f = await fixture(),
    controller = new AbortController();
  const { runCloudConnectionForTest } = await import("./testing/cloud-connection-job.js");
  const errors: unknown[] = [];
  try {
    await f.client.revoke(async () => {});
    await runCloudConnectionForTest({
      connection: f.client,
      signal: controller.signal,
      isPrimary: () => true,
      staffHostname: hostname,
      onError: (error) => {
        errors.push(error);
      },
      sleep: async () => {
        controller.abort();
      },
    });
    expect(errors).toEqual([]);
    expect(f.calls).toHaveLength(0);
  } finally {
    controller.abort();
    await f.close();
  }
});

it("discovers Cloud's existing request instead of relying on a local request file", async () => {
  const f = await fixture();

  await f.pass();
  expect(f.calls[0]!.action).toBe("staff-certificate-status");
  expect(f.calls[0]!.body).toEqual({ version: 1, requestId: null });
});

it.each([false, true])(
  "recovers a lost submit across a revision change (accepted: %s)",
  async (accepted) => {
    const f = await fixture();

    if (accepted) f.lose();
    else f.loseBefore();
    await expect(f.pass()).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const first = f.calls.find((call) => call.action === "staff-certificate-submit")!;
    const key = await f.readKey();
    f.revision(1);
    f.ready();
    await f.pass();
    const submitted = f.submits();
    expect(submitted).toHaveLength(2);
    expect(submitted[1]!.body.revision).toBe(1);
    expect(submitted[1]!.body.previousRequestId).toBe(accepted ? first.operationId : null);
    expect(await f.readKey()).toBe(key);
    expect(await f.readChain()).toContain("BEGIN CERTIFICATE");
  },
);

it.each(["key", "chain"])("recovers a lost %s without a local request record", async (missing) => {
  const f = await fixture();

  f.ready();
  await f.pass();
  const first = f.calls.find((call) => call.action === "staff-certificate-submit")!;
  const key = await f.readKey();
  await unlink(join(f.stateDir, missing === "key" ? "cloud/staff.key" : "cloud/staff.crt"));
  await f.pass();
  const submitted = f.submits();
  expect(submitted).toHaveLength(missing === "key" ? 2 : 1);
  if (missing === "key") {
    expect(submitted[1]!.body.previousRequestId).toBe(first.operationId);
    expect(await f.readKey()).not.toBe(key);
  } else expect(await f.readKey()).toBe(key);
  expect(new X509Certificate(await f.readChain()).checkHost(hostname)).toBe(hostname);
});

it.each([
  { days: 120, before: 89, after: 91 },
  { days: 15, before: 9, after: 11 },
])("renews a $days-day chain in its bounded window", async (timing) => {
  const f = await fixture();

  const start = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
  f.lifetime(timing.days);
  f.ready();
  await f.pass();
  vi.setSystemTime(start + timing.before * 86400000);
  await f.pass();
  expect(f.submits()).toHaveLength(1);
  vi.setSystemTime(start + timing.after * 86400000);
  await f.pass();
  expect(f.submits()).toHaveLength(2);
});

it.each([
  { request: undefined },
  { request: [] },
  { request: {} },
  { revision: -1 },
  { revision: 1.5 },
  { hostname: "staff.other.example.test" },
  { installationId: "another-installation" },
])("rejects malformed discovery before submit: %j", async (patch) => {
  const f = await fixture();

  f.discovery(patch);
  await expect(f.pass()).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  expect(f.submits()).toHaveLength(0);
});
