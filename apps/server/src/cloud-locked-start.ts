import { join } from "node:path";
import { readFileSync } from "node:fs";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { lockVenueDatabase } from "@waitron/db";
import { NODE_FILE, openBackupQuery, VENUE_FILE } from "@waitron/store";
import { AppError } from "@waitron/shared";
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
