import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { AppError } from "@waitron/shared";
import type { Context } from "hono";
import type { AdminShutdown } from "./admin-shutdown.js";
import { outgoingOf } from "./restart-after-response.js";
import "./errors.js";

export function streamShutdownDownload(
  c: Context,
  download: Awaited<ReturnType<AdminShutdown["beginDownload"]>>,
): Response {
  const outgoing = outgoingOf(c);
  const signal = AbortSignal.any([c.req.raw.signal, download.signal]);
  if (!outgoing || outgoing.destroyed || signal.aborted) {
    download.finish(false);
    throw new AppError("box.shutdown_in_progress", {});
  }
  const reader = createReadStream(download.path);
  const body = Readable.toWeb(reader, { strategy: { highWaterMark: 0 } });
  function close(complete: boolean): void {
    outgoing!.off("finish", sent);
    outgoing!.off("close", interrupted);
    signal.removeEventListener("abort", aborted);
    if (reader.closed) download.finish(complete);
    else {
      reader.once("close", () => download.finish(complete));
      reader.destroy();
    }
  }
  // Reading the whole file into the HTTP adapter does not prove that it wrote the response.
  function sent(): void {
    close(!signal.aborted && reader.readableEnded && reader.bytesRead === download.bytes);
  }
  function interrupted(): void {
    close(false);
  }
  function aborted(): void {
    interrupted();
    outgoing!.destroy();
  }
  signal.addEventListener("abort", aborted, { once: true });
  outgoing.once("finish", sent);
  outgoing.once("close", interrupted);
  reader.once("close", () => {
    if (signal.aborted || !reader.readableEnded) interrupted();
  });
  return c.body(body as ReadableStream<Uint8Array>, 200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${download.name}"`,
    "Content-Length": String(download.bytes),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
}
