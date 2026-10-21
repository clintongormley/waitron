import { X509Certificate, createPrivateKey, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { createSecureContext } from "node:tls";
import { AppError } from "@waitron/shared";
import { readDurableHostJson, writeDurableHostJson } from "@waitron/provisioning";
import forge from "node-forge";
import { withRecoveryLock } from "./recovery-lock.js";
import {
  hasBoxCaConstraints,
  isPermittedLeafIpv4,
  mintSelfSignedServerCert,
  reissueServerLeaf,
  type SelfSignedMaterial,
} from "./self-signed-cert.js";
import "./errors.js";

export interface BoxTlsRepairDeps {
  stateDir: string;
  hostnames: string[];
  listIpv4: () => string[];
  now: () => Date;
}
export interface BoxTlsInspection {
  state: "healthy" | "repair-required" | "refused";
  trust: "retained" | "new-required";
  caAvailable: boolean;
  fingerprint?: string;
}
const names = ["ca.crt", "ca.key", "server.crt", "server.key", "server.crt.previous"] as const;
type Member = (typeof names)[number];
type Snapshot = Record<Member, Buffer | null>;
interface Pending {
  operation: string;
  complete: boolean;
  trust: BoxTlsInspection["trust"];
}
const limit = 131072;
const refused = () => new AppError("setup.not_ready", {});
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const tlsDir = (deps: BoxTlsRepairDeps) => join(deps.stateDir, "tls");
const pendingPath = (deps: BoxTlsRepairDeps) => join(tlsDir(deps), "repair-pending.json");
function addresses(deps: BoxTlsRepairDeps) {
  return [...new Set(["127.0.0.1", ...deps.listIpv4()])].filter(isPermittedLeafIpv4);
}
function current(cert: X509Certificate, now: Date) {
  return Date.parse(cert.validFrom) <= now.getTime() && Date.parse(cert.validTo) > now.getTime();
}
async function regularDirectory(path: string) {
  const info = await fs.lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw refused();
}
async function readMember(path: string): Promise<Buffer | null> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (missing(error)) return null;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw refused();
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw refused();
    const bytes = await handle.readFile();
    if (bytes.length > limit) throw refused();
    return bytes;
  } finally {
    await handle.close();
  }
}
async function snapshot(deps: BoxTlsRepairDeps, directory = tlsDir(deps)): Promise<Snapshot> {
  try {
    await regularDirectory(directory);
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const result = {} as Snapshot;
  for (const name of names) result[name] = await readMember(join(directory, name));
  return result;
}
async function pending(deps: BoxTlsRepairDeps, directory = tlsDir(deps)): Promise<Pending | null> {
  const value = await readDurableHostJson(join(directory, "repair-pending.json"), limit);
  if (value === null) return null;
  const p = value as Pending;
  if (
    typeof p.operation !== "string" ||
    !/^[a-f0-9-]{36}$/.test(p.operation) ||
    typeof p.complete !== "boolean" ||
    !["retained", "new-required"].includes(p.trust)
  )
    throw refused();
  return p;
}
function caPublic(bytes: Buffer | null, now: Date): X509Certificate | null {
  try {
    if (bytes === null) return null;
    const ca = new X509Certificate(bytes);
    return ca.ca &&
      current(ca, now) &&
      ca.verify(ca.publicKey) &&
      hasBoxCaConstraints(bytes.toString("utf8"))
      ? ca
      : null;
  } catch {
    return null;
  }
}
export async function readBoxPublicCa(stateDir: string, now = new Date()): Promise<string | null> {
  const pem = await fs.readFile(join(stateDir, "tls", "ca.crt"), "utf8");
  const ca = caPublic(Buffer.from(pem), now);
  // A parsed certificate is public; the rest of its source file may contain private material.
  return ca === null
    ? null
    : ca
        .toString()
        .replaceAll("\n", pem.includes("-----BEGIN CERTIFICATE-----\r\n") ? "\r\n" : "\n");
}

function signingAuthority(s: Snapshot, now: Date): boolean {
  try {
    return (
      s["ca.key"] !== null &&
      caPublic(s["ca.crt"], now)?.checkPrivateKey(createPrivateKey(s["ca.key"])) === true
    );
  } catch {
    return false;
  }
}
function healthy(s: Snapshot, deps: BoxTlsRepairDeps): boolean {
  try {
    const ca = caPublic(s["ca.crt"], deps.now());
    if (ca === null || s["server.crt"] === null || s["server.key"] === null) return false;
    const leaf = new X509Certificate(s["server.crt"]);
    if (
      leaf.ca ||
      !current(leaf, deps.now()) ||
      !leaf.checkIssued(ca) ||
      !leaf.verify(ca.publicKey) ||
      !leaf.checkPrivateKey(createPrivateKey(s["server.key"]))
    )
      return false;
    if (
      deps.hostnames.some((name) => leaf.checkHost(name) !== name) ||
      addresses(deps).some((ip) => leaf.checkIP(ip) !== ip)
    )
      return false;
    const usage = forge.pki
      .certificateFromPem(s["server.crt"].toString("utf8"))
      .getExtension("extKeyUsage") as { serverAuth?: boolean } | null;
    if (usage?.serverAuth !== true) return false;
    createSecureContext({ cert: s["server.crt"], key: s["server.key"] });
    return true;
  } catch {
    return false;
  }
}
function inspection(s: Snapshot, deps: BoxTlsRepairDeps, p: Pending | null): BoxTlsInspection {
  const ca = caPublic(s["ca.crt"], deps.now());
  const usable = healthy(s, deps);
  return {
    state: usable && p?.complete !== false ? "healthy" : "repair-required",
    trust:
      p?.complete === false
        ? p.trust
        : usable
          ? (p?.trust ?? "retained")
          : signingAuthority(s, deps.now())
            ? "retained"
            : "new-required",
    caAvailable: ca !== null && (usable || signingAuthority(s, deps.now())),
    ...(ca === null ? {} : { fingerprint: ca.fingerprint256 }),
  };
}
export async function inspectBoxTls(
  deps: BoxTlsRepairDeps,
  options: { allowLinkedTlsDirectory?: boolean } = {},
): Promise<BoxTlsInspection> {
  try {
    const directory =
      options.allowLinkedTlsDirectory === true ? await fs.realpath(tlsDir(deps)) : tlsDir(deps);
    return inspection(await snapshot(deps, directory), deps, await pending(deps, directory));
  } catch {
    return { state: "refused", trust: "new-required", caAvailable: false };
  }
}
async function syncDirectory(path: string) {
  const directory = await fs.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
  );
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function durableFile(path: string, bytes: string | Buffer, exclusive: boolean) {
  const temporary = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!exclusive) await fs.rename(temporary, path);
  } finally {
    if (!exclusive) await fs.rm(temporary, { force: true });
  }
}
function candidateSnapshot(m: SelfSignedMaterial): Snapshot {
  return {
    "ca.crt": Buffer.from(m.caCertPem),
    "ca.key": Buffer.from(m.caKeyPem),
    "server.crt": Buffer.from(m.serverCertPem),
    "server.key": Buffer.from(m.serverKeyPem),
    "server.crt.previous": null,
  };
}
function readCandidate(value: unknown, deps: BoxTlsRepairDeps): SelfSignedMaterial {
  const m = value as SelfSignedMaterial | null;
  if (
    m === null ||
    [m.caCertPem, m.caKeyPem, m.serverCertPem, m.serverKeyPem].some((v) => typeof v !== "string")
  )
    throw refused();
  const s = candidateSnapshot(m);
  if (!healthy(s, deps) || !signingAuthority(s, deps.now())) throw refused();
  return m;
}
export async function repairBoxTls(deps: BoxTlsRepairDeps): Promise<BoxTlsInspection> {
  await fs.mkdir(deps.stateDir, { recursive: true, mode: 0o700 });
  return withRecoveryLock(deps.stateDir, async () => {
    const s = await snapshot(deps);
    let p = await pending(deps);
    const inspected = inspection(s, deps, p);
    if (inspected.state === "healthy") return inspected;
    await fs.mkdir(tlsDir(deps), { recursive: true, mode: 0o700 });
    await fs.chmod(tlsDir(deps), 0o700);
    const archiveRoot = join(tlsDir(deps), "repair-archive");
    await fs.mkdir(archiveRoot, { recursive: true, mode: 0o700 });
    await regularDirectory(archiveRoot);
    await fs.chmod(archiveRoot, 0o700);
    if (p?.complete !== false) {
      const operation = randomUUID();
      const folder = join(archiveRoot, operation);
      await fs.mkdir(folder, { mode: 0o700 });
      for (const name of names)
        if (s[name] !== null) await durableFile(join(folder, name), s[name], true);
      await writeDurableHostJson(
        join(folder, "manifest.json"),
        { version: 1, absent: names.filter((name) => s[name] === null) },
        limit,
      );
      await syncDirectory(folder);
      await syncDirectory(archiveRoot);
      await syncDirectory(tlsDir(deps));
      await syncDirectory(deps.stateDir);
      p = {
        operation,
        complete: false,
        trust: signingAuthority(s, deps.now()) ? "retained" : "new-required",
      };
      await writeDurableHostJson(pendingPath(deps), p, limit);
    }
    const folder = join(archiveRoot, p.operation);
    await regularDirectory(folder);
    let saved = await readDurableHostJson(join(folder, "candidate.json"), limit);
    if (saved === null) {
      const manifest = (await readDurableHostJson(join(folder, "manifest.json"), limit)) as {
        absent?: unknown;
      } | null;
      if (
        !Array.isArray(manifest?.absent) ||
        manifest.absent.some((name: unknown) => !names.includes(name as Member))
      )
        throw refused();
      for (const name of names) {
        const original = await readMember(join(folder, name));
        if (
          manifest.absent.includes(name) !== (original === null) ||
          (original === null ? s[name] !== null : s[name] === null || !original.equals(s[name]))
        )
          throw refused();
      }
      const m =
        p.trust === "retained"
          ? {
              caCertPem: s["ca.crt"]!.toString("utf8"),
              caKeyPem: s["ca.key"]!.toString("utf8"),
              ...reissueServerLeaf({
                caCertPem: s["ca.crt"]!.toString("utf8"),
                caKeyPem: s["ca.key"]!.toString("utf8"),
                hostnames: deps.hostnames,
                ipAddresses: addresses(deps),
                now: deps.now(),
              }),
            }
          : mintSelfSignedServerCert({
              hostnames: deps.hostnames,
              ipAddresses: addresses(deps),
              now: deps.now(),
            });
      readCandidate(m, deps);
      await writeDurableHostJson(join(folder, "candidate.json"), m, limit);
      saved = m;
    }
    // The reserved generation survives a restart before or after its candidate becomes durable.
    const m = readCandidate(saved, deps);
    const candidate = candidateSnapshot(m);
    for (const name of names.slice(0, 4)) {
      if (p.trust === "retained" && (name === "ca.crt" || name === "ca.key")) {
        if (!s[name]?.equals(candidate[name]!)) throw refused();
        continue;
      }
      await durableFile(join(tlsDir(deps), name), candidate[name]!, false);
      await syncDirectory(tlsDir(deps));
    }
    const installed = await snapshot(deps);
    if (!healthy(installed, deps)) throw refused();
    p = { ...p, complete: true };
    await writeDurableHostJson(pendingPath(deps), p, limit);
    return inspection(installed, deps, p);
  });
}
