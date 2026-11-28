import { createHash } from "node:crypto";
import { AppError } from "@waitron/shared";
import { registeredAddressLookup } from "./cloud-address-lookup.js";
import { fetchBillingDisplay, type BillingDisplay, type BillingRefusal } from "./cloud-billing.js";
import type { CloudConnectionOptions, SavedCloudState } from "./cloud-client-types.js";
import {
  fetchCloudEmailGrant,
  sendCloudEmail,
  type CloudEmail,
  type CloudEmailGrant,
} from "./cloud-email.js";
import { hasLiveLease, installationClient, markRevoked } from "./cloud-installation.js";
import { fetchOwnerRecovery, ownerRecoveryBinding } from "./cloud-owner-recovery.js";
import { refreshStaffCertificate } from "./cloud-staff-certificate.js";
import {
  abandonTranslation,
  collectTranslation,
  type OnRefusal,
  refusalOf,
  releaseTranslation,
  serviceExchange,
  submitTranslation,
  translationStatus,
} from "./cloud-translation.js";
import { staffHostnameFrom } from "./cloud-tunnel.js";
import "./errors.js";

export type StaffReportDelivery = "sent" | "retry" | "stop";

export function createCloudClientServices({
  options,
  run,
  read,
  save,
  registrationOf,
}: {
  options: CloudConnectionOptions;
  run: <T>(work: () => Promise<T>, wait?: boolean, signal?: AbortSignal) => Promise<T>;
  read: () => Promise<SavedCloudState | undefined>;
  save: (state: SavedCloudState) => Promise<void>;
  registrationOf: (state: SavedCloudState | undefined) => string | undefined;
}) {
  // Holds the shared lock only to renew the lease, never across a translation exchange, so a
  // refresh or report is not refused `cloud.busy` while one waits on Cloud.
  async function leaseState(signal?: AbortSignal): Promise<SavedCloudState> {
    const current = await read();
    if (current && hasLiveLease(current)) return current;
    try {
      return await run(
        async () => {
          const state = await read();
          if (!state?.view?.registration || state.lifecycle?.revoked)
            throw new AppError("cloud.not_configured", {});
          await installationClient(state, save).ensureLease(signal);
          return state;
        },
        true,
        signal,
      );
    } catch (error) {
      if (error instanceof AppError || !signal?.aborted) throw error;
      throw new AppError("cloud.unavailable", {});
    }
  }
  // A refresh can renew the lease while a call waits on Cloud; dropping that fresh lease on the
  // old one's invalid_proof would only force another renewal. The connection can also be paired
  // again meanwhile, and the old installation's refusal says nothing about the new one.
  const recordRefusal: OnRefusal = (refusal, used, publicKey) =>
    run(async () => {
      const state = await read();
      if (!state?.lifecycle || state.publicKey !== publicKey) return;
      const c = state.lifecycle;
      if (refusal === "revoked") markRevoked(c);
      else if (JSON.stringify(c.lease) === used) delete c.lease;
      else return;
      await save(state);
    }, true);
  async function ownerRecovery(
    authorize: () => Promise<string>,
    decision: { action: "approve" | "refuse"; request: unknown } | undefined,
    signal?: AbortSignal,
  ) {
    const binding = ownerRecoveryBinding(await read());
    const deadline = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000);
    await leaseState(deadline);
    const actor = await authorize();
    const state = await read();
    if (ownerRecoveryBinding(state) !== binding) throw new AppError("cloud.binding_conflict", {});
    const result = await fetchOwnerRecovery(state!, actor, decision, deadline, recordRefusal);
    // A confirmed decision has taken effect; a later authority change cannot withdraw it.
    if (
      !decision &&
      ((await authorize()) !== actor || ownerRecoveryBinding(await read()) !== binding)
    )
      throw new AppError("cloud.binding_conflict", {});
    return result;
  }
  // Cloud's billing contract allows one read a minute across every dashboard (Retry-After may ask
  // for longer) and no snapshot on disk, so the last read and its outcome live here, per registration.
  let billingRead:
    { registration: string; notBefore: number; outcome: Promise<BillingDisplay> } | undefined;
  return {
    leaseState,
    recordRefusal,
    addressLookup: registeredAddressLookup({ read, registrationOf, leaseState, recordRefusal }),
    async emailRelayEnabled() {
      const state = await read();
      return state?.environment === "test" && state.emailRelayEnabled === true;
    },
    async emailRelay(signal?: AbortSignal) {
      const before = await read();
      if (!before?.view?.registration || before.environment !== "test") return null;
      let grant: CloudEmailGrant | null;
      let used: SavedCloudState;
      try {
        used = await leaseState(signal);
        grant = await fetchCloudEmailGrant(used, signal, options.managementOrigin, recordRefusal);
      } catch (error) {
        if ((await read())?.emailRelayEnabled) throw error;
        return null;
      }
      await run(
        async () => {
          const latest = await read();
          if (!latest || registrationOf(latest) !== registrationOf(used))
            throw new AppError("cloud.unavailable", {});
          if (latest.emailRelayEnabled !== (grant !== null)) {
            latest.emailRelayEnabled = grant !== null;
            await save(latest);
          }
        },
        true,
        signal,
      );
      return grant;
    },
    async sendEmail(grant: CloudEmailGrant, id: string, message: CloudEmail, signal?: AbortSignal) {
      let state: SavedCloudState;
      try {
        state = await leaseState(signal);
      } catch {
        return {
          status: "rejected" as const,
          failureCode: "mail.relay_refused" as const,
          serverRefused: true as const,
        };
      }
      return sendCloudEmail(state, grant, id, message, signal);
    },
    ownerRecoveryRead: (authorize: () => Promise<string>, signal?: AbortSignal) =>
      ownerRecovery(authorize, undefined, signal),
    ownerRecoveryDecide: (
      action: "approve" | "refuse",
      request: unknown,
      authorize: () => Promise<string>,
      signal?: AbortSignal,
    ) => ownerRecovery(authorize, { action, request }, signal),
    async errorReportRegistration(): Promise<string | undefined> {
      return registrationOf(await read());
    },
    async sendErrorReport(
      registration: string,
      operationId: string,
      body: string,
      signal?: AbortSignal,
    ): Promise<void> {
      const state = await leaseState(signal);
      if (registrationOf(state) !== registration || signal?.aborted)
        throw new AppError("cloud.unavailable", {});
      const reply = await serviceExchange(
        state,
        "error-report",
        operationId,
        body,
        {},
        signal,
        recordRefusal,
        {
          requireVersion: false,
          refusal: (status, value) =>
            status === 409 ? new AppError("cloud.unavailable", {}) : refusalOf(status, value),
        },
      );
      if (reply.accepted !== true || Object.keys(reply).length !== 1)
        throw new AppError("cloud.unavailable", {});
    },
    async sendStaffReport(
      registration: string,
      operationId: string,
      body: string,
      signal?: AbortSignal,
      action: "staff-report" | "staff-description" = "staff-report",
    ): Promise<StaffReportDelivery> {
      const bytes = Buffer.from(body, "utf8");
      if (bytes.length === 0 || bytes.length > 16_384) return "stop";
      let time: unknown;
      try {
        time = JSON.parse(body)?.time;
      } catch {
        return "stop";
      }
      const deadline = AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]);
      try {
        const state = await leaseState(deadline);
        if (registrationOf(state) !== registration || deadline.aborted) return "retry";
        const signedBody = JSON.stringify({
          version: 1,
          bodySha256: createHash("sha256").update(bytes).digest("hex"),
          bodyBytes: bytes.length,
        });
        const reply = await serviceExchange(
          state,
          action,
          operationId,
          signedBody,
          { body },
          deadline,
          recordRefusal,
          {
            requireVersion: false,
            refusal: (status, value, headers) => {
              // The body keeps its original time even after the box corrects its clock.
              const cloudTime = Date.parse(headers.get("date") ?? "");
              if (
                status === 400 &&
                (value as { error?: string } | null)?.error === "invalid_input" &&
                typeof time === "number" &&
                time > cloudTime + 60_000
              )
                return new AppError("cloud.unavailable", {});
              if (status === 409) return new AppError("cloud.request_invalid", {});
              return refusalOf(status, value);
            },
          },
        );
        return reply.received === true && Object.keys(reply).length === 1 ? "sent" : "retry";
      } catch (error) {
        return error instanceof AppError && error.code === "cloud.request_invalid"
          ? "stop"
          : "retry";
      }
    },
    async staffAdmitted(): Promise<boolean> {
      return staffHostnameFrom(await read()) !== undefined;
    },
    async staffCertificate(signal?: AbortSignal): Promise<boolean> {
      if (staffHostnameFrom(await read()) === undefined) return false;
      const deadline = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000);
      const state = await leaseState(deadline);
      const registration = registrationOf(state),
        hostname = staffHostnameFrom(state);
      return refreshStaffCertificate(state, options.stateDir, deadline, recordRefusal, async () => {
        const current = await read();
        return registrationOf(current) === registration && staffHostnameFrom(current) === hostname;
      });
    },
    async billing(signal?: AbortSignal): Promise<BillingDisplay> {
      const registration = registrationOf(await read());
      if (!registration) throw new AppError("cloud.not_configured", {});
      const startedAt = Date.now();
      if (
        !billingRead ||
        billingRead.registration !== registration ||
        startedAt >= billingRead.notBefore
      ) {
        let sentAt: number | undefined;
        // Bound only by the read's own limit: one caller leaving must not fail it for the others.
        const outcome = (async () => {
          const state = await leaseState();
          if (registrationOf(state) !== registration) throw new AppError("cloud.unavailable", {});
          sentAt = Date.now();
          return fetchBillingDisplay(state, { onRefusal: recordRefusal });
        })();
        // Shared until it settles, however long the lease renewal before it takes.
        const entry = { registration, notBefore: Infinity, outcome };
        billingRead = entry;
        // The minute counts from the read Cloud received, and a 429's wait from its arrival.
        const settle = (error?: BillingRefusal) => {
          entry.notBefore =
            sentAt === undefined
              ? startedAt + 60_000
              : Math.max(
                  sentAt + 60_000,
                  error?.retryAfterMs ? Date.now() + Math.min(error.retryAfterMs, 3_600_000) : 0,
                );
        };
        outcome.then(() => settle(), settle);
      }
      const { outcome } = billingRead;
      let display: BillingDisplay;
      if (signal) {
        let remove = () => {};
        try {
          display = await Promise.race([
            outcome,
            new Promise<never>((_resolve, reject) => {
              const abort = () => reject(new AppError("cloud.unavailable", {}));
              if (signal.aborted) abort();
              signal.addEventListener("abort", abort, { once: true });
              remove = () => signal.removeEventListener("abort", abort);
            }),
          ]);
        } finally {
          remove();
        }
      } else display = await outcome;
      const now = registrationOf(await read());
      if (now !== registration)
        throw new AppError(now ? "cloud.unavailable" : "cloud.not_configured", {});
      return display;
    },
    translation: {
      submit: async (operationId: string, body: string, signal?: AbortSignal) =>
        submitTranslation(await leaseState(signal), operationId, body, signal, recordRefusal),
      status: async (jobId: string, signal?: AbortSignal) =>
        translationStatus(await leaseState(signal), jobId, signal, recordRefusal),
      collect: async (jobId: string, cursor: number, signal?: AbortSignal) =>
        collectTranslation(await leaseState(signal), jobId, cursor, signal, recordRefusal),
      release: async (jobId: string, signal?: AbortSignal) =>
        releaseTranslation(await leaseState(signal), jobId, signal, recordRefusal),
      abandon: async (operationId: string, signal?: AbortSignal) =>
        abandonTranslation(await leaseState(signal), operationId, signal, recordRefusal),
    },
    async translationService(): Promise<"on" | "off" | "not_connected"> {
      const state = await read();
      if (!state?.view?.registration || state.lifecycle?.revoked) return "not_connected";
      return state.lifecycle?.view?.services.some(
        (s) => s.service === "content_translation" && s.state === "ready",
      )
        ? "on"
        : "off";
    },
  };
}
