import {
  SECRETS_ENV_FILE,
  TLS_DIR,
  TLS_REPAIR_DIR,
  TLS_REPAIR_FLOW_DIR,
  SERVER_PEM_FILE,
} from "@waitron/store";
import { chmod, lstat, open, readFile, type FileHandle } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { join } from "node:path";
import { generateKeyRing, readDurableHostJson, type GeneratedKeyRing } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { withRecoveryLock } from "./recovery-lock.js";
import "./errors.js";
import { listBoxIpv4 } from "./box-reach.js";
import { fileExists } from "./box-tls-install.js";
import { leafIpv4s, mintSelfSignedServerCert, reissueServerLeaf } from "./self-signed-cert.js";
import { mkdirDurable, writeFileDurable } from "./fs-atomic.js";
import { formatEnvFile } from "./env-file.js";
import type { TlsFiles } from "./tls.js";

/**
 * `certFile`/`keyFile` are the leaf; `caCertFile` is the CA a setup client trusts. The CA private
 * key is on disk too, for {@link reissueBoxLeaf}, but is not a server input, so it is not returned.
 */
export interface BoxTlsFiles {
  certFile: string;
  keyFile: string;
  caCertFile: string;
}

/** The box CA certificate's path, shared by its writer and every reader so none re-derives it. */
export function caCertPath(stateDir: string): string {
  return join(stateDir, TLS_DIR, "ca.crt");
}

/** The box CA private key's path, beside {@link caCertPath}. */
export function caKeyPath(stateDir: string): string {
  return join(stateDir, TLS_DIR, "ca.key");
}

function boxTlsPaths(stateDir: string) {
  const tlsDir = join(stateDir, TLS_DIR);
  return {
    tlsDir,
    certFile: join(stateDir, SERVER_PEM_FILE),
    keyFile: join(stateDir, SERVER_PEM_FILE),
    caCertFile: caCertPath(stateDir),
    caKeyFile: caKeyPath(stateDir),
  };
}

/** A key ring with its keys in base64, as `secrets.env` holds them. */
export interface EncodedKeyRing {
  key: string;
  version: number;
  previous?: { key: string; version: number };
}

/**
 * Replaces `secrets.env` whole with `ring`, so the next boot opens what the main box sealed.
 */
export async function writeCredentialsRing(stateDir: string, ring: EncodedKeyRing): Promise<void> {
  // Durable: node.db's commit is, and a key it holds sealed under this ring opens only with it.
  await writeFileDurable(join(stateDir, SECRETS_ENV_FILE), formatEnvFile(keyRingEnv(ring)), 0o600);
}

/** The ring's variables, as `loadKeyRing` reads them; the previous pair only when it has one. */
export function keyRingEnv(ring: EncodedKeyRing): Record<string, string> {
  const env: Record<string, string> = {
    WAITRON_CREDENTIALS_KEY: ring.key,
    WAITRON_CREDENTIALS_KEY_VERSION: String(ring.version),
  };
  if (ring.previous !== undefined) {
    env.WAITRON_CREDENTIALS_KEY_PREVIOUS = ring.previous.key;
    env.WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION = String(ring.previous.version);
  }
  return env;
}

export function mintedBoxLeaf(stateDir: string): TlsFiles | undefined {
  const { certFile, keyFile } = boxTlsPaths(stateDir);
  if (!existsSync(certFile)) return undefined;
  return { certFile, keyFile };
}

/**
 * A linked `tls`, and the folder it points to, are left as found. The folder is opened without
 * following a link and changed through that handle, so a `tls` swapped for a link mid-call is not
 * followed (outside the EACCES fallback below); a link higher up the path is.
 */
export async function tightenTlsDir(stateDir: string): Promise<void> {
  const { tlsDir } = boxTlsPaths(stateDir);
  let handle: FileHandle;
  try {
    handle = await open(tlsDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (err) {
    // ENOTDIR: `tls` is a link or a file, or the state folder is not a folder.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return;
    // A folder its owner cannot read refuses a non-root open (EACCES), so its mode is changed by
    // path, which would follow a link swapped in after the `lstat`.
    if (code === "EACCES" && (await lstat(tlsDir)).isDirectory()) return chmod(tlsDir, 0o700);
    throw err;
  }
  try {
    await handle.chmod(0o700);
  } finally {
    await handle.close();
  }
}

export interface EnsureBoxSecretsDeps {
  stateDir: string;
  /** dNSName SANs on the leaf. */
  hostnames: string[];
  now: () => Date;
  mint?: typeof mintSelfSignedServerCert;
  makeKeyRing?: () => GeneratedKeyRing;
  /**
   * The addresses the leaf's iPAddress SANs cover beyond 127.0.0.1. Boot passes the operator
   * override when one is configured, because a containerised box's own interface address is not the
   * one devices dial.
   */
  listIpv4?: () => string[];
}

/**
 * Write the box's self-signed CA, leaf and vault key ring ONCE under `stateDir`, then reuse them on
 * every later boot, because a fresh CA would break every already-trusting setup client and a fresh
 * key ring would strand every sealed credential. A missing server key does not authorize replacing
 * retained TLS or vault material.
 *
 * Each file is written 0600 through a newly created working copy. A real `tls/` folder ends 0700
 * whether or not it already existed, as `unpackStateFiles` leaves it on a restore. A `tls/` that
 * is a symlink keeps the mode of the folder it points to; a restore refuses one pointing outside
 * the destination.
 */
export async function ensureBoxSecrets(deps: EnsureBoxSecretsDeps): Promise<BoxTlsFiles> {
  await mkdirDurable(deps.stateDir, 0o700);
  return withRecoveryLock(deps.stateDir, () => ensureBoxSecretsLocked(deps));
}

async function ensureBoxSecretsLocked(deps: EnsureBoxSecretsDeps): Promise<BoxTlsFiles> {
  await assertNoPendingTlsRepair(deps.stateDir);
  const mint = deps.mint ?? mintSelfSignedServerCert;
  const makeKeyRing = deps.makeKeyRing ?? generateKeyRing;
  const listIpv4 = deps.listIpv4 ?? listBoxIpv4;

  const files = boxTlsPaths(deps.stateDir);
  await mkdirDurable(files.tlsDir, 0o700);
  await tightenTlsDir(deps.stateDir);

  if (!(await fileExists(files.keyFile))) {
    for (const path of [
      files.caCertFile,
      files.caKeyFile,
      join(deps.stateDir, TLS_REPAIR_DIR),
      join(deps.stateDir, SECRETS_ENV_FILE),
    ]) {
      if (await fileExists(path)) throw new AppError("setup.not_ready", {});
    }
    const m = mint({
      hostnames: deps.hostnames,
      ipAddresses: leafIpv4s(listIpv4),
      now: deps.now(),
    });
    await writeFileDurable(files.caCertFile, m.caCertPem, 0o600);
    await writeFileDurable(files.caKeyFile, m.caKeyPem, 0o600);
    await writeFileDurable(files.certFile, m.serverCertPem + m.serverKeyPem, 0o600);
  }

  const secretsFile = join(deps.stateDir, SECRETS_ENV_FILE);
  if (!(await fileExists(secretsFile))) {
    const ring = makeKeyRing();
    const body = formatEnvFile({
      WAITRON_CREDENTIALS_KEY: ring.key,
      WAITRON_CREDENTIALS_KEY_VERSION: String(ring.version),
    });
    await writeFileDurable(secretsFile, body, 0o600);
  }

  return { certFile: files.certFile, keyFile: files.keyFile, caCertFile: files.caCertFile };
}

export async function reissueBoxLeaf(deps: {
  stateDir: string;
  hostnames: string[];
  now: () => Date;
  listIpv4: () => string[];
}): Promise<void> {
  return withRecoveryLock(deps.stateDir, () => reissueBoxLeafLocked(deps));
}

async function reissueBoxLeafLocked(deps: {
  stateDir: string;
  hostnames: string[];
  now: () => Date;
  listIpv4: () => string[];
}): Promise<void> {
  await assertNoPendingTlsRepair(deps.stateDir);
  const files = boxTlsPaths(deps.stateDir);
  const leaf = reissueServerLeaf({
    caCertPem: await readFile(files.caCertFile, "utf8"),
    caKeyPem: await readFile(files.caKeyFile, "utf8"),
    hostnames: deps.hostnames,
    ipAddresses: leafIpv4s(deps.listIpv4),
    now: deps.now(),
  });
  await writeFileDurable(files.certFile, leaf.serverCertPem + leaf.serverKeyPem, 0o600);
}

/**
 * Reissues the box's leaf with {@link reissueBoxLeaf} when it lacks one of `hostnames` or a current
 * permitted address, does not verify under the current `tls/ca.crt`, or is not the certificate of
 * `tls/server.pem`; otherwise leaves the file untouched. A box with no minted leaf is left alone.
 */
export async function ensureLeaf(deps: {
  stateDir: string;
  hostnames: string[];
  listIpv4: () => string[];
  now: () => Date;
}): Promise<"kept" | "reissued"> {
  const files = boxTlsPaths(deps.stateDir);
  if (mintedBoxLeaf(deps.stateDir) === undefined) return "kept";
  const leaf = new X509Certificate(await readFile(files.certFile, "utf8"));
  const authority = new X509Certificate(await readFile(files.caCertFile, "utf8"));
  const key = createPrivateKey(await readFile(files.keyFile, "utf8"));
  const fits =
    leaf.verify(authority.publicKey) &&
    leaf.checkPrivateKey(key) &&
    deps.hostnames.every((host) => leaf.checkHost(host) === host) &&
    leafIpv4s(deps.listIpv4).every((ip) => leaf.checkIP(ip) === ip);
  if (fits) return "kept";
  await reissueBoxLeaf(deps);
  return "reissued";
}

async function assertNoPendingTlsRepair(stateDir: string): Promise<void> {
  const record = await readDurableHostJson(
    join(stateDir, TLS_REPAIR_FLOW_DIR, "record.json"),
    131072,
  );
  if (record !== null && (record as { complete?: unknown }).complete !== true) {
    throw new AppError("setup.not_ready", {});
  }
}
