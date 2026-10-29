import { spawn, type ChildProcess } from "node:child_process";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import type {
  FiscalCertificateDiagnosisDeps,
  FiscalCertificateDiagnosisChildResult,
  FiscalCertificateJson,
} from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import {
  certificateDiagnosisRuntime,
  diagnosisFrame,
  diagnosisRecord,
  readDiagnosisFrames,
  DIAGNOSIS_ENVELOPE_BYTES,
  DIAGNOSIS_INPUT_BYTES,
  DIAGNOSIS_OUTPUT_BYTES,
  DIAGNOSIS_PROGRESS_BYTES,
} from "./fiscal-certificate-diagnosis-runtime.js";
import "./errors.js";

export interface CertificateDiagnosisRunner {
  attempt(
    work: (
      runChild: FiscalCertificateDiagnosisDeps["runChild"],
      signal: AbortSignal,
    ) => Promise<FiscalCertificateJson>,
    signal: AbortSignal,
  ): Promise<FiscalCertificateJson>;
  stop(): Promise<void>;
}

const unavailable = () => new AppError("fiscal.certificate_diagnosis_unavailable", {});
const ENVIRONMENT = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TZ",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

export function createCertificateDiagnosisRunner(options: {
  fiscalId: string;
  entry?: URL;
  execArgv?: readonly string[];
  workMs?: number;
  cleanupMs?: number;
  monotonicNow?: () => number;
}): CertificateDiagnosisRunner {
  const workMs = options.workMs ?? 30_000;
  const cleanupMs = options.cleanupMs ?? 2_000;
  const now = options.monotonicNow ?? (() => performance.now());
  let stopped = false;
  let active: {
    cancel(): void;
    done: Promise<unknown>;
    supervised: Promise<void>;
    child: ChildProcess | null;
  } | null = null;

  return {
    attempt(work, signal) {
      if (stopped || signal.aborted) return Promise.reject(unavailable());
      if (active) return Promise.reject(new AppError("fiscal.certificate_diagnosis_busy", {}));
      const abort = new AbortController();
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const schedule = (at: number, action: () => void): void => {
        const timer = setTimeout(
          () => {
            timers.delete(timer);
            if (now() < at) schedule(at, action);
            else action();
          },
          Math.max(0, at - now()),
        );
        timers.add(timer);
      };
      const startedAt = now();
      let settled = false;
      let childUsed = false;
      let childExited = true;
      let cleanChild: (() => void) | undefined;
      let finishChild: ((result: FiscalCertificateDiagnosisChildResult) => void) | undefined;
      let lastProgress: FiscalCertificateJson | null = null;
      let interruption: "deadline" | "cancelled" | "unavailable" | null = null;
      let resolveAttempt!: (value: FiscalCertificateJson) => void;
      let rejectAttempt!: (error: unknown) => void;
      const promise = new Promise<FiscalCertificateJson>((resolve, reject) => {
        resolveAttempt = resolve;
        rejectAttempt = reject;
      });
      const state = {
        cancel: () => interrupt("cancelled"),
        done: promise.catch(() => undefined),
        supervised: Promise.resolve(),
        child: null as ChildProcess | null,
      };
      active = state;
      function release() {
        if (!settled || !childExited) return;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        signal.removeEventListener("abort", cancelled);
        if (active === state) active = null;
      }
      function fail() {
        if (!settled) {
          settled = true;
          rejectAttempt(unavailable());
        }
        release();
      }
      function interrupt(reason: "deadline" | "cancelled" | "unavailable") {
        if (interruption === null || reason === "cancelled") interruption = reason;
        abort.abort(reason);
        cleanChild?.();
        if (reason !== "deadline" && childExited) {
          fail();
          return;
        }
        schedule(now() + cleanupMs, fail);
      }
      function cancelled() {
        interrupt("cancelled");
      }
      signal.addEventListener("abort", cancelled, { once: true });
      schedule(startedAt + workMs, () => interrupt("deadline"));

      const runChild: FiscalCertificateDiagnosisDeps["runChild"] = async (input, childSignal) => {
        const interrupted = (): FiscalCertificateDiagnosisChildResult => ({
          outcome: "interrupted",
          reason: interruption ?? "unavailable",
          lastProgress,
        });
        if (childUsed || settled || abort.signal.aborted || childSignal.aborted)
          return interrupted();
        childUsed = true;
        const frame = diagnosisFrame(
          { type: "run", fiscalId: options.fiscalId, input },
          DIAGNOSIS_ENVELOPE_BYTES,
        );
        if (diagnosisFrame(input, DIAGNOSIS_INPUT_BYTES) === null || frame === null)
          return interrupted();
        let runtime: ReturnType<typeof certificateDiagnosisRuntime>;
        try {
          runtime = options.entry
            ? { entry: options.entry, execArgv: options.execArgv ?? [] }
            : certificateDiagnosisRuntime();
        } catch {
          return interrupted();
        }
        let child: ChildProcess;
        try {
          child = spawn(process.execPath, [...runtime.execArgv, fileURLToPath(runtime.entry)], {
            env: Object.fromEntries(
              ENVIRONMENT.flatMap((key) =>
                process.env[key] === undefined ? [] : [[key, process.env[key]!]],
              ),
            ),
            stdio: ["ignore", "ignore", "ignore", "pipe"],
          });
        } catch {
          return interrupted();
        }
        state.child = child;
        childExited = false;
        const channel = child.stdio[3] as Duplex;
        let result: FiscalCertificateJson | undefined;
        let progress = 0;
        let cleaning = false;
        const childPromise = new Promise<FiscalCertificateDiagnosisChildResult>((resolve) => {
          finishChild = resolve;
        });
        let endSupervision!: () => void;
        state.supervised = new Promise<void>((resolve) => {
          endSupervision = resolve;
        });
        const cleanup = (notify = true) => {
          if (cleaning || childExited) return;
          cleaning = true;
          const at = now();
          const frame = diagnosisFrame(
            { type: "abort", reason: interruption ?? "unavailable" },
            1024,
          )!;
          if (notify && !channel.destroyed && channel.writable) channel.write(frame, () => {});
          schedule(at + cleanupMs * 0.75, () => {
            if (!childExited) child.kill("SIGTERM");
          });
          schedule(at + cleanupMs * 0.875, () => {
            if (!childExited) child.kill("SIGKILL");
          });
          schedule(at + cleanupMs, () => {
            fail();
            endSupervision();
          });
        };
        cleanChild = cleanup;
        const invalid = () => {
          interruption ??= "unavailable";
          result = undefined;
          cleanup();
        };
        const childCancelled = () => {
          interruption ??= childSignal.reason === "deadline" ? "deadline" : "cancelled";
          cleanup();
        };
        childSignal.addEventListener("abort", childCancelled, { once: true });
        const removeFrames = readDiagnosisFrames(
          channel,
          DIAGNOSIS_OUTPUT_BYTES,
          (message, bytes) => {
            if (cleaning || !diagnosisRecord(message) || Object.keys(message).length !== 2)
              return invalid();
            if (
              message.type === "progress" &&
              Object.hasOwn(message, "value") &&
              bytes <= DIAGNOSIS_PROGRESS_BYTES &&
              ++progress <= 16
            ) {
              lastProgress = message.value!;
            } else if (message.type === "result" && Object.hasOwn(message, "value")) {
              result = message.value!;
              cleanup(false);
            } else invalid();
          },
          invalid,
        );
        channel.once("end", () => {
          if (result === undefined) invalid();
        });
        const exited = (code: number | null) => {
          if (childExited) return;
          childExited = true;
          removeFrames();
          channel.destroy();
          child.removeListener("error", spawnFailed);
          child.removeListener("exit", exited);
          childSignal.removeEventListener("abort", childCancelled);
          cleanChild = undefined;
          state.child = null;
          endSupervision();
          const answer: FiscalCertificateDiagnosisChildResult =
            result !== undefined && code === 0 && interruption === null
              ? { outcome: "completed", value: result }
              : interrupted();
          finishChild?.(answer);
          release();
        };
        const spawnFailed = () => {
          if (child.pid === undefined) {
            interruption ??= "unavailable";
            exited(null);
          } else invalid();
        };
        child.once("error", spawnFailed);
        child.once("exit", exited);
        channel.write(frame, (error) => {
          if (error) invalid();
        });
        return childPromise;
      };
      let workPromise: Promise<FiscalCertificateJson>;
      try {
        workPromise = work(runChild, abort.signal);
      } catch (error) {
        workPromise = Promise.reject(error);
      }
      void workPromise.then(
        (value) => {
          if (settled) return;
          if (!childExited || interruption === "cancelled" || signal.aborted || stopped) {
            cleanChild?.();
            fail();
            return;
          }
          settled = true;
          resolveAttempt(value);
          release();
        },
        (error: unknown) => {
          if (!settled) {
            settled = true;
            rejectAttempt(error);
          }
          cleanChild?.();
          release();
        },
      );
      return promise;
    },
    async stop() {
      stopped = true;
      const owned = active;
      if (!owned) return;
      owned.cancel();
      await owned.done;
      await owned.supervised;
      if (owned.child?.pid !== undefined) owned.child.kill("SIGKILL");
    },
  };
}
