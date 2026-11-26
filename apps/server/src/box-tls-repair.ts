import {
  TLS_DIR,
  TLS_PREVIOUS_CERTIFICATE_FILE,
  TLS_REPAIR_DIR,
  TLS_REPAIR_FLOW_DIR,
  SCRATCH_DIR,
} from "@waitron/store";
import { X509Certificate, createPrivateKey, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { createSecureContext } from "node:tls";
import { AppError } from "@waitron/shared";
import { readDurableHostJson, writeDurableHostJson } from "@waitron/provisioning";
import { withRecoveryLock } from "./recovery-lock.js";
import {
  boxCertCurrent,
  boxLeafChain,
  boxRootIdentity,
  boxSigner,
  leafIpv4s,
  mintSelfSignedServerCert,
  reissueServerLeaf,
  type SelfSignedMaterial,
} from "./self-signed-cert.js";
import "./errors.js";
import { mkdirDurable, syncFolderHolding } from "./fs-atomic.js";

export interface BoxTlsRepairDeps {
  stateDir: string;
  hostnames: string[];
  listIpv4: () => string[];
  now: () => Date;
}
export interface PreviousCertificate {
  name: string;
  fingerprint: string;
  thumbprint: string;
}
export interface CertificateDetails {
  certificateName?: string;
  fingerprint?: string;
  previousCertificate?: PreviousCertificate;
}
export interface BoxTlsInspection extends CertificateDetails {
  state: "healthy" | "repair-required" | "refused";
  trust: "retained" | "new-required";
  caAvailable: boolean;
}
const names = ["ca.crt", "ca.key", "server.pem"] as const;
type Member = (typeof names)[number];
type Snapshot = Record<Member, Buffer | null>;
interface Pending {
  operation: string;
  complete: boolean;
  trust: BoxTlsInspection["trust"];
}
const RETIRED_TLS_NAMES = [
  "server.crt",
  "server.key",
  "server.crt.previous",
  "repair-pending.json",
  "repair-archive",
] as const;
const limit = 131072;
const refused = () => new AppError("setup.not_ready", {});
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const tlsDir = (deps: BoxTlsRepairDeps) => join(deps.stateDir, TLS_DIR);
const flowDir = (deps: BoxTlsRepairDeps) => join(deps.stateDir, TLS_REPAIR_FLOW_DIR);
const pendingPath = (deps: BoxTlsRepairDeps) => join(flowDir(deps), "record.json");
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
async function pending(deps: BoxTlsRepairDeps): Promise<Pending | null> {
  const value = await readDurableHostJson(pendingPath(deps), limit);
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
function caPublic(pem: string, now: Date) {
  try {
    const ca = boxRootIdentity(pem);
    return ca && boxCertCurrent(ca.cert, now) ? ca : null;
  } catch {
    return null;
  }
}

function firstCertificatePem(pem: string): string {
  return pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0] ?? "";
}

export async function readBoxPublicCa(stateDir: string, now = new Date()): Promise<string | null> {
  const pem = await fs.readFile(join(stateDir, TLS_DIR, "ca.crt"), "utf8");
  const publicPem = firstCertificatePem(pem);
  if (!publicPem) return null;
  const ca = caPublic(publicPem, now);
  return ca?.cert.toString().replaceAll("\n", publicPem.includes("\r\n") ? "\r\n" : "\n") ?? null;
}

async function previousCertificateFor(
  stateDir: string,
  fingerprint: string | undefined,
): Promise<PreviousCertificate | undefined> {
  if (!fingerprint) return;
  const record = (await readDurableHostJson(
    join(stateDir, TLS_PREVIOUS_CERTIFICATE_FILE),
    limit,
  ).catch(() => null)) as { replacement?: string; previous?: PreviousCertificate } | null;
  const previous = record?.previous;
  if (
    record?.replacement === fingerprint &&
    typeof previous?.name === "string" &&
    previous.name.length > 0 &&
    typeof previous.fingerprint === "string" &&
    /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(previous.fingerprint) &&
    previous.fingerprint !== fingerprint &&
    typeof previous.thumbprint === "string" &&
    /^[0-9A-F]{40}$/.test(previous.thumbprint)
  )
    return {
      name: previous.name,
      fingerprint: previous.fingerprint,
      thumbprint: previous.thumbprint,
    };
}

export async function readBoxCertificateDetails(stateDir: string): Promise<CertificateDetails> {
  const pem = await readBoxPublicCa(stateDir).catch(() => null);
  const ca = pem && boxRootIdentity(pem);
  if (!ca) return {};
  const fingerprint = ca.cert.fingerprint256;
  return {
    certificateName: ca.name,
    fingerprint,
    previousCertificate: await previousCertificateFor(stateDir, fingerprint),
  };
}

function signingAuthority(s: Snapshot, now: Date): boolean {
  try {
    const ca = caPublic(s["ca.crt"]?.toString("utf8") ?? "", now);
    const signer = ca && s["ca.key"] && boxSigner(s["ca.key"].toString("utf8"), ca.cert);
    return signer !== null && boxCertCurrent(signer.cert, now);
  } catch {
    return false;
  }
}
function healthy(
  s: Snapshot,
  deps: BoxTlsRepairDeps,
  checkAddresses = true,
  checkLeafTime = true,
): boolean {
  try {
    const now = deps.now();
    const ca = caPublic(s["ca.crt"]?.toString("utf8") ?? "", now);
    if (ca === null || s["server.pem"] === null) return false;
    const chain = boxLeafChain(s["server.pem"].toString("utf8"), ca.cert, "server");
    if (chain === null) return false;
    const { leaf, signer } = chain;
    if (
      !boxCertCurrent(signer, now) ||
      (checkLeafTime && !boxCertCurrent(leaf, now)) ||
      !leaf.checkPrivateKey(createPrivateKey(s["server.pem"]))
    )
      return false;
    if (
      deps.hostnames.some((name) => leaf.checkHost(name) !== name) ||
      (checkAddresses && leafIpv4s(deps.listIpv4).some((ip) => leaf.checkIP(ip) !== ip))
    )
      return false;
    createSecureContext({ cert: s["server.pem"], key: s["server.pem"] });
    return true;
  } catch {
    return false;
  }
}
async function inspection(
  s: Snapshot,
  deps: BoxTlsRepairDeps,
  p: Pending | null,
  checkAddresses = true,
): Promise<BoxTlsInspection> {
  const pem = s["ca.crt"]?.toString("utf8") ?? "";
  const now = deps.now();
  const ca = caPublic(pem, now);
  const downloadable = ca ?? caPublic(firstCertificatePem(pem), now);
  const usable = healthy(s, deps, checkAddresses);
  const state = usable && p?.complete !== false ? "healthy" : "repair-required";
  const fingerprint = downloadable?.cert.fingerprint256;
  const previousCertificate =
    state === "healthy" ? await previousCertificateFor(deps.stateDir, fingerprint) : undefined;
  return {
    state,
    trust:
      p?.complete === false
        ? p.trust
        : usable
          ? (p?.trust ?? "retained")
          : signingAuthority(s, deps.now())
            ? "retained"
            : "new-required",
    caAvailable: ca !== null && (usable || signingAuthority(s, deps.now())),
    ...(downloadable && { certificateName: downloadable.name, fingerprint }),
    ...(previousCertificate && { previousCertificate }),
  };
}

export async function inspectBoxTls(
  deps: BoxTlsRepairDeps,
  options: { allowLinkedTlsDirectory?: boolean; requireCurrentAddresses?: boolean } = {},
): Promise<BoxTlsInspection> {
  try {
    const directory =
      options.allowLinkedTlsDirectory === true ? await fs.realpath(tlsDir(deps)) : tlsDir(deps);
    return await inspection(
      await snapshot(deps, directory),
      deps,
      await pending(deps),
      options.requireCurrentAddresses !== false,
    );
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
    "server.pem": Buffer.from(m.serverCertPem + m.serverKeyPem),
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
  if (!healthy(s, deps, false, false) || !signingAuthority(s, deps.now())) throw refused();
  return healthy(s, deps)
    ? m
    : {
        ...m,
        ...reissueServerLeaf({
          caCertPem: m.caCertPem,
          caKeyPem: m.caKeyPem,
          hostnames: deps.hostnames,
          ipAddresses: leafIpv4s(deps.listIpv4),
          now: deps.now(),
        }),
      };
}
export async function repairBoxTls(deps: BoxTlsRepairDeps): Promise<BoxTlsInspection> {
  await fs.mkdir(deps.stateDir, { recursive: true, mode: 0o700 });
  return withRecoveryLock(deps.stateDir, async () => {
    const s = await snapshot(deps);
    let p = await pending(deps);
    const inspected = await inspection(s, deps, p);
    if (inspected.state === "healthy") return inspected;
    await fs.mkdir(tlsDir(deps), { recursive: true, mode: 0o700 });
    await fs.chmod(tlsDir(deps), 0o700);
    const folder = join(deps.stateDir, TLS_REPAIR_DIR);
    if (p?.complete !== false) {
      await fs.rm(folder, { recursive: true, force: true });
      const operation = randomUUID();
      await fs.mkdir(folder, { mode: 0o700 });
      for (const name of names)
        if (s[name] !== null) await durableFile(join(folder, name), s[name], true);
      await writeDurableHostJson(
        join(folder, "manifest.json"),
        { version: 1, absent: names.filter((name) => s[name] === null) },
        limit,
      );
      await syncDirectory(folder);
      await syncDirectory(tlsDir(deps));
      await syncDirectory(deps.stateDir);
      p = {
        operation,
        complete: false,
        trust: signingAuthority(s, deps.now()) ? "retained" : "new-required",
      };
      await fs.rm(join(flowDir(deps), "candidate.json"), { force: true });
      await mkdirDurable(flowDir(deps), 0o700);
      await writeDurableHostJson(pendingPath(deps), p, limit);
    }
    await regularDirectory(folder);
    let saved = await readDurableHostJson(join(flowDir(deps), "candidate.json"), limit);
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
                ipAddresses: leafIpv4s(deps.listIpv4),
                now: deps.now(),
              }),
            }
          : mintSelfSignedServerCert({
              hostnames: deps.hostnames,
              ipAddresses: leafIpv4s(deps.listIpv4),
              now: deps.now(),
            });
      readCandidate(m, deps);
      await writeDurableHostJson(join(flowDir(deps), "candidate.json"), m, limit);
      saved = m;
    }
    // A changed address or leaf lifetime must not replace the reserved authority.
    const m = readCandidate(saved, deps);
    if (m.serverCertPem !== (saved as SelfSignedMaterial).serverCertPem)
      await writeDurableHostJson(join(flowDir(deps), "candidate.json"), m, limit);
    const candidate = candidateSnapshot(m);
    if (p.trust === "new-required") {
      const original = await readMember(join(folder, "ca.crt")).catch(() => null);
      const previous = boxRootIdentity(firstCertificatePem(original?.toString("utf8") ?? ""), true);
      const replacement = new X509Certificate(m.caCertPem).fingerprint256;
      if (previous && previous.cert.fingerprint256 !== replacement) {
        const { name, cert } = previous;
        await writeDurableHostJson(
          join(deps.stateDir, TLS_PREVIOUS_CERTIFICATE_FILE),
          {
            replacement,
            previous: {
              name,
              fingerprint: cert.fingerprint256,
              thumbprint: cert.fingerprint.replaceAll(":", ""),
            },
          },
          limit,
        );
      }
    }
    for (const name of names) {
      if (p.trust === "retained" && (name === "ca.crt" || name === "ca.key")) {
        if (!s[name]?.equals(candidate[name]!)) throw refused();
        continue;
      }
      await durableFile(join(tlsDir(deps), name), candidate[name]!, false);
      await syncDirectory(tlsDir(deps));
    }
    const installed = await snapshot(deps);
    if (!healthy(installed, deps)) throw refused();
    for (const name of RETIRED_TLS_NAMES) {
      const path = join(tlsDir(deps), name);
      const exists = await fs.lstat(path).then(
        () => true,
        (error: unknown) => {
          if (missing(error)) return false;
          throw error;
        },
      );
      if (!exists) continue;
      await fs.rm(path, { force: true, recursive: true });
      await syncDirectory(tlsDir(deps));
    }
    p = { ...p, complete: true };
    await writeDurableHostJson(pendingPath(deps), p, limit);
    return inspection(installed, deps, p);
  });
}

export async function endFinishedTlsRepair(stateDir: string): Promise<void> {
  const folder = join(stateDir, TLS_REPAIR_FLOW_DIR);
  const archive = join(stateDir, TLS_REPAIR_DIR);
  const present = async (path: string) =>
    fs.lstat(path).then(
      () => true,
      (error: unknown) => {
        if (missing(error)) return false;
        throw error;
      },
    );
  if (!(await present(folder)) && !(await present(archive))) return;
  await withRecoveryLock(stateDir, async () => {
    const deps = { stateDir, hostnames: [], listIpv4: () => [], now: () => new Date() };
    if ((await inspectBoxTls(deps, { requireCurrentAddresses: false })).state !== "healthy") return;
    await fs.rm(archive, { recursive: true, force: true });
    await syncFolderHolding(archive);
    if (!(await present(folder))) return;
    await mkdirDurable(join(stateDir, SCRATCH_DIR), 0o700);
    const ended = join(stateDir, SCRATCH_DIR, `tls-repair-ended-${randomUUID()}`);
    await fs.rename(folder, ended);
    await syncFolderHolding(folder);
    await syncFolderHolding(ended);
    await fs.rm(ended, { recursive: true, force: true });
  });
}
