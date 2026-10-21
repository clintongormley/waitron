import {
  mkdir,
  access,
  chmod,
  copyFile,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { join } from "node:path";
import { generateKeyRing, readDurableHostJson, type GeneratedKeyRing } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { withRecoveryLock } from "./recovery-lock.js";
import "./errors.js";
import { listBoxIpv4 } from "./box-reach.js";
import {
  mintSelfSignedServerCert,
  isPermittedLeafIpv4,
  reissueServerLeaf,
} from "./self-signed-cert.js";
import { stageFile, stagedPath, writeFileAtomic } from "./fs-atomic.js";
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
  return join(stateDir, "tls", "ca.crt");
}

function boxTlsPaths(stateDir: string) {
  const tlsDir = join(stateDir, "tls");
  return {
    tlsDir,
    certFile: join(tlsDir, "server.crt"),
    keyFile: join(tlsDir, "server.key"),
    caCertFile: caCertPath(stateDir),
    caKeyFile: join(tlsDir, "ca.key"),
  };
}

function leafIpv4s(listIpv4: () => string[]): string[] {
  return Array.from(new Set(["127.0.0.1", ...listIpv4()])).filter(isPermittedLeafIpv4);
}

/**
 * The box's own minted leaf, or `undefined` when either half is missing: `buildServeOptions` reads
 * both, and a half-written pair would throw inside the serve call. A phone or till trusts the box's
 * CA, not the leaf, so a new leaf the same CA signs needs no new trust step.
 */
export function mintedBoxLeaf(stateDir: string): TlsFiles | undefined {
  const { certFile, keyFile } = boxTlsPaths(stateDir);
  if (!existsSync(certFile) || !existsSync(keyFile)) return undefined;
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

// Only ENOENT is "absent". Treating an unreadable file as absent would regenerate secrets.env's
// vault master key over one it merely could not read, orphaning everything sealed under it.
const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return false;
      throw err;
    },
  );

/**
 * Write the box's self-signed CA, leaf and vault key ring ONCE under `stateDir`, then reuse them on
 * every later boot, because a fresh CA would break every already-trusting setup client and a fresh
 * key ring would strand every sealed credential. A missing server key does not authorize replacing
 * retained TLS or vault material.
 *
 * Each file is written 0600 through a newly created working copy. A real `tls/` folder ends 0700
 * whether or not it already existed, as `unpackBundleToDir` leaves it on a restore. A `tls/` that
 * is a symlink keeps the mode of the folder it points to; a restore refuses one pointing outside
 * the destination.
 */
export async function ensureBoxSecrets(deps: EnsureBoxSecretsDeps): Promise<BoxTlsFiles> {
  await mkdir(deps.stateDir, { recursive: true, mode: 0o700 });
  return withRecoveryLock(deps.stateDir, () => ensureBoxSecretsLocked(deps));
}

async function ensureBoxSecretsLocked(deps: EnsureBoxSecretsDeps): Promise<BoxTlsFiles> {
  await assertNoPendingTlsRepair(deps.stateDir);
  const mint = deps.mint ?? mintSelfSignedServerCert;
  const makeKeyRing = deps.makeKeyRing ?? generateKeyRing;
  const listIpv4 = deps.listIpv4 ?? listBoxIpv4;

  const files = boxTlsPaths(deps.stateDir);
  await mkdir(files.tlsDir, { recursive: true, mode: 0o700 });
  await tightenTlsDir(deps.stateDir);

  if (!(await exists(files.keyFile))) {
    for (const path of [
      files.caCertFile,
      files.caKeyFile,
      files.certFile,
      `${files.certFile}.previous`,
      join(files.tlsDir, "repair-archive"),
      join(deps.stateDir, "secrets.env"),
    ]) {
      if (await exists(path)) throw new AppError("setup.not_ready", {});
    }
    const m = mint({
      hostnames: deps.hostnames,
      ipAddresses: leafIpv4s(listIpv4),
      now: deps.now(),
    });
    await writeFileAtomic(files.caCertFile, m.caCertPem, 0o600);
    await writeFileAtomic(files.caKeyFile, m.caKeyPem, 0o600);
    await writeFileAtomic(files.certFile, m.serverCertPem, 0o600);
    await writeFileAtomic(files.keyFile, m.serverKeyPem, 0o600);
  }

  const secretsFile = join(deps.stateDir, "secrets.env");
  if (!(await exists(secretsFile))) {
    const ring = makeKeyRing();
    const body = formatEnvFile({
      WAITRON_CREDENTIALS_KEY: ring.key,
      WAITRON_CREDENTIALS_KEY_VERSION: String(ring.version),
    });
    await writeFileAtomic(secretsFile, body, 0o600);
  }

  return { certFile: files.certFile, keyFile: files.keyFile, caCertFile: files.caCertFile };
}

/**
 * Replace the leaf with one naming THIS machine's addresses, signed by the authority already in
 * `<stateDir>/tls`, which stays untouched. The listener refuses a certificate whose key does not
 * match, so both new files are written under working names first and renamed into place only when
 * both are written; a failed write removes the working files and leaves the old pair, and a failed
 * key rename puts the old certificate back unless that rename fails too, when the old certificate
 * is kept as `server.crt.previous` until the next reissue overwrites it. What is left is a crash
 * between the two renames, or the key rename and the put-back both failing.
 */
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
  const pair = [
    { path: files.certFile, pem: leaf.serverCertPem },
    { path: files.keyFile, pem: leaf.serverKeyPem },
  ];
  const discardStaged = async () => {
    for (const { path } of pair) await rm(stagedPath(path), { force: true }).catch(() => {});
  };
  try {
    for (const { path, pem } of pair) await stageFile(path, pem, 0o600);
  } catch (error) {
    await discardStaged();
    throw error;
  }
  const previousCert = `${files.certFile}.previous`;
  let certReplaced = false;
  try {
    await copyFile(files.certFile, previousCert);
    await rename(stagedPath(files.certFile), files.certFile);
    certReplaced = true;
    await rename(stagedPath(files.keyFile), files.keyFile);
  } catch (error) {
    let putBackFailed = false;
    if (certReplaced) {
      await rename(previousCert, files.certFile).catch(() => {
        putBackFailed = true;
      });
    }
    await discardStaged();
    // A failed put-back leaves the copy as the only one of the old certificate.
    if (!putBackFailed) await rm(previousCert, { force: true }).catch(() => {});
    throw error;
  }
  await rm(previousCert, { force: true });
}

async function assertNoPendingTlsRepair(stateDir: string): Promise<void> {
  let tlsDir: string;
  try {
    tlsDir = await realpath(join(stateDir, "tls"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const record = await readDurableHostJson(join(tlsDir, "repair-pending.json"), 131072);
  if (record !== null && (record as { complete?: unknown }).complete !== true) {
    throw new AppError("setup.not_ready", {});
  }
}
