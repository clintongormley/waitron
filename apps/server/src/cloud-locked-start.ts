import { join } from "node:path";
import { readFileSync } from "node:fs";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  checkLockedCopyLogin,
  foldedLoginEmail,
  hashSessionToken,
  mintSessionToken,
} from "@waitron/identity";
import type { KeyEntry } from "@waitron/credentials";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { createPasswordThrottle } from "./password-throttle.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import "./errors.js";
import { lockVenueDatabase } from "@waitron/db";
import { NODE_FILE, openBackupQuery, VENUE_FILE } from "@waitron/store";
import { AppError, isAppError } from "@waitron/shared";
import type { SignedMembershipDocument } from "@waitron/membership";
import type { CloudInstallationCredentials } from "./cloud-client.js";
import {
  hasLiveLease,
  installationClient,
  leaseExpiry,
  readCloudInstallation,
} from "./cloud-installation.js";
import {
  assertEmergencyCopyBindingUnexpired,
  type EmergencyCopyBinding,
} from "./emergency-copy-binding.js";
import { placeEmergencyCopy } from "./emergency-copy-placement.js";
import { buildServeOptions, validateTlsIdentity, type TlsFiles } from "./tls.js";
import { createHealthState, healthApp } from "./health.js";
import { mountNodeApi } from "./node-api.js";
import type { Logger } from "./logger.js";
import { closeListener } from "./close-listener.js";

/** Locked copies keep control state only in memory; a final lease needs no renewal. */
export function createLockedCloudControl(
  state: CloudInstallationCredentials,
  binding: EmergencyCopyBinding,
) {
  if (state.lifecycle) state.lifecycle = readCloudInstallation(state.lifecycle, state);
  const client = installationClient(state, async () => {});
  return {
    async check(signal?: AbortSignal): Promise<number> {
      assertEmergencyCopyBindingUnexpired(binding, new Date());
      const c = state.lifecycle!;
      const registration = state.view?.registration;
      if (
        registration?.venueId !== binding.venueId ||
        registration.installationId !== binding.installationId ||
        state.environment !== (binding.environment === "production" ? "production" : "test") ||
        new URL(state.origin).protocol !== "https:" ||
        (c.pending && c.pending.action !== "renew")
      )
        throw new AppError("cloud.unavailable", {});
      if (c.revoked) throw new AppError("cloud.not_configured", {});
      const deadline = Date.parse(binding.expiresAt);
      if (c.pending || !c.lease || (leaseExpiry(c.lease) < deadline && !hasLiveLease(state)))
        await client.ensureLease(signal);
      const expiry = leaseExpiry(c.lease);
      if (c.unavailable || expiry <= Date.now() || expiry > deadline)
        throw new AppError("cloud.unavailable", {});
      assertEmergencyCopyBindingUnexpired(binding, new Date());
      return expiry;
    },
  };
}

/** Immutable readers need the folder held: they deliberately ignore SQLite's journals. */
export async function openLockedCopy(deps: Parameters<typeof placeEmergencyCopy>[0]) {
  const hold = await lockVenueDatabase(deps.venueDir);
  let venue: Awaited<ReturnType<typeof openBackupQuery>> | undefined;
  let node: Awaited<ReturnType<typeof openBackupQuery>> | undefined;
  async function close() {
    try {
      await node?.close();
    } finally {
      try {
        await venue?.close();
      } finally {
        hold.release();
      }
    }
  }
  try {
    await placeEmergencyCopy(deps);
    venue = await openBackupQuery(join(deps.venueDir, VENUE_FILE), { immutable: true });
    node = await openBackupQuery(join(deps.venueDir, NODE_FILE), { immutable: true });
    return { venue: venue.query, node: node.query, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function startLockedCopy(
  deps: Parameters<typeof placeEmergencyCopy>[0] & {
    cloud: CloudInstallationCredentials;
    tls: TlsFiles;
    origin: string;
    hostname: string;
    port: number;
    log: Logger;
    totpPurposeKeys: readonly KeyEntry[];
  },
) {
  const origin = new URL(deps.origin);
  if (origin.origin !== deps.origin || origin.protocol !== "https:")
    throw new AppError("node.operation_page_required", {});
  const certExpiry = validateTlsIdentity(
    readFileSync(deps.tls.keyFile),
    readFileSync(deps.tls.certFile),
    origin.hostname,
  );
  assertEmergencyCopyBindingUnexpired(deps.binding, new Date());
  const expiry = Math.min(Date.parse(deps.binding.expiresAt), certExpiry);
  const abort = new AbortController();
  let copy: Awaited<ReturnType<typeof openLockedCopy>> | undefined;
  let server: ServerType | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined;
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  function close(): Promise<void> {
    return (closing ??= Promise.resolve().then(async () => {
      clearTimeout(timer);
      clearTimeout(stopTimer);
      abort.abort();
      try {
        if (server) await closeListener(server, { graceMs: 0 });
      } finally {
        try {
          await copy?.close();
        } finally {
          finish();
        }
      }
    }));
  }
  const stopTimer = setTimeout(() => abort.abort(), expiry - Date.now());
  try {
    copy = await openLockedCopy({
      ...deps,
      signal: deps.signal ? AbortSignal.any([deps.signal, abort.signal]) : abort.signal,
    });
    const control = createLockedCloudControl(deps.cloud, deps.binding);
    let leaseEnd = await control.check(abort.signal);
    abort.signal.throwIfAborted();
    const app = new Hono();
    const health = createHealthState(new Date(deps.binding.startedAt));
    health.takesNoSales = true;
    app.route(
      "/",
      healthApp(health, () => new Date()),
    );
    const sessions = new Map<
      string,
      {
        personId: string;
        copyOperationId: string;
        signedInAt: string;
        expiresAt: string;
        copyExpiresAt: string;
      }
    >();
    const recoveryUsed = new Set<string>();
    const throttle = createPasswordThrottle();
    const boundary = createErrorBoundary(
      {
        "node.operation_page_required": 403,
        "password.invalid": 401,
        "password.throttled": 429,
        "authorization.not_permitted": 403,
        "management_session.required": 401,
        "management_session.expired": 401,
      },
      "cloud-locked.session_failed",
    );
    const cookieName = "__Host-waitron-locked";
    app.all("/locked-api/session", (c) =>
      boundary(c, deps.log, async () => {
        requireNodeOperationHttps(c);
        if (new URL(c.req.url).origin !== deps.origin)
          throw new AppError("node.operation_page_required", {});
        assertEmergencyCopyBindingUnexpired(deps.binding, new Date());
        c.header("Cache-Control", "no-store");
        if (c.req.method === "POST") {
          const body = await readRawJsonBody<Record<string, unknown>>(c);
          for (const field of ["email", "password", "totp", "recoveryCode"]) {
            const value = body?.[field];
            if (
              typeof value !== "string" &&
              !(value === undefined && (field === "totp" || field === "recoveryCode"))
            )
              throw new AppError("management.request_invalid", { field });
          }
          const input = body as {
            email: string;
            password: string;
            totp?: string;
            recoveryCode?: string;
          };
          const finishAttempt = throttle.begin(foldedLoginEmail(input.email));
          let outcome: "success" | "invalid" | "error" = "error";
          try {
            const result = await checkLockedCopyLogin(copy!.venue, {
              ...input,
              totpPurposeKeys: deps.totpPurposeKeys,
            });
            if (closing) throw new AppError("management_session.expired", {});
            assertEmergencyCopyBindingUnexpired(deps.binding, new Date());
            if (result.recoveryCodeId !== null && recoveryUsed.has(result.recoveryCodeId))
              throw new AppError("password.invalid", {});
            if (result.recoveryCodeId !== null) recoveryUsed.add(result.recoveryCodeId);
            const session = {
              personId: result.personId,
              copyOperationId: deps.binding.copyOperationId,
              signedInAt: new Date().toISOString(),
              expiresAt: new Date(Math.min(Date.now() + 600000, expiry)).toISOString(),
              copyExpiresAt: deps.binding.expiresAt,
            };
            const token = mintSessionToken();
            sessions.set(hashSessionToken(token), session);
            setCookie(c, cookieName, token, {
              secure: true,
              httpOnly: true,
              sameSite: "Strict",
              path: "/",
            });
            outcome = "success";
            return c.json(session);
          } catch (error) {
            if (isAppError(error) && error.code === "password.invalid") outcome = "invalid";
            throw error;
          } finally {
            finishAttempt(outcome);
          }
        }
        const token = getCookie(c, cookieName);
        if (!token) throw new AppError("management_session.required", {});
        const hash = hashSessionToken(token);
        const session = sessions.get(hash);
        if (!session || Date.parse(session.expiresAt) <= Date.now())
          throw new AppError("management_session.expired", {});
        if (c.req.method === "GET") return c.json(session);
        if (c.req.method === "DELETE") {
          sessions.delete(hash);
          deleteCookie(c, cookieName, { path: "/", secure: true });
          return c.json({ ok: true });
        }
        return c.notFound();
      }),
    );
    let membership: SignedMembershipDocument | null = null;
    for await (const row of copy.venue.rows("select document from node_membership where id = 1"))
      membership = JSON.parse(String(row.document)) as SignedMembershipDocument;
    mountNodeApi(
      app,
      {
        nodeId: deps.binding.copyNodeId,
        acceptingSales: false,
        environment: deps.environment,
        readMembership: async () => membership,
      },
      deps.log,
    );
    server = await new Promise<ServerType>((resolve, reject) => {
      const listener = serve(
        buildServeOptions({ fetch: app.fetch, hostname: deps.hostname, port: deps.port }, deps.tls),
        () => resolve(listener),
      );
      listener.once("error", reject);
    });
    abort.signal.throwIfAborted();
    abort.signal.addEventListener(
      "abort",
      () => {
        void close();
      },
      { once: true },
    );
    function schedule() {
      timer = setTimeout(
        () => {
          void check();
        },
        Math.max(0, Math.min(60000, expiry - Date.now(), leaseEnd - Date.now())),
      );
    }
    async function check() {
      try {
        if (Date.now() >= expiry) {
          await close();
          return;
        }
        leaseEnd = await control.check(abort.signal);
        if (!closing) schedule();
      } catch {
        await close();
      }
    }
    schedule();
    return { close, closed };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Read before any folder lock; this payload must never enter saved environment files. */
export function readLockedTotpKeys(env: NodeJS.ProcessEnv): KeyEntry[] {
  const raw = env.WAITRON_LOCKED_TOTP_KEYS;
  delete env.WAITRON_LOCKED_TOTP_KEYS;
  const refuse = (): never => {
    throw new AppError("cloud.request_invalid", {});
  };
  function object(value: unknown, fields: string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) refuse();
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).length !== fields.length ||
      fields.some((field) => !Object.hasOwn(record, field))
    )
      refuse();
    return record;
  }
  function entry(value: unknown): KeyEntry {
    const record = object(value, ["version", "key"]);
    if (
      typeof record.version !== "number" ||
      !Number.isSafeInteger(record.version) ||
      record.version < 1 ||
      typeof record.key !== "string"
    )
      refuse();
    const key = Buffer.from(record.key as string, "base64");
    if (key.length !== 32 || key.toString("base64") !== record.key) refuse();
    return { version: record.version as number, key };
  }
  let input: unknown;
  try {
    input = JSON.parse(raw ?? "");
  } catch {
    refuse();
  }
  const record = object(input, ["current", "previous"]);
  const current = entry(record.current);
  if (record.previous === null) return [current];
  const previous = entry(record.previous);
  if (current.version === previous.version) refuse();
  return [current, previous];
}
