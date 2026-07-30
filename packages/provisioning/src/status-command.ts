import { manifestSets } from "@waitron/migrations";
import { INSTANCE_ROLES, type InstanceState } from "./instance-state.js";

/**
 * What this deployment has, as lines.
 *
 * A formatter over an already-read `InstanceState` rather than a function that reads one, so the
 * whole report is testable without a container and `runCli` owns the connections. Carries no
 * secret by construction: `InstanceState` (instance-state.ts) declares only `database: string`,
 * `databaseExists: boolean`, `roles: Partial<Record<InstanceRole, RoleFacts>>` — whose `RoleFacts`
 * is `canLogin`/`createRole`/`superuser`/`bypassRls`/`memberOf: string[]` — and
 * `inside: InsideState | null`, whose `InsideState` is `migratedSets: string[]` and
 * `stamp: DeploymentEnvironment | null`. None of those fields is, or could hold, a password, a
 * connection string or a key.
 */
export function formatStatus(state: InstanceState): string[] {
  const lines = [`database ${state.database}: ${state.databaseExists ? "present" : "absent"}`, ""];

  for (const role of INSTANCE_ROLES) {
    const facts = state.roles[role];
    if (facts === undefined) {
      lines.push(`role ${role}: absent`);
      continue;
    }
    const notes = [
      facts.canLogin ? "login" : "NOLOGIN",
      ...(facts.createRole ? ["createrole"] : []),
      ...(facts.superuser ? ["SUPERUSER"] : []),
      ...(facts.bypassRls ? ["BYPASSRLS"] : []),
      `member of ${facts.memberOf.length > 0 ? facts.memberOf.join(", ") : "nothing"}`,
    ];
    lines.push(`role ${role}: present — ${notes.join(", ")}`);
  }

  if (state.inside === null) {
    lines.push("", "Nothing inside the database was read: it does not exist yet.");
    return lines;
  }

  const applied = new Set(state.inside.migratedSets);
  lines.push("");
  for (const set of manifestSets()) {
    lines.push(`migration set ${set.name}: ${applied.has(set.name) ? "applied" : "not applied"}`);
  }
  lines.push("", `deployment stamp: ${state.inside.stamp ?? "unstamped"}`);
  return lines;
}
