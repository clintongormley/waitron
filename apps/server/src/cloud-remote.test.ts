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
import type { Logger } from "./logger.js";
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
    const key = await readFile(join(root, "cloud/staff.key"), "utf8");
    expect(first).not.toContain("PRIVATE KEY");
    expect((await stat(join(root, "cloud/staff.key"))).mode & 0o077).toBe(0);
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
    expect(captured).not.toHaveProperty("cloud/staff.key");
    expect(JSON.stringify(captured)).not.toContain(key);
    await expect(createStaffCsr(root, "*.example.test")).rejects.toThrow("Invalid staff hostname");
    await mkdir(join(root, "cloud"), { recursive: true });
    await writeFile(join(root, "cloud/staff.key"), "broken");
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
    const key = forge.pki.privateKeyFromPem(await readFile(join(root, "cloud/staff.key"), "utf8"));
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
    cert.setExtensions([
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "staff.sol.example.test" },
          { type: 2, value: "staff.other.example.test" },
        ],
      },
    ]);
    cert.sign(key, forge.md.sha256.create());
    await expect(
      installStaffCertificate(root, "staff.sol.example.test", forge.pki.certificateToPem(cert)),
    ).rejects.toThrow("Invalid staff certificate");
    expect(await readFile(join(root, "cloud/staff.crt"), "utf8")).toBe(pem);
    cert.setExtensions([
      { name: "subjectAltName", altNames: [{ type: 2, value: "staff.sol.example.test" }] },
    ]);
    cert.sign(key, forge.md.sha256.create());
    await chmod(join(root, "cloud/staff.key"), 0o666);
    await expect(installStaffCertificate(root, "staff.sol.example.test", pem)).rejects.toThrow(
      "Invalid staff key file",
    );
    await expect(createStaffCsr(root, "staff.sol.example.test")).rejects.toThrow(
      "Invalid staff key file",
    );
    await chmod(join(root, "cloud/staff.key"), 0o600);
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
    expect(await readFile(join(root, "cloud/staff.crt"), "utf8")).toBe(pem);
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

it("the staff entrance forwards dashboard requests and marks their source remote", async () => {
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
  const staff = createStaffApp(app, async () => "https://staff.example.test");
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
    "/api/theme",
    "/api/content-languages",
    "/api/backup/status",
    "/api/box/health",
    "/help/en/staff",
    "/legal/declaration",
    "/legal/about",
    "/media/presentations?ids=logo",
    "/media/renditions/v1/image/cover/center",
    "/media/logo.webp",
  ]) {
    expect((await staff.request(`https://staff.example.test${path}`)).status, path).toBe(200);
  }
  for (const path of [
    "/",
    "/till/tabs",
    "/setup",
    "/setup-api/provision",
    "/recovery",
    "/device-api/x",
    "/print-api/x",
    "/api/session",
    "/api/orders",
    "/node-api/x",
    "/manage-other",
    "/management-api-other/x",
    "/api/box-other/x",
    "/%2e%2e/setup",
    "/%2f..%2fsetup",
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
  expect((await staff.request("https://staff.example.test/", { method: "POST" })).status).toBe(404);
  expect(
    (await staff.request("https://staff.example.test/media/logo.webp", { method: "POST" })).status,
  ).toBe(404);
  expect(
    (await staff.request("https://staff.example.test/legal/declaration", { method: "POST" }))
      .status,
  ).toBe(404);
});
it("the staff entrance answers public availability and no other /public/ path", async () => {
  const app = new Hono();
  let serving = true;
  mountCloudPublic(app, () => serving);
  app.get("/public/menu", (c) => c.json({ menu: true }));
  app.get("/public/menu/*", (c) => c.json({ menu: true }));
  app.all("*", (c) => c.json({ reached: c.req.path }));
  const staff = createStaffApp(app, async () => "https://staff.example.test");
  const ok = await staff.request("https://staff.example.test/public/availability");
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ available: true });
  const head = await staff.request("https://staff.example.test/public/availability", {
    method: "HEAD",
  });
  expect(head.status).toBe(200);
  serving = false;
  const offline = await staff.request("https://staff.example.test/public/availability");
  expect(offline.status).toBe(503);
  expect(await offline.json()).toEqual({ available: false });
  expect(
    (await staff.request("https://staff.example.test/public/availability", { method: "POST" }))
      .status,
  ).toBe(404);
  for (const path of [
    "/public/menu",
    "/public/menu/x",
    "/public/availability/x",
    "/public/availabilityx",
  ]) {
    for (const method of ["GET", "POST"])
      expect(
        (await staff.request(`https://staff.example.test${path}`, { method })).status,
        `${method} ${path}`,
      ).toBe(404);
  }
  expect((await staff.request("https://other.example.test/public/availability")).status).toBe(404);
});
it("the staff entrance lets the tax office's invoice list, PDF, month and its download through", async () => {
  const app = new Hono();
  app.all("*", (c) => c.json({ path: c.req.path, method: c.req.method }));
  const staff = createStaffApp(app, async () => "https://staff.example.test");
  for (const [method, path] of [
    ["GET", "/management-api/tax-office/invoices?from=2026-11-01&to=2026-11-30"],
    ["POST", "/management-api/tax-office/invoices/0b0e6d0c-56a4-4c3e-9b0e-1b2b3c4d5e6f/pdf"],
    ["POST", "/management-api/tax-office/months/2026-11"],
    ["GET", "/management-api/tax-office/month-download"],
    ["GET", "/management-api/tax-office/month-download/00000000-0000-4000-8000-000000000000/file"],
  ] as const) {
    const response = await staff.request(`https://staff.example.test${path}`, { method });
    expect(response.status, path).toBe(200);
    expect(await response.json()).toEqual({ path: path.split("?")[0], method });
  }
});

it("refuses another venue hostname and does not accept a remote marker from HTTP headers", async () => {
  const { requestFromBox } = await import("./request-from-box.js");
  const app = new Hono();
  app.get("/", (c) => c.json({ onBox: requestFromBox(c) }));
  const staff = createStaffApp(app, async () => "https://staff.example.test");
  expect((await staff.request("https://other.example.test/")).status).toBe(404);
  expect((await staff.request("http://staff.example.test/")).status).toBe(404);
  expect(
    await (
      await app.request("/", { headers: { "x-waitron-remote": "1", remoteStaff: "true" } })
    ).json(),
  ).toEqual({ onBox: true });
});

it("serves the dashboard over a separate TLS listener and closes it", async () => {
  const { mintSelfSignedServerCert } = await import("./self-signed-cert.js");
  const { get } = await import("node:https");
  const root = await mkdtemp(join(tmpdir(), "waitron-staff-listen-"));
  let port = 0;
  const material = mintSelfSignedServerCert({
    now: new Date(),
    hostnames: ["staff.example.test"],
    ipAddresses: [],
  });
  await mkdir(join(root, "cloud"), { recursive: true });
  await writeFile(join(root, "cloud/staff.key"), material.serverKeyPem);
  await mkdir(join(root, "cloud"), { recursive: true });
  await writeFile(join(root, "cloud/staff.crt"), material.serverCertPem);
  const app = new Hono();
  await writeFile(join(root, "index.html"), "dashboard");
  app.get("/", (c) => c.text("main handler must not run"));
  app.get("/setup", (c) => c.text("setup must stay local"));
  const lines: Parameters<Logger>[] = [];
  let stopped = false;
  const server = startStaffListener(
    {
      staff: { host: "127.0.0.1", port: 0 },
      stateDir: root,
      dashboardAppDir: root,
    },
    app,
    (...args) => lines.push(args),
    async () => true,
    [async (c, next) => (stopped ? c.text("stopped", 503) : next())],
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
    expect(server, JSON.stringify(lines)).toBeDefined();
    const outcome = await vi.waitFor(
      () => {
        const entry = lines.find(
          ([, event]) => event === "server.listening" || event === "server.listen_failed",
        );
        expect(entry, JSON.stringify(lines)).toBeDefined();
        return entry!;
      },
      { timeout: 10_000 },
    );
    expect(outcome[1], JSON.stringify(lines)).toBe("server.listening");
    expect(outcome[2]?.port, JSON.stringify(lines)).toBeGreaterThan(0);
    port = Number(outcome[2]!.port);
    expect(await ask("/")).toEqual({ status: 200, text: "dashboard" });
    expect((await ask("/setup")).status).toBe(404);
    stopped = true;
    expect(await ask("/")).toEqual({ status: 503, text: "stopped" });
    for (const ownPort of [
      "httpPort",
      "landingPort",
      "spareStorePort",
      "spareStoreLoopbackPort",
    ] as const) {
      const ownLines: Parameters<Logger>[] = [];
      const conflict = startStaffListener(
        { staff: { host: "127.0.0.1", port }, stateDir: root, [ownPort]: port },
        app,
        (...args) => ownLines.push(args),
        async () => true,
      );
      try {
        expect(conflict).toBeUndefined();
        expect(ownLines).toEqual([
          ["warn", "server.listen_failed", { listener: "staff", port, code: "EADDRINUSE" }],
        ]);
      } finally {
        await conflict?.close();
      }
    }
    const collision = startStaffListener(
      { staff: { host: "127.0.0.1", port }, stateDir: root },
      app,
      (...args) => lines.push(args),
      async () => true,
    );
    try {
      await vi.waitFor(() =>
        expect(lines).toContainEqual([
          "warn",
          "server.listen_failed",
          { listener: "staff", port, code: "EADDRINUSE" },
        ]),
      );
      expect(collision?.isListening()).toBe(false);
      expect((await ask("/")).status).toBe(503);
    } finally {
      await collision?.close();
    }
    await server!.close();
    await expect(ask("/")).rejects.toThrow();
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("serves marked remote requests over a private TLS socket and can reopen it", async () => {
  const { execFileSync } = await import("node:child_process");
  const { get } = await import("node:https");
  const { requestFromBox } = await import("./request-from-box.js");
  const { mintSelfSignedServerCert } = await import("./self-signed-cert.js");
  const root = await mkdtemp(join(tmpdir(), "wt-staff-"));
  const socketPath = join(root, "staff.sock");
  const hostname = "staff.waitron.local";
  const cert = mintSelfSignedServerCert({
    now: new Date(),
    hostnames: [hostname],
    ipAddresses: [],
  });
  const app = new Hono<{ Bindings: { remoteStaff?: boolean } }>();
  app.get("/management-api/session", (c) =>
    c.json({ remote: c.env.remoteStaff === true, onBox: requestFromBox(c) }),
  );
  const start = () =>
    startStaffListener(
      { staff: { socketPath }, stateDir: root },
      app,
      () => {},
      async () => true,
    );
  const ask = () =>
    new Promise<string>((resolve, reject) => {
      get(
        {
          socketPath,
          path: "/management-api/session",
          servername: hostname,
          ca: cert.caCertPem,
          headers: { Host: hostname },
          agent: false,
        },
        async (response) => {
          let body = "";
          for await (const chunk of response) body += chunk;
          resolve(body);
        },
      ).on("error", reject);
    });

  let listener: ReturnType<typeof startStaffListener>;
  try {
    await mkdir(join(root, "cloud"));
    await writeFile(join(root, "cloud/staff.key"), cert.serverKeyPem);
    await writeFile(join(root, "cloud/staff.crt"), cert.serverCertPem);
    await writeFile(socketPath, "keep this file");
    expect(start()).toBeUndefined();
    expect(await readFile(socketPath, "utf8")).toBe("keep this file");
    await rm(socketPath);

    execFileSync(process.execPath, [
      "-e",
      "require('node:net').createServer().listen(process.argv[1], () => process.exit(0))",
      socketPath,
    ]);
    expect((await stat(socketPath)).isSocket()).toBe(true);
    for (let count = 0; count < 2; count++) {
      listener = start();
      await vi.waitFor(() => expect(listener?.isListening()).toBe(true));
      expect((await stat(socketPath)).mode & 0o777).toBe(0o660);
      expect(JSON.parse(await ask())).toEqual({ remote: true, onBox: false });
      await listener?.close();
      await expect(ask()).rejects.toMatchObject({ code: "ENOENT" });
    }
  } finally {
    await listener?.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("leaves a missing staff certificate offline without throwing into local sales", async () => {
  const lines: unknown[] = [];
  expect(() =>
    startStaffListener(
      {
        staff: { host: "127.0.0.1", port: 8443 },
        stateDir: "/absent-staff-fixture",
      },
      new Hono(),
      (...args) => lines.push(args),
      async () => true,
    ),
  ).not.toThrow();
  expect(lines).toEqual([
    ["warn", "server.listen_failed", { listener: "staff", port: 8443, code: "ENOENT" }],
  ]);
  expect(
    startStaffListener(
      { stateDir: "/unused" },
      new Hono(),
      () => {},
      async () => true,
    ),
  ).toBeUndefined();
});

it("bounds remote sign-in bodies before forwarding either declared or streamed input", async () => {
  const app = new Hono();
  app.post("*", async (c) => c.text(await c.req.text()));
  const staff = createStaffApp(app, async () => "https://staff.example.test");
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
  const staff = createStaffApp(app, async () => "https://staff.example.test");
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

it("serves dashboard pages and assets directly, never arbitrary main-app root handlers", async () => {
  const root = await mkdtemp(join(tmpdir(), "waitron-staff-pages-"));
  try {
    await writeFile(join(root, "index.html"), "<html>dashboard bundle</html>");
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets/app-hash.js"), "dashboard asset");
    const local = new Hono();
    local.all("*", (c) => c.text("main handler must not run"));
    const staff = createStaffApp(local, async () => "https://staff.example.test", { root });
    for (const path of ["/", "/account?token=example", "/private-server-handler"]) {
      const response = await staff.request(`https://staff.example.test${path}`, {
        headers: { Accept: "text/html" },
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("<html>dashboard bundle</html>");
    }
    expect(
      (
        await staff.request("https://staff.example.test/account", {
          method: "HEAD",
          headers: { Accept: "text/html" },
        })
      ).status,
    ).toBe(200);
    const asset = await staff.request("https://staff.example.test/assets/app-hash.js");
    expect(await asset.text()).toBe("dashboard asset");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    for (const [method, path] of [
      ["POST", "/account"],
      ["GET", "/till/"],
      ["GET", "/assets/missing.js"],
      ["GET", "/sw-probe.js"],
    ])
      expect((await staff.request(`https://staff.example.test${path}`, { method })).status).toBe(
        404,
      );
    expect(
      (await staff.request("https://other.example.test/", { headers: { Accept: "text/html" } }))
        .status,
    ).toBe(404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("applies the supplied main page gates in order before serving staff pages", async () => {
  const { spareReadGate } = await import("./spare-read-gate.js");
  const { createHandoverGate } = await import("./handover-gate.js");
  const root = await mkdtemp(join(tmpdir(), "waitron-staff-gates-"));
  try {
    await writeFile(join(root, "index.html"), "dashboard");
    const handover = createHandoverGate();
    const gates = [handover.middleware, spareReadGate({ main: () => undefined })];
    const mirror = createStaffApp(new Hono(), async () => "https://staff.example.test", {
      root,
      gates,
    });
    const response = await mirror.request("https://staff.example.test/account", {
      headers: { Accept: "text/html" },
    });
    expect(await response.text()).toContain("This server started as the spare");
    handover.close({ allowed: () => false });
    const stopped = await mirror.request("https://staff.example.test/account", {
      headers: { Accept: "text/html" },
    });
    expect(stopped.status).toBe(503);
    expect(await stopped.json()).toEqual({
      error: { code: "handover.stepping_down", params: {} },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("checks current staff admission before parsing a body or forwarding a request", async () => {
  const app = new Hono();
  app.all("*", (c) => c.text("forwarded"));
  let admitted = true,
    unreadable = false;
  const staff = createStaffApp(app, async () => {
    if (unreadable) throw new Error("state unreadable");
    return admitted ? "https://staff.example.test" : undefined;
  });
  expect((await staff.request("https://staff.example.test/management-api/session")).status).toBe(
    200,
  );
  admitted = false;
  expect(
    (
      await staff.request("https://staff.example.test/management-api/session", {
        method: "POST",
        headers: { "content-length": "65537" },
        body: "x".repeat(65537),
      })
    ).status,
  ).toBe(404);
  unreadable = true;
  expect((await staff.request("https://staff.example.test/management-api/session")).status).toBe(
    404,
  );
});
