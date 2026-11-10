import { TLS_DIR, TLS_INSTALL_FILE, TLS_JOINED_FILE } from "@waitron/store";
import { access, readFile, rename as renameFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { leafIpv4s } from "./box-secrets.js";
import { mkdirDurable, syncFolderHolding, writeFileDurable } from "./fs-atomic.js";
import { withRecoveryLock } from "./recovery-lock.js";
import { reissueServerLeaf } from "./self-signed-cert.js";

const INSTALLED = ["ca.crt", "ca.key", "server.crt", "server.key"] as const;

const workingName = (name: string) => `${name}.install`;

const present = (path: string): Promise<boolean> =>
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
  return present(join(stateDir, TLS_JOINED_FILE));
}

export interface InstallVenueAuthorityDeps {
  stateDir: string;
  authority: { certPem: string; keyPem: string };
  hostnames: string[];
  listIpv4: () => string[];
  now: () => Date;
  /** Test seam: each move of a working file into place. */
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Makes `authority`, and a leaf it signs for `hostnames`, this box's own `tls/` set. The four files
 * are written under working names, then `install.json` lists them, then each is moved into place,
 * then the list goes: a stop before the list leaves the old set whole, and a stop after it is
 * finished by {@link finishTlsInstall} at the next start, before that start reads `tls/`.
 */
export async function installVenueAuthority(deps: InstallVenueAuthorityDeps): Promise<void> {
  const leaf = reissueServerLeaf({
    caCertPem: deps.authority.certPem,
    caKeyPem: deps.authority.keyPem,
    hostnames: deps.hostnames,
    ipAddresses: leafIpv4s(deps.listIpv4),
    now: deps.now(),
  });
  const contents: Record<(typeof INSTALLED)[number], string> = {
    "ca.crt": deps.authority.certPem,
    "ca.key": deps.authority.keyPem,
    "server.crt": leaf.serverCertPem,
    "server.key": leaf.serverKeyPem,
  };
  const tlsDir = join(deps.stateDir, TLS_DIR);
  const rename = deps.rename ?? renameFile;
  await withRecoveryLock(deps.stateDir, async () => {
    await mkdirDurable(tlsDir, 0o700);
    for (const name of INSTALLED) {
      await writeFileDurable(join(tlsDir, workingName(name)), contents[name], 0o600);
    }
    const list = join(deps.stateDir, TLS_INSTALL_FILE);
    await writeFileDurable(list, JSON.stringify({ files: INSTALLED }), 0o600);
    for (const name of INSTALLED) {
      await rename(join(tlsDir, workingName(name)), join(tlsDir, name));
    }
    await syncFolderHolding(list);
    await rm(list);
    await syncFolderHolding(list);
  });
}

/**
 * Moves into place what a listed install left, or deletes working files no list names. `runEntry`,
 * `startServerOrFirstSetupResolution` and `bootServer` each call it before they first read
 * `tls/`, so the entries' connection check sees a whole set.
 */
export async function finishTlsInstall(
  stateDir: string,
): Promise<"none" | "finished" | "discarded"> {
  const tlsDir = join(stateDir, TLS_DIR);
  if (!(await present(tlsDir))) return "none";
  return withRecoveryLock(stateDir, async () => {
    const list = join(stateDir, TLS_INSTALL_FILE);
    let listed: unknown;
    try {
      listed = (JSON.parse(await readFile(list, "utf8")) as { files?: unknown }).files;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      let discarded = false;
      for (const name of INSTALLED) {
        const working = join(tlsDir, workingName(name));
        if (!(await present(working))) continue;
        await rm(working);
        discarded = true;
      }
      if (!discarded) return "none";
      await syncFolderHolding(list);
      return "discarded";
    }
    for (const name of INSTALLED) {
      if (!Array.isArray(listed) || !listed.includes(name)) continue;
      const working = join(tlsDir, workingName(name));
      if (await present(working)) await renameFile(working, join(tlsDir, name));
    }
    await syncFolderHolding(list);
    await rm(list);
    await syncFolderHolding(list);
    return "finished";
  });
}
