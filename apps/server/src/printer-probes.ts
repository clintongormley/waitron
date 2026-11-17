import { isIP } from "node:net";
import { AppError, steadyNow } from "@waitron/shared";
import "./errors.js";

interface PrinterAddressProbe {
  host: string;
  port: number;
  requestedAt: number;
  expiresAt: number;
}

const PROBE_MS = 30_000;

/** Requests are transient and bounded independently of the broader discovery window. An answer's
 * times are wall-clock, for the dashboard; the requests' own expiry runs on `steady`. */
export function createPrinterProbes(
  now: () => number = Date.now,
  steady: () => number = steadyNow,
): {
  add(input: unknown): PrinterAddressProbe;
  current(): { host: string; port: number; expiresInMs: number }[];
} {
  const targets = new Map<string, { host: string; port: number; endsAt: number }>();
  const current = (): { host: string; port: number; expiresInMs: number }[] => {
    const instant = steady();
    for (const [key, target] of targets) if (target.endsAt <= instant) targets.delete(key);
    return [...targets.values()].map(({ host, port, endsAt }) => ({
      host,
      port,
      // Whole milliseconds, so the agent's own deadline arithmetic stays exact; capped because
      // floating-point subtraction can overshoot the 30-second bound the agent accepts.
      expiresInMs: Math.min(PROBE_MS, Math.ceil(endsAt - instant)),
    }));
  };
  return {
    current,
    add(raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new AppError("management.request_invalid", { field: "host" });
      const input = raw as { host?: unknown; port?: unknown };
      let host = typeof input.host === "string" ? input.host.trim() : "";
      const family = isIP(host);
      if (!family || host.includes("%"))
        throw new AppError("management.request_invalid", { field: "host" });
      if (family === 6) host = new URL(`http://[${host}]`).hostname.slice(1, -1);
      const first = Number(host.split(".")[0]);
      if (
        host === "::" ||
        host.startsWith("ff") ||
        host.startsWith("::ffff:") ||
        (family === 4 && (first === 0 || first >= 224))
      ) {
        throw new AppError("management.request_invalid", { field: "host" });
      }
      const port = input.port === undefined ? 9100 : input.port;
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
        throw new AppError("management.request_invalid", { field: "port" });
      current();
      const key = `${host}:${port}`;
      if (!targets.has(key) && targets.size >= 8) throw new AppError("printer.probe_busy", {});
      targets.set(key, { host, port, endsAt: steady() + PROBE_MS });
      const requestedAt = now();
      return { host, port, requestedAt, expiresAt: requestedAt + PROBE_MS };
    },
  };
}
