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

  // "journal present", not "applied". `InsideState.migratedSets` is the set names whose journal
  // TABLE exists (instance-state.ts says so at its own declaration), and that is strictly weaker
  // than "every migration in the set ran": `drizzle-orm@0.45.2/pg-core/dialect.js:54-60` creates
  // the journal table first and only then applies the set's migrations, all inside one
  // transaction, and `packages/db/src/migrate.ts:42` puts that table in `public`, which is where
  // `readInside`'s `to_regclass` probe looks. An `instance` interrupted inside the last set
  // therefore leaves all five journals present with none of that set's migrations applied.
  //
  // That state is not dangerous — the host's own `applyMigrations` finishes the job at its next
  // boot — but it is one this report cannot distinguish from a complete deployment, and it is one
  // a re-run of `instance` will NOT repair, since the planner emits `migrate` only when a journal
  // is missing. So the report says what it read and what that does and does not mean.
  const journalled = new Set(state.inside.migratedSets);
  lines.push("");
  for (const set of manifestSets()) {
    lines.push(
      `migration set ${set.name}: ${journalled.has(set.name) ? "journal present" : "journal absent"}`,
    );
  }
  lines.push(
    "",
    "A journal table is created before its set's migrations run, so `journal present` means",
    "the set was started, not that it finished. Anything still pending is applied at the",
    "host's next boot; `instance` plans a migrate only when a journal is MISSING.",
  );
  lines.push("", `deployment stamp: ${state.inside.stamp ?? "unstamped"}`);
  return lines;
}
