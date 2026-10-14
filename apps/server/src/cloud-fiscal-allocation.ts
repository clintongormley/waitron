import "./errors.js";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { open, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AppError, isUuid } from "@waitron/shared";
import { loadCloudOrigin } from "./cloud-client.js";
import type { FiscalAllocationTransport } from "./cloud-fiscal-allocation-client.js";

export interface FiscalAllocationReportOperation {
  readonly operationId: string;
  readonly body: unknown;
}
export interface FiscalAllocationReportAuthentication {
  readonly origin: string;
  readonly environment?: "dev" | "preproduction" | "production";
  readonly installationId: string;
  readonly privateKey: string;
  readonly lease: { readonly payload: string; readonly signature: string };
  readonly now?: number;
}
export interface FiscalAllocationReportResult {
  readonly version: 1;
  readonly state: "matched" | "conflict" | "recorded";
  readonly receiptId: string | null;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function result(value: unknown): value is FiscalAllocationReportResult {
  return (
    exact(value, ["version", "state", "receiptId"]) &&
    value.version === 1 &&
    ["matched", "conflict", "recorded"].includes(value.state as string) &&
    (value.receiptId === null || (typeof value.receiptId === "string" && isUuid(value.receiptId)))
  );
}
function snapshot(body: unknown): unknown {
  try {
    const text = JSON.stringify(body);
    if (Buffer.byteLength(text) > 16384) throw new Error();
    const held: unknown = JSON.parse(text);
    if (!isDeepStrictEqual(held, body)) throw new Error();
    return held;
  } catch {
    throw new AppError("cloud.request_invalid", {});
  }
}
export function signCloudFiscalReport(
  configuration: FiscalAllocationReportAuthentication & FiscalAllocationReportOperation,
): { payload: string; signature: string } {
  try {
    loadCloudOrigin({
      WAITRON_CLOUD_ORIGIN: configuration.origin,
      WAITRON_ENV: configuration.environment,
    });
    const now = configuration.now ?? Date.now();
    if (
      !configuration.origin ||
      !isUuid(configuration.operationId) ||
      !isUuid(configuration.installationId) ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !exact(configuration.lease, ["payload", "signature"]) ||
      typeof configuration.lease.payload !== "string" ||
      !configuration.lease.payload ||
      typeof configuration.lease.signature !== "string" ||
      !configuration.lease.signature ||
      Buffer.byteLength(JSON.stringify(configuration.lease)) > 4096
    )
      throw new Error();
    const body = snapshot(configuration.body);
    const bodyDigest = createHash("sha256").update(canonical(body)).digest("hex");
    const payload = Buffer.from(
      canonical([
        "waitron.fiscal-machine-report",
        1,
        configuration.origin,
        "report",
        configuration.installationId,
        configuration.operationId,
        now,
        JSON.stringify(configuration.lease),
        bodyDigest,
        body,
      ]),
    );
    const key = createPrivateKey({
      key: Buffer.from(configuration.privateKey, "base64url"),
      type: "pkcs8",
      format: "der",
    });
    if (key.asymmetricKeyType !== "ed25519") throw new Error();
    const proof = {
      payload: payload.toString("base64url"),
      signature: sign(null, payload, key).toString("base64url"),
    };
    if (Buffer.byteLength(JSON.stringify(proof)) > 16384) throw new Error();
    return proof;
  } catch {
    throw new AppError("cloud.request_invalid", {});
  }
}
async function readJson(path: string): Promise<unknown> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, "r");
    if (!(await file.stat()).isFile()) throw new Error();
    const buffer = Buffer.alloc(32769);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > 32768) throw new Error();
    return JSON.parse(buffer.subarray(0, count).toString("utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new AppError("cloud.state_invalid", {});
  } finally {
    await file?.close();
  }
}
async function retain(directory: string, path: string, value: unknown): Promise<void> {
  let file: FileHandle | undefined;
  let parent: FileHandle | undefined;
  try {
    parent = await open(directory, "r");
    file = await open(path, "wx", 0o600);
    await file.writeFile(JSON.stringify(value));
    await file.sync();
    await parent.sync();
  } catch {
    throw new AppError("cloud.state_invalid", {});
  } finally {
    await file?.close();
    await parent?.close();
  }
}

// Call after collecting module evidence and closing its transaction; the report cannot activate.
export async function reconcileCloudFiscalAllocation(configuration: {
  readonly directory: string;
  readonly operation: FiscalAllocationReportOperation;
  readonly transport: Pick<FiscalAllocationTransport, "report">;
  readonly authenticate: () => Promise<FiscalAllocationReportAuthentication>;
}): Promise<FiscalAllocationReportResult> {
  const { directory, transport, authenticate } = configuration;
  const operation = structuredClone(configuration.operation);
  if (!exact(operation, ["operationId", "body"]) || !isUuid(operation.operationId))
    throw new AppError("cloud.request_invalid", {});
  const pending = {
    version: 1,
    operationId: operation.operationId,
    body: snapshot(operation.body),
  };
  const path = join(
    directory,
    createHash("sha256").update(operation.operationId).digest("hex") + ".json",
  );
  let lock: FileHandle;
  try {
    lock = await open(path + ".lock", "wx", 0o600);
  } catch {
    throw new AppError("cloud.busy", {});
  }
  try {
    const retained = await readJson(path);
    if (retained === undefined) await retain(directory, path, pending);
    else if (!isDeepStrictEqual(retained, pending))
      throw new AppError("cloud.binding_conflict", {});
    const prior = await readJson(path + ".result.json");
    if (prior !== undefined) {
      if (!result(prior)) throw new AppError("cloud.state_invalid", {});
      return prior;
    }
    const authentication = await authenticate();
    const proof = signCloudFiscalReport({
      ...authentication,
      operationId: operation.operationId,
      body: pending.body,
    });
    let response: unknown;
    try {
      response = await transport.report(proof);
    } catch {
      throw new AppError("cloud.unavailable", {});
    }
    if (!result(response)) throw new AppError("cloud.unavailable", {});
    await retain(directory, path + ".result.json", response);
    return response;
  } finally {
    await lock.close();
    await rm(path + ".lock");
  }
}
