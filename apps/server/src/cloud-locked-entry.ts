import { fileURLToPath } from "node:url";
import "./errors.js";
import { ALL_MODULES } from "@waitron/composition";
import { AppError } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import { parseEmergencyCopyBinding } from "./emergency-copy-binding.js";
import { readLockedTotpKeys, startLockedCopy } from "./cloud-locked-start.js";
import { createLogger } from "./logger.js";

try {
  const totpPurposeKeys = readLockedTotpKeys(process.env);
  const raw = process.env.WAITRON_LOCKED_COPY;
  delete process.env.WAITRON_LOCKED_COPY;
  type Launch = Omit<
    Parameters<typeof startLockedCopy>[0],
    "modules" | "now" | "log" | "signal" | "totpPurposeKeys" | "migrationsRoot"
  > & { migrationsRoot?: string | null };
  let input: Launch;
  try {
    input = JSON.parse(raw ?? "") as Launch;
  } catch {
    throw new AppError("cloud.request_invalid", {});
  }
  if (
    !input ||
    typeof input !== "object" ||
    [
      input.venueDir,
      input.stateDir,
      input.origin,
      input.hostname,
      input.tls?.certFile,
      input.tls?.keyFile,
      input.cloud?.origin,
      input.cloud?.privateKey,
      input.cloud?.publicKey,
      input.cloud?.view?.registration?.venueId,
      input.cloud?.view?.registration?.installationId,
    ].some((value) => typeof value !== "string" || value.trim() === "") ||
    !Number.isInteger(input.port) ||
    input.port < 1 ||
    input.port > 65535
  )
    throw new AppError("cloud.request_invalid", {});
  const now = () => new Date();
  const binding = parseEmergencyCopyBinding(input.binding, now());
  if (input.environment !== binding.environment) throw new AppError("cloud.request_invalid", {});
  const log = createLogger((line) => process.stdout.write(line), now);
  const running = await startLockedCopy({
    ...input,
    binding,
    processEnv: {},
    totpPurposeKeys,
    modules: ALL_MODULES,
    now,
    log,
    migrationsRoot:
      input.migrationsRoot === undefined
        ? fileURLToPath(new URL("drizzle", import.meta.url))
        : input.migrationsRoot,
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      void running.close();
    });
  log("info", "cloud-locked.ready", { expiresAt: binding.expiresAt });
  process.exit(await running.closed);
} catch (error) {
  process.stderr.write(`${codeOf(error)}\n`);
  process.exit(1);
}
