import { createHash } from "node:crypto";
import type { FirstSetupState } from "./first-setup-state.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function firstSetupPublicationDigest(
  state: FirstSetupState,
  settings: { aeatCert?: unknown; email?: unknown },
) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          attemptId: state.frozen.attemptId,
          nodeId: state.frozen.nodeId,
          administratorId: state.frozen.administratorId,
          modules: state.frozen.modules,
          configurationImport: state.frozen.configurationImport ?? null,
          inputs: Object.fromEntries(
            Object.entries(state.inputs).filter(([name]) => name !== "$publication"),
          ),
          mode: "live",
          aeatCert: settings.aeatCert ?? null,
          email: settings.email ?? null,
        }),
      ),
    )
    .digest("hex");
  return digest;
}
