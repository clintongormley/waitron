import type { DeploymentEnvironment } from "@waitron/db";
import { randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { SOAP_ENDPOINTS } from "@waitron/verifactu";
import type { HourClockObservation } from "./hour-clock.js";

interface InternetClockDependencies {
  request?: (url: URL, signal: AbortSignal) => Promise<Response>;
  wall?: () => number;
  monotonic?: () => number;
}
export function authenticatedHourHead(url: URL, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "HEAD",
        signal,
        agent: false,
        rejectUnauthorized: true,
        maxHeaderSize: 8192,
        headers: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" },
      },
      (response) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        // HEAD's clock evidence ends at its headers; destroy the owned socket rather than await a body.
        response.destroy();
        resolve(new Response(null, { status: response.statusCode!, headers }));
      },
    );
    request.on("error", reject);
    request.end();
  });
}

export async function observeInternetHourClock(
  environment: DeploymentEnvironment,
  deps: InternetClockDependencies = {},
): Promise<HourClockObservation> {
  const wall = deps.wall ?? Date.now;
  const monotonic = deps.monotonic ?? (() => performance.now());
  const request = deps.request ?? authenticatedHourHead;
  const controller = new AbortController();
  const wallStartedMs = wall();
  const monotonicStartedMs = monotonic();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const unavailable = (reason: string): HourClockObservation => ({
    source: "internet",
    result: "unavailable",
    reason,
    wallStartedMs,
    wallFinishedMs: wall(),
    monotonicStartedMs,
    monotonicFinishedMs: monotonic(),
    uncertaintyMs: null,
  });
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("timeout"));
      controller.abort();
      void reader?.cancel().catch(() => {});
    }, 5000);
  });
  try {
    return await Promise.race([
      deadline,
      (async (): Promise<HourClockObservation> => {
        const selected = SOAP_ENDPOINTS[environment];
        if (selected === undefined) return unavailable("configuration");
        let url = new URL(selected);
        const origin = url.origin;
        const nonce = randomUUID();
        for (let redirect = 0; redirect <= 2; redirect++) {
          url.searchParams.set("waitron_clock", nonce);
          const response = await request(url, controller.signal);
          if (controller.signal.aborted) {
            void response.body?.cancel().catch(() => {});
            return unavailable("timeout");
          }
          reader = response.body?.getReader();
          let bytes = 0;
          if (reader !== undefined) {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > 8192) {
                void reader.cancel().catch(() => {});
                return unavailable("response");
              }
            }
          }
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (location === null) return unavailable("response");
            url = new URL(location, url);
            if (url.origin !== origin || url.username !== "" || url.password !== "")
              return unavailable("response");
            continue;
          }
          const date = response.headers.get("date");
          const instant = date === null ? NaN : Date.parse(date);
          const age = response.headers.get("age");
          if (
            response.status < 200 ||
            response.status >= 500 ||
            date === null ||
            !Number.isFinite(instant) ||
            new Date(instant).toUTCString() !== date ||
            (age !== null && !/^0+$/.test(age)) ||
            /\bhit\b/i.test(response.headers.get("x-cache") ?? "") ||
            /\b11[01]\b/.test(response.headers.get("warning") ?? "") ||
            /(?:s-maxage|max-age)\s*=\s*"?[1-9]/i.test(response.headers.get("cache-control") ?? "")
          )
            return unavailable("response");
          const wallFinishedMs = wall();
          const monotonicFinishedMs = monotonic();
          const duration = monotonicFinishedMs - monotonicStartedMs;
          if (
            duration < 0 ||
            duration > 5000 ||
            !Number.isFinite(duration) ||
            !Number.isFinite(wallStartedMs) ||
            !Number.isFinite(wallFinishedMs) ||
            Math.abs(wallFinishedMs - wallStartedMs - duration) > 1000
          )
            return unavailable("clock-corrected");
          return {
            source: "internet",
            result: "usable",
            instantMs: instant + 500,
            uncertaintyMs: 500 + duration / 2,
            wallStartedMs,
            wallFinishedMs,
            monotonicStartedMs,
            monotonicFinishedMs,
          };
        }
        return unavailable("response");
      })(),
    ]);
  } catch (error) {
    const code =
      error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
    return unavailable(
      controller.signal.aborted ? "timeout" : /CERT|TLS|SSL/.test(code) ? "tls" : "network",
    );
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
}
