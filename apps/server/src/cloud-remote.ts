import type { Hono } from "hono";
import { generateKeyPairSync, X509Certificate, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import forge from "node-forge";
import { createSecureContext } from "node:tls";

export function mountCloudPublic(app: Hono, serving: () => boolean): void {
  app.get("/public/availability", (c) => {
    const available = serving();
    c.header("Cache-Control", "no-store");
    return c.json({ available }, available ? 200 : 503);
  });
}

async function readStaffKey(stateDir: string): Promise<string> {
  const path = join(stateDir, "cloud-staff.key");
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
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = join(stateDir, "cloud-staff.key");
  try {
    await lstat(path);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    try {
      const file = await open(path, "wx", 0o600);
      try {
        await file.writeFile(privateKey.export({ type: "pkcs8", format: "pem" }));
        await file.sync();
      } finally {
        await file.close();
      }
      const directory = await open(stateDir, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
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
  const path = join(stateDir, "cloud-staff.crt"),
    temporary = path + "." + randomUUID();
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(chain);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const directory = await open(stateDir, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
