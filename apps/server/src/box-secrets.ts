import { mkdir, access } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { generateKeyRing, type GeneratedKeyRing } from "@waitron/provisioning";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { writeFileAtomic } from "./fs-atomic.js";
import { formatEnvFile } from "./env-file.js";

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

/**
 * The on-disk path of the box's self-signed CA certificate under a state dir. Exported as the ONE
 * source of truth for the `tls/ca.crt` layout convention: `ensureBoxSecrets` WRITES it here and
 * `discovery-api.ts`'s `GET /setup-api/ca.crt` READS it back, so neither re-derives the path and the
 * two can never drift apart (CLAUDE.md §1's "grep the siblings before asserting a convention").
 */
export function caCertPath(stateDir: string): string {
  return join(stateDir, "tls", "ca.crt");
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
  listIpv4?: () => string[]; // default: non-internal IPv4s from os
}

// ENOENT means genuinely absent, so callers proceed to mint. Any other error (EACCES/EIO/etc.) is
// "can't tell" rather than "absent" — treating it as absent would make ensureBoxSecrets regenerate
// secrets.env's unrepairable vault master key over an existing one it merely couldn't read, orphaning
// anything already sealed under it. Rethrow instead, so setup boot fails loudly.
const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return false;
      throw err;
    },
  );

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
 * absent, so a second call returns byte-identical files and never regenerates a key —
 * the tell a POS depends on, since a fresh cert on every boot would break every already-trusting
 * setup client and a fresh key ring would strand every sealed credential.
 *
 * Layout written/read — the four PEMs and secrets.env are each written 0600 (owner-only), which is
 * the guarantee that matters; the `tls/` subdir (and `<stateDir>` itself, when this call creates it)
 * is made 0700, but a PRE-EXISTING `<stateDir>` keeps whatever mode it already had — we do not chmod
 * a directory the operator supplied:
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
  const listIpv4 = deps.listIpv4 ?? defaultListIpv4;

  const tlsDir = join(deps.stateDir, "tls");
  // 0o700 so the dir holding the private material is owner-only too (defense in depth around the
  // 0o600 files). `mode` applies only to dirs THIS call CREATES (tls and any missing parent such as
  // stateDir) and is subject to umask — 0o700 under any sane umask — matching the file-mode note.
  await mkdir(tlsDir, { recursive: true, mode: 0o700 });
  const files = {
    certFile: join(tlsDir, "server.crt"),
    keyFile: join(tlsDir, "server.key"),
    caCertFile: caCertPath(deps.stateDir),
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
    // All four PEMs are written 0600: the CA cert and the leaf cert are public-by-content (they carry
    // no secret), but both live in the 0700 state dir, owned by the server process, and the CA cert is
    // distributed to a setup client via an HTTP route (a later slice) that reads it server-side — not
    // via world-read filesystem permissions — so there is no reason for either to be world-readable.
    // Uniform 0600 across all persisted material is simpler to reason about than a two-tier scheme.
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
    // A single atomic write: secrets.env holds the unrepairable vault master key, so it must never be
    // observed torn — temp-then-rename means it is either fully present or absent, never truncated.
    await writeFileAtomic(secretsFile, body, 0o600);
  }

  return { certFile: files.certFile, keyFile: files.keyFile, caCertFile: files.caCertFile };
}
