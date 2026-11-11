import { mkdirDurable, writeFileDurable } from "@waitron/provisioning";
import { CLOUD_DIR, CLOUD_STAFF_KEY_FILE, CLOUD_STAFF_CERT_FILE } from "@waitron/store";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { Server as HttpsServer } from "node:https";
import { buildServeOptions, watchTlsFiles } from "./tls.js";
import { closeListener } from "./close-listener.js";
import type { ServerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { generateKeyPair, X509Certificate, randomUUID } from "node:crypto";
import { lstat, open, readFile, rm, link } from "node:fs/promises";
import { join } from "node:path";
import forge from "node-forge";
import { createSecureContext } from "node:tls";
import { promisify } from "node:util";
const generateStaffKeyPair = promisify(generateKeyPair);

export function mountCloudPublic(app: Hono, serving: () => boolean): void {
  app.get("/public/availability", (c) => {
    const available = serving();
    c.header("Cache-Control", "no-store");
    return c.json({ available }, available ? 200 : 503);
  });
}

async function readStaffKey(stateDir: string): Promise<string> {
  const path = join(stateDir, CLOUD_STAFF_KEY_FILE);
  const info = await lstat(path);
  if (!info.isFile() || info.size > 8192 || (info.mode & 0o077) !== 0)
    throw new Error("Invalid staff key file");
  return readFile(path, "utf8");
}

/** Keep the staff key separate from venue.db and the recovery-file allowlist. Only the CSR leaves it. */
export async function createStaffCsr(stateDir: string, hostname: string): Promise<string> {
  if (
    hostname.length > 253 ||
    !hostname.includes(".") ||
    /^\d+(\.\d+){3}$/.test(hostname) ||
    !hostname.split(".").every((s) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))
  )
    throw new Error("Invalid staff hostname; use the exact lowercase hostname assigned by Cloud");
  await mkdirDurable(join(stateDir, CLOUD_DIR), 0o700);
  const path = join(stateDir, CLOUD_STAFF_KEY_FILE);
  try {
    await lstat(path);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    const { privateKey } = await generateStaffKeyPair("rsa", { modulusLength: 2048 });
    const temporary = path + "." + randomUUID();
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(privateKey.export({ type: "pkcs8", format: "pem" }));
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await link(temporary, path);
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      }
      const directory = await open(join(stateDir, CLOUD_DIR), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
  const key = forge.pki.privateKeyFromPem(await readStaffKey(stateDir));
  const request = forge.pki.createCertificationRequest();
  request.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  request.setSubject([{ name: "commonName", value: hostname }]);
  request.setAttributes([
    {
      name: "extensionRequest",
      extensions: [{ name: "subjectAltName", altNames: [{ type: 2, value: hostname }] }],
    },
  ]);
  request.sign(key, forge.md.sha256.create());
  return forge.pki.certificationRequestToPem(request);
}

export async function installStaffCertificate(
  stateDir: string,
  hostname: string,
  chain: string,
): Promise<void> {
  if (Buffer.byteLength(chain) > 16384) throw new Error("Invalid staff certificate");
  const cert = new X509Certificate(chain);
  if (
    cert.checkHost(hostname) !== hostname ||
    Date.parse(cert.validFrom) > Date.now() ||
    Date.parse(cert.validTo) <= Date.now()
  )
    throw new Error("Invalid staff certificate");
  const key = await readStaffKey(stateDir);
  createSecureContext({ key, cert: chain });
  await mkdirDurable(join(stateDir, CLOUD_DIR), 0o700);
  await writeFileDurable(join(stateDir, CLOUD_STAFF_CERT_FILE), chain, 0o600);
}

/** The remote listener forwards only the dashboard surface; a header cannot grant a local source. */
export function createStaffApp(app: Hono, origin: string): Hono {
  const staff = new Hono();
  const limit = bodyLimit({ maxSize: 65536 });
  staff.use("/management-api/*", (c, next) =>
    /^\/management-api\/(?:session$|passkey\/|password-reset$|account-actions\/|google\/)/.test(
      c.req.path,
    )
      ? limit(c, next)
      : next(),
  );
  let challengeWindowEnd = 0;
  let challenges = 0;
  staff.all("*", (c) => {
    const url = new URL(c.req.url);
    const path = url.pathname;
    if (url.origin !== origin || /%2f|%5c|%00/i.test(path)) return c.notFound();
    // These machine operations check a password outside the dashboard sign-in throttle.
    if (
      ["membership", "mirror-bundle", "promote"].some(
        (name) => path === `/management-api/${name}` || path.startsWith(`/management-api/${name}/`),
      )
    )
      return c.notFound();
    const read = c.req.method === "GET" || c.req.method === "HEAD";
    const allowed =
      path.startsWith("/management-api/") ||
      path.startsWith("/api/box/") ||
      path.startsWith("/api/backup/") ||
      (read &&
        (path === "/manage" ||
          path.startsWith("/manage/") ||
          path === "/api/theme" ||
          path === "/api/content-languages" ||
          path.startsWith("/media/") ||
          path.startsWith("/help/")));
    if (!allowed) return c.notFound();
    if (path === "/management-api/passkey/auth/options" && c.req.method === "POST") {
      const now = Date.now();
      if (now >= challengeWindowEnd) {
        challengeWindowEnd = now + 60000;
        challenges = 0;
      }
      if (challenges >= 20) {
        const retryAfterSeconds = Math.ceil((challengeWindowEnd - now) / 1000);
        c.header("Retry-After", String(retryAfterSeconds));
        return c.json(
          { error: { code: "password.throttled", params: { retryAfterSeconds } } },
          429,
        );
      }
      challenges++;
    }
    return app.fetch(c.req.raw, { ...(c.env as object), remoteStaff: true });
  });
  return staff;
}

export function startStaffListener(
  config: Pick<ServerConfig, "staff" | "stateDir">,
  app: Hono,
  log: Logger,
): { close(): Promise<void>; isListening(): boolean } | undefined {
  const staff = config.staff;
  if (staff === undefined) return undefined;
  const failure = (error: unknown) =>
    log("warn", "server.listen_failed", {
      listener: "staff",
      port: staff.port,
      code: (error as NodeJS.ErrnoException)?.code ?? "unknown",
    });
  try {
    const tls = {
      keyFile: join(config.stateDir, CLOUD_STAFF_KEY_FILE),
      certFile: join(config.stateDir, CLOUD_STAFF_CERT_FILE),
    };
    const server = serve(
      buildServeOptions(
        { fetch: createStaffApp(app, staff.origin).fetch, hostname: staff.host, port: staff.port },
        tls,
      ),
      (info) => log("info", "server.listening", { listener: "staff", port: info.port }),
    );
    server.on("error", failure);
    if (server instanceof HttpsServer)
      watchTlsFiles(server, tls, new URL(staff.origin).hostname, () =>
        log("error", "cloud.certificate_reload_failed"),
      );
    return { close: () => closeListener(server), isListening: () => server.listening };
  } catch (error) {
    failure(error);
    return undefined;
  }
}
