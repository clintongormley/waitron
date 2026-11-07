import { createHash, createPrivateKey, randomUUID, X509Certificate } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { SavedCloudState } from "./cloud-client.js";
import { createStaffCsr, installStaffCertificate } from "./cloud-remote.js";
import { serviceExchange, type OnRefusal } from "./cloud-translation.js";
import "./errors.js";

const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const digest = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

function fresh(chain: string | Buffer, key: string | Buffer, hostname: string): boolean {
  const cert = new X509Certificate(chain),
    from = Date.parse(cert.validFrom),
    until = Date.parse(cert.validTo);
  if (
    cert.checkHost(hostname) !== hostname ||
    !cert.checkPrivateKey(createPrivateKey(key)) ||
    from > Date.now()
  )
    throw new Error();
  return until - Date.now() > Math.min(30 * 86400000, (until - from) / 3);
}
async function installedFresh(stateDir: string, hostname: string): Promise<boolean> {
  try {
    const key = join(stateDir, "cloud-staff.key"),
      chain = join(stateDir, "cloud-staff.crt");
    const info = await lstat(key),
      certInfo = await lstat(chain);
    if (
      !info.isFile() ||
      info.size > 8192 ||
      (info.mode & 0o077) !== 0 ||
      !certInfo.isFile() ||
      certInfo.size > 16384
    )
      return false;
    return fresh(await readFile(chain), await readFile(key), hostname);
  } catch {
    return false;
  }
}

export async function refreshStaffCertificate(
  state: SavedCloudState,
  stateDir: string,
  hostname: string,
  signal?: AbortSignal,
  onRefusal?: OnRefusal,
  isCurrent?: () => Promise<boolean>,
): Promise<boolean> {
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
    : AbortSignal.timeout(8000);
  deadline.throwIfAborted();
  if (
    !state.view?.registration ||
    state.environment !== "test" ||
    state.lifecycle?.revoked ||
    !state.lifecycle?.lease ||
    !state.lifecycle.view
  )
    throw new AppError("cloud.not_configured", {});
  try {
    if (await installedFresh(stateDir, hostname)) return true;
    const csr = await createStaffCsr(stateDir, hostname),
      csrDigest = createHash("sha256").update(csr).digest("hex");
    const exchange = async (
      action: "staff-certificate-submit" | "staff-certificate-status",
      body: object,
      operationId = randomUUID(),
    ) => {
      deadline.throwIfAborted();
      const reply = await serviceExchange(
        state,
        action,
        operationId,
        JSON.stringify(body),
        {},
        deadline,
        onRefusal,
      );
      deadline.throwIfAborted();
      if (isCurrent && !(await isCurrent())) throw new AppError("cloud.not_configured", {});
      if (
        reply.installationId !== state.view!.registration!.installationId ||
        reply.hostname !== hostname
      )
        throw new Error();
      return reply;
    };
    const discovered = await exchange("staff-certificate-status", { version: 1, requestId: null });
    if (!revision(discovered.revision) || discovered.revision < state.lifecycle.view.revision)
      throw new Error();
    const current = discovered.request;
    if (
      current !== null &&
      (!object(current) ||
        !uuid(current.requestId) ||
        typeof current.hostname !== "string" ||
        current.hostname.length === 0 ||
        current.hostname.length > 253 ||
        !revision(current.revision) ||
        !digest(current.csrDigest))
    )
      throw new Error();
    const ready = async (reply: Record<string, unknown>, requestId: string) => {
      if (
        reply.requestId !== requestId ||
        reply.revision !== discovered.revision ||
        reply.csrDigest !== csrDigest ||
        !["pending", "ready"].includes(String(reply.state))
      )
        throw new Error();
      if (reply.state !== "ready") return false;
      if (typeof reply.certificate !== "string" || Buffer.byteLength(reply.certificate) > 16384)
        throw new Error();
      if (!fresh(reply.certificate, await readFile(join(stateDir, "cloud-staff.key")), hostname))
        return false;
      deadline.throwIfAborted();
      if (isCurrent && !(await isCurrent())) throw new AppError("cloud.not_configured", {});
      await installStaffCertificate(stateDir, hostname, reply.certificate);
      return true;
    };
    if (
      object(current) &&
      current.csrDigest === csrDigest &&
      current.hostname === hostname &&
      current.revision === discovered.revision
    ) {
      const reply = await exchange("staff-certificate-status", {
        version: 1,
        requestId: current.requestId,
      });
      if (await ready(reply, current.requestId as string)) return true;
      if (reply.state === "pending") return false;
    }
    const operationId = randomUUID();
    const reply = await exchange(
      "staff-certificate-submit",
      {
        version: 1,
        hostname,
        revision: discovered.revision,
        csr,
        previousRequestId: object(current) ? current.requestId : null,
      },
      operationId,
    );
    return await ready(reply, operationId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("cloud.unavailable", {});
  }
}
