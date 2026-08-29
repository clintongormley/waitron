import type { SingletonRole } from "@waitron/db";
import type { PassReport } from "./pass.js";

/** Wraps the fiscal/settlement pass so it runs ONLY when this node holds the singleton duties
 * (deployment.singleton_role = 'primary'). A mirror or a sell-only local secondary returns a trivial
 * empty pass — running drain/reconcile there would submit to AEAT / settle for a host that must not
 * (promotion runbook design §2/§3c; #33 §7). `getRole` is read PER PASS (not captured once), so a later
 * promotion that flips the holder starts the duties on the next tick, no restart. */
export function singletonPass(
  getRole: () => SingletonRole,
  runPrimaryPass: (now: Date) => Promise<PassReport>,
): (now: Date) => Promise<PassReport> {
  return (now) =>
    getRole() === "primary"
      ? runPrimaryPass(now)
      : Promise.resolve({ nextDueAt: null, duties: [] });
}
