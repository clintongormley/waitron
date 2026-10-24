import type { Context, Hono } from "hono";
import { TLSSocket } from "node:tls";
import { AppError, isUuid } from "@waitron/shared";
import { createErrorBoundary } from "@waitron/server-kit";
import type {
  createFirstSetupBackupRecovery,
  BackupRepairOpenRequest,
  BackupRepairResumeRequest,
} from "./first-setup-backup-recovery.js";
import { readFirstFiscalBody } from "./setup-first-fiscal-api.js";
import { MAX_RESTORE_UPLOAD_BYTES } from "./setup-api.js";
import { requestFromBox } from "./request-from-box.js";
import type { Logger } from "./logger.js";
import "./errors.js";

const boundary = createErrorBoundary(
  {
    "setup.not_ready": 503,
    "setup.owner_required": 403,
    "setup.attempt_conflict": 409,
    "setup.attempt_invalid": 409,
    "setup.attempt_uncertain": 409,
    "promotion.break_glass_invalid": 422,
    "recovery.passphrase_invalid": 422,
    "backup.artifact_invalid": 422,
    "backup.archive_invalid": 422,
    "restore.environment_mismatch": 409,
    "restore.schema_too_new": 409,
    "provisioning.database_ahead": 409,
    "restore.stream_source_live": 409,
    "restore.stream_source_unchecked": 409,
    "restore.stream_pointer_missing": 422,
    "restore.stream_pointer_unverified": 422,
    "backup.stream_pointer_invalid": 422,
    "restore.stream_integrity_failed": 422,
    "restore.stream_state_missing": 422,
    "restore.stream_venue_unconfirmed": 409,
    "backup.stream_request_failed": 502,
    "backup.stream_restore_failed": 502,
    "restore.stream_disk_full": 507,
  },
  "setup.restore_failed",
);
function invalid(field = "body"): never {
  throw new AppError("setup.request_invalid", { field });
}
function exact(
  value: unknown,
  fields: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => ![...fields, ...optional].includes(key)) ||
    fields.some((key) => !Object.hasOwn(body, key))
  )
    invalid();
  return body;
}
function text(value: unknown, field: string, limit = 4096): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > limit)
    invalid(field);
  return value;
}
function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) invalid(field);
  return value;
}
function transport(c: Context): void {
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
}
function contentType(c: Context): string | undefined {
  return c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase();
}
async function json(c: Context): Promise<unknown> {
  if (contentType(c) !== "application/json") invalid();
  return readFirstFiscalBody(c);
}
function proof(value: unknown): Omit<BackupRepairOpenRequest, "source"> {
  const body = exact(value, ["observation", "nodeRecoverySecret", "context"], ["recoveryId"]);
  const observation = exact(body.observation, ["inspectionId", "revision", "ownerGeneration"]);
  const version = (value: unknown) => {
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
      invalid("observation");
    return value;
  };
  const context = exact(body.context, ["oldBoxGone", "soleRecovery"]);
  if (typeof context.oldBoxGone !== "boolean" || typeof context.soleRecovery !== "boolean")
    invalid("context");
  return {
    observation: {
      inspectionId: text(observation.inspectionId, "observation", 256),
      revision: version(observation.revision),
      ownerGeneration: version(observation.ownerGeneration),
    },
    nodeRecoverySecret: text(body.nodeRecoverySecret, "nodeRecoverySecret"),
    context: { oldBoxGone: context.oldBoxGone, soleRecovery: context.soleRecovery },
    ...(Object.hasOwn(body, "recoveryId")
      ? { recoveryId: uuid(body.recoveryId, "recoveryId") }
      : {}),
  };
}
async function upload(c: Context): Promise<BackupRepairOpenRequest> {
  if (contentType(c) !== "multipart/form-data") invalid();
  const limit = MAX_RESTORE_UPLOAD_BYTES + 262144;
  const declared = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) invalid("artifact");
  const reader = c.req.raw.body?.getReader();
  if (reader === undefined) invalid();
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
  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": c.req.header("Content-Type")! },
    }).formData();
  } catch {
    invalid();
  }
  if (
    [...form.keys()].some((key) => !["request", "artifact"].includes(key)) ||
    form.getAll("request").length !== 1 ||
    form.getAll("artifact").length > 1
  )
    invalid();
  const raw = text(form.get("request"), "body", 131072);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    invalid();
  }
  const body = exact(
    parsed,
    ["observation", "source", "nodeRecoverySecret", "context"],
    ["recoveryId"],
  );
  const { source: rawSource, ...rawProof } = body;
  const checkedProof = proof(rawProof);
  const source = exact(rawSource, [], ["kind", "recoveryKey", "environment", "kit", "pointId"]);
  const artifact = form.get("artifact");
  let selected: BackupRepairOpenRequest["source"];
  if (source.kind === "archive") {
    exact(source, ["kind", "recoveryKey", "environment"]);
    if (
      !(artifact instanceof Blob) ||
      artifact.size < 1 ||
      artifact.size > MAX_RESTORE_UPLOAD_BYTES
    )
      invalid("artifact");
    if (source.environment !== "preproduction" && source.environment !== "production")
      invalid("environment");
    selected = {
      kind: "archive",
      artifact: new Uint8Array(await artifact.arrayBuffer()),
      recoveryKey: text(source.recoveryKey, "recoveryKey"),
      environment: source.environment,
    };
  } else {
    if (artifact !== null) invalid("artifact");
    if (source.kind === "bucket") {
      exact(source, ["kind", "kit", "environment"]);
      if (source.environment !== "preproduction" && source.environment !== "production")
        invalid("environment");
      selected = {
        kind: "bucket",
        kit: text(source.kit, "kit", 65536),
        environment: source.environment,
      };
    } else {
      exact(source, ["kind", "pointId"]);
      if (source.kind !== "cloud") invalid("source");
      selected = { kind: "cloud", pointId: uuid(source.pointId, "pointId") };
    }
  }
  return { ...checkedProof, source: selected };
}

export function mountFirstSetupBackupApi(
  app: Hono,
  service: ReturnType<typeof createFirstSetupBackupRecovery>,
  log: Logger,
  requestRestart?: () => void,
  options: { enter?: () => Promise<void> } = {},
): void {
  const root = "/setup-api/first-setup/resolution/backup";
  app.get(`${root}/status`, (c) => {
    c.header("Cache-Control", "no-store");
    return boundary(c, log, async () => c.json(await service.status()));
  });
  const route = (path: string, action: (c: Context) => Promise<Response>) => {
    app.post(`${root}/${path}`, (c) => {
      c.header("Cache-Control", "no-store");
      return boundary(c, log, async () => {
        transport(c);
        return action(c);
      });
    });
  };
  route("open", async (c) => {
    const request = await upload(c);
    await options.enter?.();
    return c.json(await service.open(request, { onBox: requestFromBox(c) }));
  });
  route("resume", async (c) => {
    const body = exact(await json(c), [
      "observation",
      "recoveryId",
      "nodeRecoverySecret",
      "context",
    ]);
    const request: BackupRepairResumeRequest = {
      ...proof(body),
      recoveryId: uuid(body.recoveryId, "recoveryId"),
    };
    await options.enter?.();
    return c.json(await service.resume(request, { onBox: requestFromBox(c) }));
  });
  route("prepare", async (c) => {
    const body = exact(await json(c), ["sessionId", "proposal"]);
    return c.json(
      await service.prepare(text(body.sessionId, "sessionId", 256), body.proposal, {
        onBox: requestFromBox(c),
      }),
    );
  });
  route("commit", async (c) => {
    const body = exact(await json(c), ["sessionId", "input"]);
    await service.commit(text(body.sessionId, "sessionId", 256), body.input, {
      onBox: requestFromBox(c),
    });
    setTimeout(() => requestRestart?.(), 0);
    return c.json({ restarting: true });
  });
  route("close", async (c) => {
    const body = exact(await json(c), ["sessionId"]);
    await service.close(text(body.sessionId, "sessionId", 256));
    return c.json({ closed: true });
  });
  for (const [path, action] of [
    ["start", () => service.cloudStart()],
    ["status", () => service.cloudStatus()],
    ["start-again", () => service.cloudStartAgain()],
  ] as const)
    route(`cloud/${path}`, async (c) => {
      exact(await json(c), []);
      return c.json(await action());
    });
}
