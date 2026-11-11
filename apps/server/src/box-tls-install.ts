import { TLS_DIR, TLS_INSTALL_FILE, TLS_JOINED_FILE } from "@waitron/store";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { access, realpath, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { readDurableHostJson } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import {
  mkdirDurable,
  stageFileDurable,
  stagedPath,
  syncFolderHolding,
  writeFileDurable,
} from "./fs-atomic.js";
import { withRecoveryLock } from "./recovery-lock.js";
import { leafIpv4s, reissueServerLeaf } from "./self-signed-cert.js";
import "./errors.js";

/** Every file an install may list. */
const TLS_SET = ["ca.key", "ca.crt", "server.pem"] as const;
type TlsSetFile = (typeof TLS_SET)[number];

const LIST_LIMIT = 4096;

// Only ENOENT is "absent". Treating an unreadable file as absent would regenerate secrets.env's
// vault master key over one it merely could not read, orphaning everything sealed under it.
export const fileExists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

/**
 * Records, durably, that this box joined the box `originNodeId` names. Adopt writes it before
 * anything of that venue's reaches this box, so a reset that finds it knows what to remove.
 */
export async function markJoined(stateDir: string, originNodeId: string): Promise<void> {
  await mkdirDurable(join(stateDir, TLS_DIR), 0o700);
  await writeFileDurable(join(stateDir, TLS_JOINED_FILE), JSON.stringify({ originNodeId }), 0o600);
}

export function joinedAnotherBox(stateDir: string): Promise<boolean> {
  return fileExists(join(stateDir, TLS_JOINED_FILE));
}

/**
 * Writes each of `files` under its working name and syncs it, then writes `install.json` naming
 * them. A stop at any point before the list is in
 * place leaves the old files whole, and {@link finishTlsInstall} deletes the working files; from
 * then on it finishes the moves. The caller holds the recovery lock, moves each file from
 * `stagedPath`, then calls {@link closeTlsInstall}.
 */
export async function stageTlsInstall(
  stateDir: string,
  files: ReadonlyArray<{ name: TlsSetFile; pem: string }>,
): Promise<void> {
  for (const { name, pem } of files) {
    await stageFileDurable(join(stateDir, TLS_DIR, name), pem, 0o600);
  }
  await writeFileDurable(
    join(stateDir, TLS_INSTALL_FILE),
    JSON.stringify({ files: files.map(({ name }) => name) }),
    0o600,
  );
}

/** Removes what {@link stageTlsInstall} wrote, ignoring anything already gone or not removable. */
export async function dropTlsInstall(
  stateDir: string,
  names: readonly TlsSetFile[],
): Promise<void> {
  for (const name of names) {
    await rm(stagedPath(join(stateDir, TLS_DIR, name)), { force: true }).catch(() => {});
  }
  await rm(join(stateDir, TLS_INSTALL_FILE), { force: true }).catch(() => {});
}

/** Once every listed file is in place: syncs the folder, removes the list, and syncs it again. */
export async function closeTlsInstall(stateDir: string): Promise<void> {
  const list = join(stateDir, TLS_INSTALL_FILE);
  await syncFolderHolding(list);
  await rm(list);
  await syncFolderHolding(list);
}

export interface InstallVenueAuthorityDeps {
  stateDir: string;
  authority: { certPem: string; keyPem: string };
  hostnames: string[];
  listIpv4: () => string[];
  now: () => Date;
}

/** Refuses, with `mirror.bundle_fetch_failed`, an authority certificate whose key is not `keyPem`. */
export function assertAuthorityKeyMatches(certPem: string, keyPem: string): void {
  if (!keyBelongsTo(certPem, keyPem)) throw new AppError("mirror.bundle_fetch_failed", {});
}

/**
 * Makes `authority`, and a leaf it signs for `hostnames`, this box's own `tls/` set, through
 * {@link stageTlsInstall}. Refuses, through {@link assertAuthorityKeyMatches} and before it writes
 * anything, an authority certificate whose key is not the one given.
 */
export async function installVenueAuthority(deps: InstallVenueAuthorityDeps): Promise<void> {
  const { certPem, keyPem } = deps.authority;
  assertAuthorityKeyMatches(certPem, keyPem);
  const leaf = reissueServerLeaf({
    caCertPem: certPem,
    caKeyPem: keyPem,
    hostnames: deps.hostnames,
    ipAddresses: leafIpv4s(deps.listIpv4),
    now: deps.now(),
  });
  const files = [
    { name: "ca.key", pem: keyPem },
    { name: "ca.crt", pem: certPem },
    { name: "server.pem", pem: leaf.serverCertPem + leaf.serverKeyPem },
  ] as const;
  const tlsDir = join(deps.stateDir, TLS_DIR);
  await withRecoveryLock(deps.stateDir, async () => {
    await mkdirDurable(tlsDir, 0o700);
    await stageTlsInstall(deps.stateDir, files);
    for (const { name } of files) {
      await rename(stagedPath(join(tlsDir, name)), join(tlsDir, name));
    }
    await closeTlsInstall(deps.stateDir);
  });
}

function keyBelongsTo(certPem: string, keyPem: string): boolean {
  try {
    return new X509Certificate(certPem).checkPrivateKey(createPrivateKey(keyPem));
  } catch {
    return false;
  }
}

async function anyExists(paths: readonly string[]): Promise<boolean> {
  for (const path of paths) if (await fileExists(path)) return true;
  return false;
}

function listedFiles(value: unknown): TlsSetFile[] {
  const files = (value as { files?: unknown }).files;
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.some((name) => !(TLS_SET as readonly unknown[]).includes(name))
  ) {
    throw new AppError("setup.not_ready", {});
  }
  return files as TlsSetFile[];
}

/**
 * Moves into place what a listed install left, and deletes every other
 * working file of the set and of the list. Each entry runs it before it first reads `tls/`, on a
 * disk that may be full, so with none of those files present it takes no lock and writes nothing.
 */
export async function finishTlsInstall(
  stateDir: string,
): Promise<"none" | "finished" | "discarded"> {
  const tlsDir = join(stateDir, TLS_DIR);
  if (!(await fileExists(tlsDir))) return "none";
  const list = join(stateDir, TLS_INSTALL_FILE);
  const leftovers = [list, ...[...TLS_SET.map((name) => join(tlsDir, name)), list].map(stagedPath)];
  if (!(await anyExists(leftovers))) return "none";
  return withRecoveryLock(stateDir, async () => {
    // Read through the folder `tls` resolves to: the reader refuses a linked parent folder.
    const record = await readDurableHostJson(
      join(await realpath(tlsDir), basename(TLS_INSTALL_FILE)),
      LIST_LIMIT,
    );
    const listed = record === null ? [] : listedFiles(record);
    for (const name of listed) {
      const working = stagedPath(join(tlsDir, name));
      if (await fileExists(working)) await rename(working, join(tlsDir, name));
    }
    let discarded = false;
    for (const working of [...TLS_SET.map((name) => join(tlsDir, name)), list].map(stagedPath)) {
      if (!(await fileExists(working))) continue;
      await rm(working);
      discarded = true;
    }
    if (record === null) {
      if (!discarded) return "none";
      await syncFolderHolding(list);
      return "discarded";
    }
    await closeTlsInstall(stateDir);
    return "finished";
  });
}
