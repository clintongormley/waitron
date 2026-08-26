import { mkdir, writeFile, access, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { generateKeyRing, type GeneratedKeyRing } from "@waitron/provisioning";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

/**
 * The three TLS file paths `node:https` needs to serve setup-mode HTTPS from the box's self-signed
 * identity — `cert`/`key` are the leaf, `caCertFile` is the CA a setup client trusts to accept it.
 * The CA private key (`ca.key`) is written to disk too, so the same CA can later re-sign a rotated
 * leaf, but it is not a server input, so it is not returned.
 */
export interface BoxTlsFiles {
  certFile: string;
  keyFile: string;
  caCertFile: string;
}

export interface EnsureBoxSecretsDeps {
  /** Directory the box owns its state under; the layout below is materialised beneath it. */
  stateDir: string;
  /**
   * dNSName SANs beyond the box IPs — defaults handled by the caller (boot passes
   * ["waitron.local", "localhost"]).
   */
  hostnames: string[];
  now: () => Date;
  // Injectables (all default to the real implementations):
  mint?: typeof mintSelfSignedServerCert;
  makeKeyRing?: () => GeneratedKeyRing; // default generateKeyRing
  makeToken?: () => string; // default randomBytes(32).toString("hex")
  listIpv4?: () => string[]; // default: non-internal IPv4s from os
}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

/**
 * Write `data` to `${path}.tmp` (same directory, so the following `rename` is atomic on POSIX) and
 * rename it onto `path`. A reader therefore only ever sees `path` absent or fully written — never a
 * torn/truncated file mid-write. `flag: "w"` truncates any stale `.tmp` left by an earlier crash.
 * `mode` (when given) is applied by `writeFile` on creating the temp file, and `rename` preserves it
 * on the target. This gives atomic VISIBILITY only; it does not fsync, so it makes no durability
 * claim across a power loss — only that the visible file is whole.
 */
async function writeFileAtomic(path: string, data: string, mode?: number): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data, mode === undefined ? { flag: "w" } : { mode, flag: "w" });
  await rename(tmp, path);
}

/**
 * The box's own non-internal IPv4 addresses, so a setup client on the LAN can dial the leaf by IP.
 * `internal` drops loopback (127.0.0.1 is added unconditionally by the caller) and the `IPv4`
 * filter drops the IPv6 entries `networkInterfaces` returns for the same interface.
 */
const defaultListIpv4 = (): string[] =>
  Object.values(networkInterfaces())
    .flat()
    .filter((n): n is NonNullable<typeof n> => !!n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);

/**
 * Materialise the box's self-signed cert + secrets ONCE under `stateDir`, then reuse them on every
 * later boot. Presence is the whole idempotency contract: each write is guarded on the target being
 * absent, so a second call returns byte-identical files and never regenerates a key or a token —
 * the tell a POS depends on, since a fresh cert on every boot would break every already-trusting
 * setup client and a fresh key ring would strand every sealed credential.
 *
 * Layout written/read (private material 0600, public certs default mode):
 *
 *     <stateDir>/tls/ca.crt          <stateDir>/tls/ca.key    (0600)
 *     <stateDir>/tls/server.crt      <stateDir>/tls/server.key (0600)
 *     <stateDir>/secrets.env         (0600)   # KEY=VALUE, LF-terminated
 *
 * The leaf's iPAddress SANs are `127.0.0.1` plus every detected non-internal IPv4 (deduped), so it
 * authenticates a dial by loopback or by LAN IP. This does NOT load or consume the secrets — that
 * is the next boot's job (slice 2b / trading); it only guarantees the files are present.
 *
 * Note on the `0o600` mode arg: `writeFileAtomic` passes it to `writeFile`, which applies `mode`
 * only when it CREATES the temp file, and `rename` preserves that mode on the target. The effective
 * mode is `mode & ~umask` — `0o600` for any sane umask (022/002/077). It is not a post-hoc `chmod`,
 * so do not "fix" it to one: on a reused file the presence guard means we never rewrite it, and on a
 * created one the umask cannot widen `0o600`.
 */
export async function ensureBoxSecrets(deps: EnsureBoxSecretsDeps): Promise<BoxTlsFiles> {
  const mint = deps.mint ?? mintSelfSignedServerCert;
  const makeKeyRing = deps.makeKeyRing ?? generateKeyRing;
  const makeToken = deps.makeToken ?? (() => randomBytes(32).toString("hex"));
  const listIpv4 = deps.listIpv4 ?? defaultListIpv4;

  const tlsDir = join(deps.stateDir, "tls");
  // 0o700 so the dir holding the private material is owner-only too (defense in depth around the
  // 0o600 files). `mode` applies only to dirs THIS call CREATES (tls and any missing parent such as
  // stateDir) and is subject to umask — 0o700 under any sane umask — matching the file-mode note.
  await mkdir(tlsDir, { recursive: true, mode: 0o700 });
  const files = {
    certFile: join(tlsDir, "server.crt"),
    keyFile: join(tlsDir, "server.key"),
    caCertFile: join(tlsDir, "ca.crt"),
    caKeyFile: join(tlsDir, "ca.key"),
  };

  // server.key is the presence sentinel for the whole TLS quartet: mint + write all four only when
  // it is absent, so a reused install keeps its already-trusted cert byte-for-byte.
  if (!(await exists(files.keyFile))) {
    const ips = Array.from(new Set(["127.0.0.1", ...listIpv4()]));
    const m = mint({ hostnames: deps.hostnames, ipAddresses: ips, now: deps.now() });
    // Each file is written to a temp path and atomically renamed, so a reader never observes a
    // partial or truncated PEM — only the whole file or its absence. server.key is renamed LAST, on
    // purpose: it is the quartet's presence sentinel the guard above tests, so a crash BETWEEN the
    // four renames leaves the quartet incomplete (server.key still absent) and the next boot re-mints
    // all four cleanly. The guard's correctness depends on this ordering.
    await writeFileAtomic(files.caCertFile, m.caCertPem);
    await writeFileAtomic(files.caKeyFile, m.caKeyPem, 0o600);
    await writeFileAtomic(files.certFile, m.serverCertPem);
    await writeFileAtomic(files.keyFile, m.serverKeyPem, 0o600);
  }

  const secretsFile = join(deps.stateDir, "secrets.env");
  if (!(await exists(secretsFile))) {
    const ring = makeKeyRing();
    const token = makeToken();
    const body =
      `WAITRON_CREDENTIALS_KEY=${ring.key}\n` +
      `WAITRON_CREDENTIALS_KEY_VERSION=${ring.version}\n` +
      `WAITRON_SYNC_NODE_TOKEN=${token}\n`;
    // A single atomic write: secrets.env holds the unrepairable vault master key, so it must never be
    // observed torn — temp-then-rename means it is either fully present or absent, never truncated.
    await writeFileAtomic(secretsFile, body, 0o600);
  }

  return { certFile: files.certFile, keyFile: files.keyFile, caCertFile: files.caCertFile };
}
