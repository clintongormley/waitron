import { createHash, createPrivateKey, randomUUID, sign, X509Certificate } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError } from "@waitron/shared";
import type { SavedCloudState } from "./cloud-client.js";
import { machinePayload } from "./cloud-installation.js";
import { createStaffCsr, installStaffCertificate } from "./cloud-remote.js";
import type { OnRefusal } from "./cloud-translation.js";
import "./errors.js";

interface Request {
  operationId: string;
  version: 1;
  hostname: string;
  revision: number;
  csr: string;
  previousRequestId: string | null;
  submitted?: boolean;
  installed?: boolean;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const absent = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

async function save(path: string, request: Request): Promise<void> {
  const temporary = path + "." + randomUUID();
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(request));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function load(path: string): Promise<Request | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > 16384 || (info.mode & 0o077) !== 0) throw new Error();
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      !object(value) ||
      value.version !== 1 ||
      !uuid(value.operationId) ||
      typeof value.hostname !== "string" ||
      typeof value.csr !== "string" ||
      !Number.isSafeInteger(value.revision) ||
      Number(value.revision) < 0 ||
      (value.previousRequestId !== null && !uuid(value.previousRequestId)) ||
      (value.submitted !== undefined && typeof value.submitted !== "boolean") ||
      (value.installed !== undefined && typeof value.installed !== "boolean")
    )
      throw new Error();
    return value as unknown as Request;
  } catch (error) {
    if (absent(error)) return undefined;
    throw new AppError("cloud.state_invalid", {});
  }
}

async function needsRenewal(stateDir: string, hostname: string): Promise<boolean> {
  try {
    const cert = new X509Certificate(await readFile(join(stateDir, "cloud-staff.crt")));
    const from = Date.parse(cert.validFrom),
      until = Date.parse(cert.validTo);
    return (
      cert.checkHost(hostname) !== hostname ||
      from > Date.now() ||
      until - Date.now() <= Math.min(30 * 86400000, (until - from) / 3)
    );
  } catch {
    return true;
  }
}

export async function refreshStaffCertificate(
  state: SavedCloudState,
  stateDir: string,
  hostname: string,
  signal?: AbortSignal,
  onRefusal?: OnRefusal,
): Promise<boolean> {
  signal?.throwIfAborted();
  const lease = state.lifecycle?.lease,
    revision = state.lifecycle?.view?.revision;
  if (
    !state.view?.registration ||
    state.environment !== "test" ||
    state.lifecycle?.revoked ||
    !lease ||
    revision === undefined
  )
    throw new AppError("cloud.not_configured", {});
  const path = join(stateDir, "staff-certificate-request.json");
  let request = await load(path);
  const changed = request && (request.hostname !== hostname || request.revision !== revision);
  if (
    request?.installed &&
    request.hostname === hostname &&
    !(await needsRenewal(stateDir, hostname))
  )
    return true;
  if (!request || changed || request.installed) {
    request = {
      operationId: randomUUID(),
      version: 1,
      hostname,
      revision,
      csr: await createStaffCsr(stateDir, hostname),
      previousRequestId: request?.operationId ?? null,
    };
    await save(path, request);
  }
  const { operationId, version, csr, previousRequestId } = request;
  const action = request.submitted ? "staff-certificate-status" : "staff-certificate-submit";
  const used = JSON.stringify(lease);
  const bytes = machinePayload(state, {
    action,
    operationId: request.submitted ? randomUUID() : operationId,
    lease: used,
    body: JSON.stringify(
      request.submitted
        ? { version, requestId: operationId }
        : { version, hostname, revision, csr, previousRequestId },
    ),
  });
  try {
    const response = await fetch(`${state.origin}/api/installations/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload: bytes.toString("base64url"),
        signature: sign(
          null,
          bytes,
          createPrivateKey({
            key: Buffer.from(state.privateKey, "base64url"),
            format: "der",
            type: "pkcs8",
          }),
        ).toString("base64url"),
      }),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
    });
    if (!response.body) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 32768) throw new Error();
      chunks.push(chunk);
    }
    const reply: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (!response.ok) {
      if (object(reply) && response.status === 403 && reply.error === "revoked")
        await onRefusal?.("revoked", used, state.publicKey);
      if (object(reply) && response.status === 401 && reply.error === "invalid_proof")
        await onRefusal?.("invalid_proof", used, state.publicKey);
      throw new Error();
    }
    if (
      !object(reply) ||
      reply.version !== 1 ||
      reply.installationId !== state.view.registration.installationId ||
      reply.requestId !== operationId ||
      reply.hostname !== hostname ||
      reply.revision !== revision ||
      reply.csrDigest !== createHash("sha256").update(csr).digest("hex") ||
      !["pending", "ready"].includes(String(reply.state)) ||
      (reply.state === "ready" && typeof reply.certificate !== "string")
    )
      throw new Error();
    signal?.throwIfAborted();
    if (reply.state === "ready") {
      await installStaffCertificate(stateDir, hostname, reply.certificate as string);
      request.installed = true;
    }
    request.submitted = true;
    await save(path, request);
    return request.installed === true;
  } catch {
    throw new AppError("cloud.unavailable", {});
  }
}
