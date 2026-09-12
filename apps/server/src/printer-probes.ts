import { isIP } from "node:net";
import { AppError } from "@waitron/shared";
import "./errors.js";

interface NetworkProbe {
  host: string;
  port: number;
  requestedAt: number;
  expiresAt: number;
}

/** Requests are transient and bounded independently of the broader discovery window. */
export function createPrinterProbes(now: () => number = Date.now): {
  add(input: unknown): NetworkProbe;
  current(): NetworkProbe[];
} {
  const targets = new Map<string, NetworkProbe>();
  const current = (): NetworkProbe[] => {
    for (const [key, target] of targets) if (target.expiresAt <= now()) targets.delete(key);
    return [...targets.values()];
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
      const requestedAt = now();
      const target = { host, port, requestedAt, expiresAt: requestedAt + 30_000 };
      targets.set(key, target);
      return target;
    },
  };
}
