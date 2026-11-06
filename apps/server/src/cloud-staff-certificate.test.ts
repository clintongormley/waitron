import { expect, it, vi, afterEach } from "vitest";
import { readFile, writeFile, chmod, stat, symlink } from "node:fs/promises";
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
  try {
    f.ready();
    await f.client.staffCertificate(hostname);
    const body = f.calls[0]!.body;
    expect(body).toEqual({
      version: 1,
      hostname,
      revision: 0,
      csr: expect.any(String),
      previousRequestId: null,
    });
    expect(body.csr).not.toContain("PRIVATE KEY");
    expect(forge.pki.certificationRequestFromPem(String(body.csr)).verify()).toBe(true);
    expect(
      new X509Certificate(await readFile(join(f.stateDir, "cloud-staff.crt"))).checkHost(hostname),
    ).toBe(hostname);
    expect(f.calls).toHaveLength(1);
    await f.client.staffCertificate(hostname);
    expect(f.calls).toHaveLength(1);
  } finally {
    await f.close();
  }
});

afterEach(() => vi.useRealTimers());

async function fixture() {
  let patch: Record<string, unknown> = {};
  let lose = false;
  const calls: { action: string; operationId: string; body: Record<string, unknown> }[] = [];
  let original: Record<string, unknown>;
  let ready = false;
  let response: { status: number; body: string | Buffer } | undefined;
  const f = await installationFixture(undefined, {
    staffCertificate: async (v, saved, req, res) => {
      expect(req.url).toBe(`/api/installations/${v[2]}`);
      expect(v[6]).toBe(JSON.stringify((saved.lifecycle as { lease: unknown }).lease));
      if (response) {
        res.writeHead(response.status);
        res.end(response.body);
        return;
      }
      const action = String(v[2]);
      const body = JSON.parse(String(v[7]));
      calls.push({ action, operationId: String(v[4]), body });
      if (action === "staff-certificate-submit") original = { ...body, requestId: v[4] };
      if (lose) {
        lose = false;
        req.socket.destroy();
        return;
      }
      const csr = String(original.csr);
      let certificate: string | undefined;
      if (ready) {
        const request = forge.pki.certificationRequestFromPem(csr);
        const key = forge.pki.privateKeyFromPem(
          await readFile(join(f.stateDir, "cloud-staff.key"), "utf8"),
        );
        const cert = forge.pki.createCertificate();
        cert.publicKey = request.publicKey!;
        cert.serialNumber = String(calls.length).padStart(2, "0");
        cert.validity.notBefore = new Date(Date.now() - 1000);
        cert.validity.notAfter = new Date(Date.now() + 90 * 86400000);
        cert.setSubject([{ name: "commonName", value: hostname }]);
        cert.setIssuer(cert.subject.attributes);
        cert.setExtensions([{ name: "subjectAltName", altNames: [{ type: 2, value: hostname }] }]);
        cert.sign(key, forge.md.sha256.create());
        certificate = forge.pki.certificateToPem(cert);
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          version: 1,
          installationId: v[3],
          requestId: original.requestId,
          hostname,
          revision: original.revision,
          csrDigest: createHash("sha256").update(csr).digest("hex"),
          state: ready ? "ready" : "pending",
          ...(certificate ? { certificate } : {}),
          ...patch,
        }),
      );
    },
  });
  return {
    ...f,
    calls,
    respond: (status: number, body: string | Buffer) => {
      response = { status, body };
    },
    ready: () => {
      ready = true;
    },
    lose: () => {
      lose = true;
    },
    reply: (value: Record<string, unknown>) => {
      patch = value;
    },
  };
}

it("resumes a pending request with status after a restart, then installs it", async () => {
  const f = await fixture();
  try {
    await f.client.staffCertificate(hostname);
    const { createCloudConnection } = await import("./cloud-client.js");
    const restarted = createCloudConnection(f.options);
    await restarted.staffCertificate(hostname);
    expect(f.calls.map((c) => c.action)).toEqual([
      "staff-certificate-submit",
      "staff-certificate-status",
    ]);
    expect(f.calls[1]!.body).toEqual({ version: 1, requestId: f.calls[0]!.operationId });
    f.ready();
    await restarted.staffCertificate(hostname);
    expect(await readFile(join(f.stateDir, "cloud-staff.crt"), "utf8")).toContain(
      "BEGIN CERTIFICATE",
    );
    expect((await stat(join(f.stateDir, "staff-certificate-request.json"))).mode & 0o077).toBe(0);
    expect(
      JSON.parse(await readFile(join(f.stateDir, "staff-certificate-request.json"), "utf8")),
    ).toMatchObject({ installed: true });
  } finally {
    await f.close();
  }
});

it("retries the identical submit after a lost response, without a new request or key", async () => {
  const f = await fixture();
  try {
    f.lose();
    await expect(f.client.staffCertificate(hostname)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const key = await readFile(join(f.stateDir, "cloud-staff.key"), "utf8");
    await f.client.staffCertificate(hostname);
    expect(f.calls[1]).toEqual(f.calls[0]);
    expect(await readFile(join(f.stateDir, "cloud-staff.key"), "utf8")).toBe(key);
  } finally {
    await f.close();
  }
});

it("renews at thirty days remaining, keeps its key and names the preceding request once", async () => {
  const f = await fixture();
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    f.ready();
    await f.client.staffCertificate(hostname);
    const key = await readFile(join(f.stateDir, "cloud-staff.key"), "utf8");
    const certificate = await readFile(join(f.stateDir, "cloud-staff.crt"), "utf8");
    server = createServer({ key, cert: certificate });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    watchTlsFiles(
      server,
      {
        keyFile: join(f.stateDir, "cloud-staff.key"),
        certFile: join(f.stateDir, "cloud-staff.crt"),
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
    await f.client.staffCertificate(hostname);
    expect(f.calls).toHaveLength(1);
    vi.setSystemTime(start + 61 * 86400000);
    await f.client.staffCertificate(hostname);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]!.operationId).not.toBe(f.calls[0]!.operationId);
    expect(f.calls[1]!.body.previousRequestId).toBe(f.calls[0]!.operationId);
    expect(await readFile(join(f.stateDir, "cloud-staff.key"), "utf8")).toBe(key);
    const renewed = await readFile(join(f.stateDir, "cloud-staff.crt"), "utf8");
    expect(renewed).not.toBe(certificate);
    await vi.waitFor(async () =>
      expect(await fingerprint()).toBe(new X509Certificate(renewed).fingerprint256),
    );
    await f.client.staffCertificate(hostname);
    expect(f.calls).toHaveLength(2);
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
  try {
    f.reply(patch);
    await expect(f.client.staffCertificate(hostname)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    await expect(readFile(join(f.stateDir, "cloud-staff.crt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await f.close();
  }
});

it.each(["broken", "null", '{"installed":true}', "[]"])(
  "refuses corrupt request state without sending: %s",
  async (content) => {
    const f = await fixture();
    try {
      await writeFile(join(f.stateDir, "staff-certificate-request.json"), content, { mode: 0o600 });
      await expect(f.client.staffCertificate(hostname)).rejects.toMatchObject({
        code: "cloud.state_invalid",
      });
      expect(f.calls).toHaveLength(0);
    } finally {
      await f.close();
    }
  },
);

it("refuses a readable request file without sending", async () => {
  const f = await fixture();
  try {
    await f.client.staffCertificate(hostname);
    await chmod(join(f.stateDir, "staff-certificate-request.json"), 0o644);
    await expect(f.client.staffCertificate(hostname)).rejects.toMatchObject({
      code: "cloud.state_invalid",
    });
    expect(f.calls).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it("the scheduled Cloud worker waits for a ready chain before opening the entrance and skips a secondary", async () => {
  const f = await fixture(),
    controller = new AbortController();
  const { runCloudWorker } = await import("./cloud-worker.js");
  let primary = false,
    ticks = 0;
  const opened: string[] = [];
  try {
    await runCloudWorker({
      connection: f.client,
      signal: controller.signal,
      isPrimary: () => primary,
      staffHostname: hostname,
      onStaffCertificate: async () => {
        opened.push(await readFile(join(f.stateDir, "cloud-staff.crt"), "utf8"));
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
      "staff-certificate-submit",
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
  try {
    f.respond(Number(status), body as string | Buffer);
    await expect(f.client.staffCertificate(hostname)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    await expect(readFile(join(f.stateDir, "cloud-staff.crt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await f.close();
  }
});

it.each([
  [403, "revoked"],
  [401, "invalid_proof"],
])("records installation refusals after releasing its turn (%i)", async (status, error) => {
  const f = await fixture();
  try {
    f.respond(Number(status), JSON.stringify({ error }));
    await expect(f.client.staffCertificate(hostname)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const state = JSON.parse(await readFile(join(f.stateDir, "cloud-connection.json"), "utf8"));
    expect(state.lifecycle.lease).toBeUndefined();
    expect(state.lifecycle.revoked).toBe(error === "revoked");
  } finally {
    await f.close();
  }
});

it("a cancelled pass sends nothing", async () => {
  const f = await fixture(),
    controller = new AbortController();
  try {
    controller.abort();
    await expect(f.client.staffCertificate(hostname, controller.signal)).rejects.toBeDefined();
    expect(f.calls).toHaveLength(0);
    await expect(
      readFile(join(f.stateDir, "staff-certificate-request.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.close();
  }
});

it.each(["production", "revoked", "no-lease", "no-view", "no-registration"])(
  "certificate exchange stays closed for %s",
  async (gate) => {
    const f = await fixture();
    try {
      await f.client.refresh();
      const state = JSON.parse(await readFile(join(f.stateDir, "cloud-connection.json"), "utf8"));
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
    } finally {
      await f.close();
    }
  },
);

it("refuses a symlink request and keeps the linked file untouched", async () => {
  const f = await fixture();
  try {
    const target = join(f.stateDir, "target");
    await writeFile(target, "private target", { mode: 0o600 });
    await symlink(target, join(f.stateDir, "staff-certificate-request.json"));
    await expect(f.client.staffCertificate(hostname)).rejects.toMatchObject({
      code: "cloud.state_invalid",
    });
    expect(f.calls).toHaveLength(0);
    expect(await readFile(target, "utf8")).toBe("private target");
  } finally {
    await f.close();
  }
});

it("keeps a fresh installed certificate when Cloud changes another configuration revision", async () => {
  const f = await fixture();
  try {
    f.ready();
    await f.client.staffCertificate(hostname);
    const certificate = await readFile(join(f.stateDir, "cloud-staff.crt"), "utf8");
    f.patch({ revision: 1 });
    await f.client.refresh();
    await f.client.staffCertificate(hostname);
    expect(f.calls).toHaveLength(1);
    expect(await readFile(join(f.stateDir, "cloud-staff.crt"), "utf8")).toBe(certificate);
  } finally {
    await f.close();
  }
});
