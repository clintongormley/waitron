import "./errors.js";
import { AppError } from "@waitron/shared";
import { loadCloudOrigin } from "./cloud-client.js";

export interface FiscalAllocationTransport {
  status(input: unknown): Promise<unknown>;
  report(input: unknown): Promise<unknown>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function statusResult(value: unknown): boolean {
  return (
    exact(value, ["version", "state", "receipt"]) &&
    value.version === 1 &&
    ["unknown", "recorded", "uncertain"].includes(value.state as string) &&
    (value.state === "unknown"
      ? value.receipt === null
      : value.state === "recorded"
        ? record(value.receipt)
        : value.receipt === null || record(value.receipt))
  );
}

function reportResult(value: unknown): boolean {
  return (
    exact(value, ["version", "state", "receiptId"]) &&
    value.version === 1 &&
    ["matched", "conflict", "recorded"].includes(value.state as string) &&
    (value.receiptId === null ||
      (typeof value.receiptId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          value.receiptId,
        )))
  );
}

export function createCloudFiscalAllocationClient(configuration: {
  readonly origin: string;
  readonly environment?: "dev" | "preproduction" | "production";
  readonly account?: { readonly cookie: string; readonly csrfToken: string };
  readonly timeoutMs?: number;
}): FiscalAllocationTransport {
  const { origin } = configuration;
  const account = configuration.account === undefined ? undefined : { ...configuration.account };
  const timeoutMs = configuration.timeoutMs === undefined ? 8000 : configuration.timeoutMs;
  try {
    loadCloudOrigin({ WAITRON_CLOUD_ORIGIN: origin, WAITRON_ENV: configuration.environment });
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      !["http:", "https:"].includes(url.protocol) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 8000
    )
      throw new Error("invalid configuration");
  } catch {
    throw new AppError("cloud.request_invalid", {});
  }

  async function exchange(action: "status" | "report", input: unknown): Promise<unknown> {
    if (action === "status" && (!account?.cookie || !account.csrfToken))
      throw new AppError("cloud.not_configured", {});
    let body: string;
    try {
      if (!record(input)) throw new Error("invalid body");
      body = JSON.stringify(input);
      if (Buffer.byteLength(body) > 16384) throw new Error("oversized body");
    } catch {
      throw new AppError("cloud.request_invalid", {});
    }
    let response: Response | undefined;
    try {
      response = await fetch(
        origin +
          (action === "status"
            ? "/api/account/fiscal-allocations/status"
            : "/api/installations/fiscal-allocations/report"),
        {
          method: "POST",
          headers:
            action === "status"
              ? {
                  "content-type": "application/json",
                  origin,
                  cookie: account!.cookie,
                  "x-csrf-token": account!.csrfToken,
                }
              : { "content-type": "application/json" },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (
        !response.ok ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          response.headers.get("content-type") ?? "",
        ) ||
        !response.body
      )
        throw new Error("unavailable response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 262144) throw new Error("oversized response");
        chunks.push(chunk);
      }
      const result: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
      if (!(action === "status" ? statusResult(result) : reportResult(result)))
        throw new Error("invalid response");
      return result;
    } catch {
      // A failed reply cannot decide whether the outside operation committed.
      throw new AppError("cloud.unavailable", {});
    } finally {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    }
  }

  return {
    status: (input) => exchange("status", input),
    report: (input) => exchange("report", input),
  };
}
