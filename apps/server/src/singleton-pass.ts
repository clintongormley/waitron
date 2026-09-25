import type { SingletonRole } from "@waitron/db";
import type { PassReport } from "./pass.js";

/** Runs the fiscal/settlement pass ONLY when this node holds the singleton duties
 * (`node_roles.singleton_role = 'primary'`); any other node must not submit to AEAT or settle.
 * `getRole` is read per pass, so a promotion starts the duties on the next tick without a restart. */
export function singletonPass(
  getRole: () => SingletonRole,
  runPrimaryPass: (now: Date) => Promise<PassReport>,
): (now: Date) => Promise<PassReport> {
  return (now) =>
    getRole() === "primary"
      ? runPrimaryPass(now)
      : Promise.resolve({ nextDueAt: null, duties: [] });
}
