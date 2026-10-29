import { appendFileSync, closeSync, writeSync } from "node:fs";
import { runCertificateDiagnosisEntry } from "../fiscal-certificate-diagnosis-dispatch.js";

await runCertificateDiagnosisEntry((id) => {
  if (id !== "fixture") throw new Error("PRIVATE UNKNOWN MODULE");
  return {
    diagnoseInChild: async (input, abort, report) => {
      const body = input as { mode: string; marker: string; value?: string };
      const mark = (stage: string) =>
        appendFileSync(body.marker, JSON.stringify({ stage, pid: process.pid }) + "\n");
      mark("started");
      if (body.mode === "crash") process.exit(3);
      if (body.mode === "progress-crash") {
        writeSync(
          3,
          JSON.stringify({
            type: "progress",
            value: { stage: "response", category: "http-response", httpStatus: 403 },
          }) + "\n",
        );
        process.exit(3);
      }
      if (body.mode === "disconnect") {
        closeSync(3);
        return null;
      }
      if (body.mode === "block" || body.mode === "ignore-term") {
        if (body.mode === "ignore-term") process.on("SIGTERM", () => {});
        for (;;) {
          /* synchronous native opening stand-in */
        }
      }
      if (body.mode === "malformed") {
        writeSync(3, JSON.stringify({ type: "private", secret: "PRIVATE RAW MESSAGE" }) + "\n");
        return new Promise(() => {});
      }
      if (body.mode === "bad-json") {
        writeSync(3, "invalid\n");
        return new Promise(() => {});
      }
      if (body.mode === "oversized-frame") {
        writeSync(3, "x".repeat(20_000));
        return new Promise(() => {});
      }
      if (body.mode === "output-held") {
        writeSync(3, JSON.stringify({ type: "result", value: { complete: true } }) + "\n");
        for (;;) {
          /* held native cleanup after final output */
        }
      }
      if (body.mode === "oversized") return { value: "PRIVATE".repeat(4_000) };
      if (body.mode === "progress-big") report({ value: "PRIVATE".repeat(200) });
      if (body.mode === "progress-many") for (let i = 0; i < 17; i++) report({ step: i });
      if (body.mode === "body" || body.mode === "cleanup") {
        report({ stage: "response", httpStatus: 200 });
        await new Promise<void>((resolve) =>
          abort.addEventListener("abort", () => resolve(), { once: true }),
        );
        mark("aborted");
        if (body.mode === "cleanup") return new Promise(() => {});
      }
      if (body.mode === "environment")
        return {
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              (pair): pair is [string, string] => pair[1] !== undefined,
            ),
          ),
          argv: process.argv.slice(2),
        };
      return { value: body.value ?? "complete" };
    },
  };
});
