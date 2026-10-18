import type { Context, Hono } from "hono";
import { TLSSocket } from "node:tls";
import type { OperationBinding } from "@waitron/module";
import type { FirstSetupHold } from "@waitron/provisioning";
import { AppError, isUuid } from "@waitron/shared";
import type { Logger } from "./logger.js";
import type { SetupDeps } from "./setup-api.js";
import { readFirstFiscalBody } from "./setup-first-fiscal-api.js";
import { parseRecoveryEntryContext, type RecoveryEntryContext } from "./recovery-entry.js";
import { parseRecoveryOperationInput } from "./recovery-module-operation.js";
import "./errors.js";

export interface RecoveryPreparationRequest {
  readonly binding: OperationBinding;
  readonly context: RecoveryEntryContext;
  readonly nodeRecoverySecret: string;
  readonly proposal: unknown;
}
export type RecoveryPreparationSource =
  | {
      kind: "archive";
      artifact: Uint8Array;
      recoveryKey: string;
      environment: "production" | "preproduction";
    }
  | { kind: "bucket"; kit: string; environment: "production" | "preproduction" }
  | { kind: "cloud"; pointId: string };
export type PrepareRecovery = (
  source: RecoveryPreparationSource,
  input: RecoveryPreparationRequest,
  hold?: FirstSetupHold,
) => Promise<unknown>;
function invalid(field: string): never {
  throw new AppError("setup.request_invalid", { field });
}
function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(object, field))
  )
    invalid("body");
  return object;
}
function text(value: unknown, field: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > limit)
    invalid(field);
  return value;
}
function environment(value: unknown): "production" | "preproduction" {
  if (value !== "production" && value !== "preproduction") invalid("environment");
  return value;
}
function preparation(value: unknown): RecoveryPreparationRequest {
  const input = exact(value, ["binding", "context", "nodeRecoverySecret", "proposal"]);
  const operation = parseRecoveryOperationInput({ binding: input.binding, input: null });
  if (operation === null || operation.binding.action !== "restore") invalid("recoveryOperation");
  const context = parseRecoveryEntryContext(input.context);
  if (context === null) invalid("recoveryContext");
  return {
    binding: operation.binding,
    context,
    nodeRecoverySecret: text(input.nodeRecoverySecret, "nodeRecoverySecret", 4096),
    proposal: input.proposal,
  };
}
async function readMultipart(c: Context, limit: number): Promise<FormData> {
  const reader = c.req.raw.body?.getReader();
  if (reader === undefined) invalid("body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        invalid("artifact");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return await new Response(bytes, {
      headers: { "content-type": c.req.header("Content-Type")! },
    }).formData();
  } catch {
    return invalid("body");
  }
}

export function mountRecoveryPreparationApi(
  app: Hono,
  deps: SetupDeps,
  log: Logger,
  options: {
    uploadLimit: number;
    hold(request: Request): FirstSetupHold | undefined;
    busy(): boolean;
    run(c: Context, log: Logger, execute: () => Promise<Response>): Promise<Response>;
  },
): void {
  app.post("/setup-api/recovery/preparation", (c) =>
    options.run(c, log, async () => {
      c.header("Cache-Control", "no-store");
      const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
      const origin = c.req.header("Origin"),
        site = c.req.header("Sec-Fetch-Site");
      if (
        !(socket instanceof TLSSocket) ||
        !socket.encrypted ||
        (origin !== undefined && origin !== new URL(c.req.url).origin) ||
        (site !== undefined && !["same-origin", "none"].includes(site))
      )
        throw new AppError("setup.owner_required", {});
      if (deps.prepareRecovery === undefined || deps.firstSetup === undefined)
        throw new AppError("setup.not_ready", {});
      if (options.busy()) throw new AppError("setup.already_provisioning", {});
      const type = c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase();
      let payload: unknown;
      let artifact: Uint8Array | undefined;
      if (type === "multipart/form-data") {
        const declared = Number(c.req.header("Content-Length"));
        if (Number.isFinite(declared) && declared > options.uploadLimit + 262144)
          invalid("artifact");
        const form = await readMultipart(c, options.uploadLimit + 262144);
        if (
          [...form.keys()].some((key) => !["request", "artifact"].includes(key)) ||
          form.getAll("request").length !== 1 ||
          form.getAll("artifact").length !== 1
        )
          invalid("body");
        const raw = text(form.get("request"), "body", 131072);
        try {
          payload = JSON.parse(raw) as unknown;
        } catch {
          invalid("body");
        }
        const file = form.get("artifact");
        if (!(file instanceof Blob) || file.size === 0 || file.size > options.uploadLimit)
          invalid("artifact");
        artifact = new Uint8Array(await file.arrayBuffer());
      } else if (type === "application/json") {
        payload = await readFirstFiscalBody(c);
      } else invalid("body");
      const body = exact(payload, ["source", "preparation"]);
      const input = preparation(body.preparation);
      const rawSource = body.source as Record<string, unknown> | undefined;
      let source: RecoveryPreparationSource;
      if (rawSource?.kind === "archive") {
        const raw = exact(rawSource, ["kind", "recoveryKey", "environment"]);
        if (artifact === undefined) invalid("artifact");
        source = {
          kind: "archive",
          artifact,
          recoveryKey: text(raw.recoveryKey, "recoveryKey", 4096),
          environment: environment(raw.environment),
        };
      } else if (rawSource?.kind === "bucket") {
        const raw = exact(rawSource, ["kind", "kit", "environment"]);
        if (artifact !== undefined) invalid("artifact");
        source = {
          kind: "bucket",
          kit: text(raw.kit, "kit", 65536),
          environment: environment(raw.environment),
        };
      } else {
        const raw = exact(rawSource, ["kind", "pointId"]);
        if (raw.kind !== "cloud" || typeof raw.pointId !== "string" || !isUuid(raw.pointId))
          invalid("pointId");
        if (artifact !== undefined) invalid("artifact");
        source = { kind: "cloud", pointId: raw.pointId };
      }
      return c.json(await deps.prepareRecovery(source, input, options.hold(c.req.raw)));
    }),
  );
}
