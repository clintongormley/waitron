import { Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { FiscalCertificateSeat } from "@waitron/fiscal";
import {
  diagnosisFrame,
  diagnosisRecord,
  readDiagnosisFrames,
  DIAGNOSIS_ENVELOPE_BYTES,
  DIAGNOSIS_INPUT_BYTES,
  DIAGNOSIS_OUTPUT_BYTES,
  DIAGNOSIS_PROGRESS_BYTES,
} from "./fiscal-certificate-diagnosis-runtime.js";

export async function runCertificateDiagnosisEntry(
  select: (fiscalId: string) => Pick<FiscalCertificateSeat, "diagnoseInChild">,
): Promise<void> {
  const channel = new Socket({ fd: 3, readable: true, writable: true });
  const result = await serveCertificateDiagnosisChannel(channel, select);
  if (result.interrupted) process.exit(1);
}

export async function serveCertificateDiagnosisChannel(
  channel: Duplex,
  select: (fiscalId: string) => Pick<FiscalCertificateSeat, "diagnoseInChild">,
): Promise<{ interrupted: boolean }> {
  const abort = new AbortController();
  let started = false;
  let finished = false;
  let progress = 0;
  let complete!: () => void;
  const done = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const close = () => {
    if (!finished) abort.abort("unavailable");
    channel.destroy();
  };
  const closed = () => {
    if (!finished) abort.abort("unavailable");
    complete();
  };
  const send = (message: unknown, limit: number) => {
    const frame = diagnosisFrame(message, limit);
    if (frame === null || channel.destroyed) {
      close();
      return false;
    }
    channel.write(frame);
    return true;
  };
  const remove = readDiagnosisFrames(
    channel,
    DIAGNOSIS_ENVELOPE_BYTES,
    (message) => {
      if (!diagnosisRecord(message)) return close();
      if (
        message.type === "abort" &&
        Object.keys(message).length === 2 &&
        ["deadline", "cancelled", "unavailable"].includes(String(message.reason))
      ) {
        abort.abort(message.reason);
        return;
      }
      if (
        started ||
        Object.keys(message).length !== 3 ||
        message.type !== "run" ||
        typeof message.fiscalId !== "string" ||
        message.fiscalId.length > 128 ||
        diagnosisFrame(message.input, DIAGNOSIS_INPUT_BYTES) === null
      )
        return close();
      started = true;
      void (async () => {
        try {
          const seat = select(message.fiscalId as string);
          if (!seat.diagnoseInChild) return close();
          const value = await seat.diagnoseInChild(message.input!, abort.signal, (value) => {
            progress += 1;
            if (progress > 16) return close();
            send({ type: "progress", value }, DIAGNOSIS_PROGRESS_BYTES);
          });
          if (!abort.signal.aborted && send({ type: "result", value }, DIAGNOSIS_OUTPUT_BYTES)) {
            finished = true;
            channel.end(() => channel.destroy());
          } else close();
        } catch {
          close();
        }
      })();
    },
    close,
  );
  channel.on("end", close);
  channel.on("close", closed);
  await done;
  remove();
  channel.removeListener("end", close);
  channel.removeListener("close", closed);
  return { interrupted: abort.signal.aborted };
}
