import { expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  mountCloudPublic,
  createStaffCsr,
  createStaffApp,
  startStaffListener,
} from "./cloud-remote.js";
import forge from "node-forge";
it("public availability exposes no venue data and reevaluates its supplied serving check", async () => {
  const app = new Hono();
  let serving = true;
  mountCloudPublic(app, () => serving);
  const ok = await app.request("/public/availability");
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ available: true });
  serving = false;
  const offline = await app.request("/public/availability");
  expect(offline.status).toBe(503);
  expect(await offline.json()).toEqual({ available: false });
  expect((await app.request("/public/availability", { method: "POST" })).status).toBe(404);
});
it("staff key remains private on the venue and repeated requests retain its identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "waitron-cloud-key-"));
  try {
    const first = await createStaffCsr(root, "staff.sol.example.test"),
      second = await createStaffCsr(root, "staff.sol.example.test");
    const key = await readFile(join(root, "cloud-staff.key"), "utf8");
    expect(first).not.toContain("PRIVATE KEY");
    expect((await stat(join(root, "cloud-staff.key"))).mode & 0o077).toBe(0);
    const one = forge.pki.certificationRequestFromPem(first),
      two = forge.pki.certificationRequestFromPem(second);
    expect(one.verify()).toBe(true);
    expect(two.verify()).toBe(true);
    expect(forge.pki.publicKeyToPem(one.publicKey!)).toBe(forge.pki.publicKeyToPem(two.publicKey!));
    expect(key).toContain("PRIVATE KEY");
    const { RECOVERY_FILES, collectStateSecrets } = await import("./state-secrets.js");
    for (const relative of RECOVERY_FILES) {
      await mkdir(dirname(join(root, relative)), { recursive: true });
      await writeFile(join(root, relative), "recovery fixture");
    }
    const captured = await collectStateSecrets(root);
    expect(captured).not.toHaveProperty("cloud-staff.key");
    expect(JSON.stringify(captured)).not.toContain(key);
    await expect(createStaffCsr(root, "*.example.test")).rejects.toThrow("Invalid staff hostname");
    await writeFile(join(root, "cloud-staff.key"), "broken");
    await expect(createStaffCsr(root, "staff.sol.example.test")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("certificate installation verifies the venue key and hostname before replacing a valid chain", async () => {
  const { installStaffCertificate } = await import("./cloud-remote.js");
  const root = await mkdtemp(join(tmpdir(), "waitron-cloud-cert-"));
  try {
    const csr = forge.pki.certificationRequestFromPem(
      await createStaffCsr(root, "staff.sol.example.test"),
    );
    const key = forge.pki.privateKeyFromPem(await readFile(join(root, "cloud-staff.key"), "utf8"));
    const cert = forge.pki.createCertificate();
    cert.publicKey = csr.publicKey!;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date(Date.now() - 1000);
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    cert.setSubject([{ name: "commonName", value: "staff.sol.example.test" }]);
    cert.setIssuer(cert.subject.attributes);
    cert.setExtensions([
      { name: "subjectAltName", altNames: [{ type: 2, value: "staff.sol.example.test" }] },
    ]);
    cert.sign(key, forge.md.sha256.create());
    const pem = forge.pki.certificateToPem(cert);
    await installStaffCertificate(root, "staff.sol.example.test", pem);
    await chmod(join(root, "cloud-staff.key"), 0o666);
    await expect(installStaffCertificate(root, "staff.sol.example.test", pem)).rejects.toThrow(
      "Invalid staff key file",
    );
    await expect(createStaffCsr(root, "staff.sol.example.test")).rejects.toThrow(
      "Invalid staff key file",
    );
    await chmod(join(root, "cloud-staff.key"), 0o600);
    await expect(installStaffCertificate(root, "staff.luna.example.test", pem)).rejects.toThrow();
    await expect(
      installStaffCertificate(root, "staff.sol.example.test", "broken"),
    ).rejects.toThrow();
    const other = forge.pki.rsa.generateKeyPair(2048);
    cert.publicKey = other.publicKey;
    cert.sign(other.privateKey, forge.md.sha256.create());
    await expect(
      installStaffCertificate(root, "staff.sol.example.test", forge.pki.certificateToPem(cert)),
    ).rejects.toThrow();
    expect(await readFile(join(root, "cloud-staff.crt"), "utf8")).toBe(pem);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("the certificate CLI reports an invalid chain without a Node stack trace", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = await mkdtemp(join(tmpdir(), "waitron-cert-cli-"));
  try {
    await writeFile(join(root, "chain.pem"), "broken");
    const result = await promisify(execFile)(process.execPath, [
      "--import",
      import.meta.resolve("tsx"),
      "scripts/cloud-certificate.ts",
      "install",
      root,
      "staff.example.test",
      join(root, "chain.pem"),
    ]).catch((error: { code: number; stderr: string }) => error);
    expect(result).toHaveProperty("code", 1);
    expect(result.stderr).toContain("Could not install the staff certificate");
    expect(result.stderr).not.toContain("node:internal");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("the staff entrance forwards only dashboard requests and marks their source remote", async () => {
  const { requestFromBox } = await import("./request-from-box.js");
  const app = new Hono();
  app.all("*", async (c) =>
    c.json({
      path: c.req.path,
      method: c.req.method,
      body: await c.req.text(),
      remote: (c.env as { remoteStaff?: boolean } | undefined)?.remoteStaff === true,
      onBox: requestFromBox(c),
    }),
  );
  const staff = createStaffApp(app, "https://staff.example.test");
  const response = await staff.request(
    "https://staff.example.test/management-api/session",
    { method: "POST", body: "credentials" },
    { incoming: { socket: { remoteAddress: "127.0.0.1" } } },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    path: "/management-api/session",
    method: "POST",
    body: "credentials",
    remote: true,
    onBox: false,
  });
  for (const path of [
    "/manage",
    "/manage/assets/index.js",
    "/api/theme",
    "/api/content-languages",
    "/api/backup/status",
    "/api/box/health",
    "/help/en/staff",
    "/media/presentations?ids=logo",
    "/media/renditions/v1/image/cover/center",
    "/media/logo.webp",
  ]) {
    expect((await staff.request(`https://staff.example.test${path}`)).status, path).toBe(200);
  }
  for (const path of [
    "/",
    "/tabs",
    "/setup",
    "/setup-api/provision",
    "/recovery",
    "/device-api/x",
    "/print-api/x",
    "/api/session",
    "/api/orders",
    "/public/availability",
    "/node-api/x",
    "/manage-other",
    "/management-api-other/x",
    "/api/box-other/x",
    "/manage/%2e%2e/setup",
    "/manage/%2f..%2fsetup",
    "/management-api/membership",
    "/management-api/mirror-bundle",
    "/management-api/promote",
    "/management-api/promote/preparation",
  ]) {
    for (const method of ["GET", "POST"])
      expect(
        (await staff.request(`https://staff.example.test${path}`, { method })).status,
        path,
      ).toBe(404);
  }
  expect(
    (await staff.request("https://staff.example.test/manage", { method: "POST" })).status,
  ).toBe(404);
  expect(
    (await staff.request("https://staff.example.test/media/logo.webp", { method: "POST" })).status,
  ).toBe(404);
});
it("refuses another venue hostname and does not accept a remote marker from HTTP headers", async () => {
  const { requestFromBox } = await import("./request-from-box.js");
  const app = new Hono();
  app.get("/manage", (c) => c.json({ onBox: requestFromBox(c) }));
  const staff = createStaffApp(app, "https://staff.example.test");
  expect((await staff.request("https://other.example.test/manage")).status).toBe(404);
  expect((await staff.request("http://staff.example.test/manage")).status).toBe(404);
  expect(
    await (
      await app.request("/manage", { headers: { "x-waitron-remote": "1", remoteStaff: "true" } })
    ).json(),
  ).toEqual({ onBox: true });
});

it("serves the dashboard over a separate TLS listener and closes it", async () => {
  const { mintSelfSignedServerCert } = await import("./self-signed-cert.js");
  const { get } = await import("node:https");
  const { freePorts } = await import("./testing/free-ports.js");
  const root = await mkdtemp(join(tmpdir(), "waitron-staff-listen-"));
  const [port] = await freePorts(1);
  const material = mintSelfSignedServerCert({
    now: new Date(),
    hostnames: ["staff.example.test"],
    ipAddresses: [],
  });
  await writeFile(join(root, "cloud-staff.key"), material.serverKeyPem);
  await writeFile(join(root, "cloud-staff.crt"), material.serverCertPem);
  const app = new Hono();
  app.get("/manage", (c) => c.text("dashboard"));
  app.get("/setup", (c) => c.text("setup must stay local"));
  const lines: unknown[] = [];
  const server = startStaffListener(
    { staff: { origin: "https://staff.example.test", host: "127.0.0.1", port }, stateDir: root },
    app,
    (...args) => lines.push(args),
  );
  const ask = (path: string) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const request = get(
        {
          hostname: "127.0.0.1",
          port,
          path,
          servername: "staff.example.test",
          rejectUnauthorized: false,
          headers: { Host: "staff.example.test" },
        },
        (r) => {
          let text = "";
          r.setEncoding("utf8");
          r.on("data", (chunk) => {
            text += chunk;
          });
          r.on("end", () => resolve({ status: r.statusCode!, text }));
        },
      );
      request.on("error", reject);
    });
  try {
    expect(server).toBeDefined();
    await vi.waitFor(() =>
      expect(lines.some((line) => JSON.stringify(line).includes("server.listening"))).toBe(true),
    );
    expect(await ask("/manage")).toEqual({ status: 200, text: "dashboard" });
    expect((await ask("/setup")).status).toBe(404);
    await server!.close();
    await expect(ask("/manage")).rejects.toThrow();
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("leaves a missing staff certificate offline without throwing into local sales", async () => {
  const lines: unknown[] = [];
  expect(() =>
    startStaffListener(
      {
        staff: { origin: "https://staff.example.test", host: "127.0.0.1", port: 8443 },
        stateDir: "/absent-staff-fixture",
      },
      new Hono(),
      (...args) => lines.push(args),
    ),
  ).not.toThrow();
  expect(lines).toEqual([
    ["warn", "server.listen_failed", { listener: "staff", port: 8443, code: "ENOENT" }],
  ]);
  expect(startStaffListener({ stateDir: "/unused" }, new Hono(), () => {})).toBeUndefined();
});

it("bounds remote sign-in bodies before forwarding either declared or streamed input", async () => {
  const app = new Hono();
  app.post("*", async (c) => c.text(await c.req.text()));
  const staff = createStaffApp(app, "https://staff.example.test");
  for (const headers of [new Headers(), new Headers({ "content-length": "65537" })]) {
    const response = await staff.request("https://staff.example.test/management-api/session", {
      method: "POST",
      headers,
      body: "x".repeat(65537),
    });
    expect(response.status).toBe(413);
  }
  expect(
    (
      await staff.request("https://staff.example.test/management-api/session", {
        method: "POST",
        body: "small",
      })
    ).status,
  ).toBe(200);
});

it("limits remote anonymous passkey challenges and allows a later minute", async () => {
  const app = new Hono();
  app.post("/management-api/passkey/auth/options", (c) => c.text("challenge created", 201));
  const staff = createStaffApp(app, "https://staff.example.test");
  const clock = vi.spyOn(Date, "now").mockReturnValue(100000);
  const ask = () =>
    staff.request("https://staff.example.test/management-api/passkey/auth/options", {
      method: "POST",
    });
  try {
    for (let i = 0; i < 20; i++) expect((await ask()).status).toBe(201);
    expect((await ask()).status).toBe(429);
    clock.mockReturnValue(160000);
    expect((await ask()).status).toBe(201);
  } finally {
    clock.mockRestore();
  }
});
