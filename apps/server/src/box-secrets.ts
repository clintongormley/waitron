import { mkdir, access, copyFile, readFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { generateKeyRing, type GeneratedKeyRing } from "@waitron/provisioning";
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
 * key ring would strand every sealed credential. `server.key` guards all four TLS PEMs (when it is
 * absent all four are re-minted over whatever exists); `secrets.env` guards only itself.
 *
 * Each file is written 0600 through a newly created working copy; `tls/` is created 0700, and a
 * directory that already exists keeps its mode.
 */
export async function ensureBoxSecrets(deps: EnsureBoxSecretsDeps): Promise<BoxTlsFiles> {
  const mint = deps.mint ?? mintSelfSignedServerCert;
  const makeKeyRing = deps.makeKeyRing ?? generateKeyRing;
  const listIpv4 = deps.listIpv4 ?? listBoxIpv4;

  const files = boxTlsPaths(deps.stateDir);
  await mkdir(files.tlsDir, { recursive: true, mode: 0o700 });

  // server.key is the presence sentinel for all four TLS files.
  if (!(await exists(files.keyFile))) {
    const m = mint({
      hostnames: deps.hostnames,
      ipAddresses: leafIpv4s(listIpv4),
      now: deps.now(),
    });
    // server.key is written LAST: a crash part-way leaves the sentinel absent, so the next boot
    // re-mints all four.
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
