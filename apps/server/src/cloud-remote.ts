import { mkdirDurable, writeFileDurable } from "@waitron/provisioning";
import { CLOUD_DIR, CLOUD_STAFF_KEY_FILE, CLOUD_STAFF_CERT_FILE } from "@waitron/store";
import { isDashboardAssetPath, isDashboardPath } from "@waitron/shared";
import { mountSpa } from "./spa-api.js";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { Server as HttpsServer } from "node:https";
import {
  buildServeOptions,
  watchTlsFiles,
  certificateHostname,
  validateTlsIdentity,
} from "./tls.js";
import { closeListener } from "./close-listener.js";
import type { ServerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { generateKeyPair, X509Certificate, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { validStaffHostname } from "./cloud-tunnel.js";
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
  if (!validStaffHostname(hostname))
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
export function createStaffApp(
  app: Hono,
  origin: () => Promise<string | undefined>,
  pages?: { root: string; gates?: readonly MiddlewareHandler[] },
  log: Logger = () => {},
): Hono {
  const staff = new Hono();
  const dashboard = new Hono();
  if (pages !== undefined) {
    for (const gate of pages.gates ?? []) dashboard.use("*", gate);
    mountSpa(dashboard, { root: pages.root, basePath: "", navigationPath: isDashboardPath }, log);
  }
  staff.use("*", async (c, next) => {
    try {
      const admittedOrigin = await origin();
      if (admittedOrigin === undefined || new URL(c.req.url).origin !== admittedOrigin)
        return c.notFound();
    } catch {
      return c.notFound();
    }
    return next();
  });
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
    if (/%2f|%5c|%00/i.test(path)) return c.notFound();
    // These machine operations check a password outside the dashboard sign-in throttle.
    if (
      ["membership", "mirror-bundle", "promote"].some(
        (name) => path === `/management-api/${name}` || path.startsWith(`/management-api/${name}/`),
      )
    )
      return c.notFound();
    const read = c.req.method === "GET" || c.req.method === "HEAD";
    if (read && (isDashboardPath(path) || isDashboardAssetPath(path)))
      return dashboard.fetch(c.req.raw, c.env);
    const allowed =
      path.startsWith("/management-api/") ||
      path.startsWith("/api/box/") ||
      path.startsWith("/api/backup/") ||
      (read &&
        (path === "/api/theme" ||
          path === "/api/content-languages" ||
          path.startsWith("/media/") ||
          path.startsWith("/help/") ||
          path.startsWith("/legal/")));
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
  config: Pick<ServerConfig, "staff" | "stateDir" | "dashboardAppDir">,
  app: Hono,
  log: Logger,
  admitted: () => Promise<boolean>,
  pageGates: readonly MiddlewareHandler[] = [],
): { close(): Promise<void>; isListening(): boolean; checkNow(): void } | undefined {
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
    const key = readFileSync(tls.keyFile),
      cert = readFileSync(tls.certFile);
    validateTlsIdentity(key, cert, certificateHostname(cert));
    let watcher: ReturnType<typeof watchTlsFiles>;
    const server = serve(
      buildServeOptions(
        {
          fetch: createStaffApp(
            app,
            async () => ((await admitted()) ? `https://${watcher.hostname()}` : undefined),
            config.dashboardAppDir === undefined
              ? undefined
              : { root: config.dashboardAppDir, gates: pageGates },
            log,
          ).fetch,
          hostname: staff.host,
          port: staff.port,
        },
        tls,
      ),
      (info) => log("info", "server.listening", { listener: "staff", port: info.port }),
    );
    server.on("error", failure);
    if (!(server instanceof HttpsServer)) throw new Error("Staff listener requires HTTPS");
    watcher = watchTlsFiles(server, tls, undefined, () =>
      log("error", "cloud.certificate_reload_failed"),
    );
    return {
      close: () => closeListener(server),
      isListening: () => server.listening,
      checkNow: () => watcher.checkNow(),
    };
  } catch (error) {
    failure(error);
    return undefined;
  }
}
