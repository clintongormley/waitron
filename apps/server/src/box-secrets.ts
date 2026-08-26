import { mkdir, writeFile, access } from "node:fs/promises";
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
 * Note on `{ mode: 0o600 }`: `writeFile` applies `mode` only when it CREATES the file, and the
 * effective mode is `mode & ~umask` — which is `0o600` for any sane umask (022/002/077). It is not
 * a post-hoc `chmod`, so do not "fix" it to one: on a reused file the guard means we never rewrite
 * it, and on a created one the umask cannot widen `0o600`.
 */
export async function ensureBoxSecrets(deps: EnsureBoxSecretsDeps): Promise<BoxTlsFiles> {
  const mint = deps.mint ?? mintSelfSignedServerCert;
  const makeKeyRing = deps.makeKeyRing ?? generateKeyRing;
  const makeToken = deps.makeToken ?? (() => randomBytes(32).toString("hex"));
  const listIpv4 = deps.listIpv4 ?? defaultListIpv4;

  const tlsDir = join(deps.stateDir, "tls");
  await mkdir(tlsDir, { recursive: true });
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
    await writeFile(files.caCertFile, m.caCertPem);
    await writeFile(files.caKeyFile, m.caKeyPem, { mode: 0o600 });
    await writeFile(files.certFile, m.serverCertPem);
    // server.key LAST, on purpose: it is the presence sentinel the guard above tests, so a crash
    // mid-write leaves it absent and the next boot re-mints the whole quartet cleanly rather than
    // serving a half-written set — the guard's correctness depends on this write ordering.
    await writeFile(files.keyFile, m.serverKeyPem, { mode: 0o600 });
  }

  const secretsFile = join(deps.stateDir, "secrets.env");
  if (!(await exists(secretsFile))) {
    const ring = makeKeyRing();
    const token = makeToken();
    const body =
      `WAITRON_CREDENTIALS_KEY=${ring.key}\n` +
      `WAITRON_CREDENTIALS_KEY_VERSION=${ring.version}\n` +
      `WAITRON_SYNC_NODE_TOKEN=${token}\n`;
    await writeFile(secretsFile, body, { mode: 0o600 });
  }

  return { certFile: files.certFile, keyFile: files.keyFile, caCertFile: files.caCertFile };
}
