import { AppError } from "@waitron/shared";
import { type DeploymentEnvironment } from "@waitron/db";
import { generatePassword } from "./identifiers.js";
import {
  INSTANCE_ROLES,
  type InstanceRole,
  type InstanceState,
  type RoleFacts,
} from "./instance-state.js";
import "./errors.js";

export type InstanceAction =
  | { kind: "create-database"; database: string }
  | {
      kind: "create-role";
      role: InstanceRole;
      password: string;
      createRole: boolean;
      memberOf: string[];
    }
  | { kind: "grant-membership"; role: InstanceRole; memberOf: string }
  | { kind: "grant-database-create"; role: InstanceRole; database: string }
  | { kind: "grant-schema-create"; role: InstanceRole; withGrantOption: boolean }
  | { kind: "migrate" }
  | { kind: "stamp"; environment: DeploymentEnvironment };

export interface InstanceRequest {
  database: string;
  environment: DeploymentEnvironment;
}

/**
 * What each role must be, as data rather than as three branches.
 *
 * `waitron_migrator` needs `CREATEROLE` because the empty-database migrations run
 * `CREATE ROLE app_user NOLOGIN` and four more, and — because Postgres grants the creating role
 * admin option on a role it just created — that same attribute is what lets each migration's
 * `GRANT <support_role> TO CURRENT_USER WITH INHERIT FALSE` / `REVOKE` pair work with no further
 * grant. `apps/server/README.md`'s empty-database section is the source; this encodes it.
 */
const REQUIREMENTS: Record<
  InstanceRole,
  {
    createRole: boolean;
    memberOf: string[];
    databaseCreate: boolean;
    schemaCreate: false | { withGrantOption: boolean };
  }
> = {
  waitron_migrator: {
    createRole: true,
    memberOf: ["app_user"],
    databaseCreate: true,
    // WITH GRANT OPTION, and it did not matter for the already-migrated case: the empty-database
    // migrations temporarily re-grant CREATE ON SCHEMA public to each support role they create so
    // it can own a function, then revoke it. A grant this role cannot itself pass on fails
    // partway through that dance.
    schemaCreate: { withGrantOption: true },
  },
  // Least privilege — spec §10 of the server design. Membership of `app_user` and nothing else, so
  // every tenant-isolation policy applies to the connection every duty pass runs over.
  waitron_app: {
    createRole: false,
    memberOf: ["app_user"],
    databaseCreate: false,
    schemaCreate: false,
  },
  // `app_user` for locations/tills/invoice_series, which it already grants; `tenant_provisioner`
  // for the one grant it deliberately does not (INSERT on tenants, 0011_provisioner_role.sql).
  waitron_provisioner: {
    createRole: false,
    memberOf: ["app_user", "tenant_provisioner"],
    databaseCreate: false,
    schemaCreate: false,
  },
};

/**
 * State + request → the actions that close the gap, or a throw.
 *
 * Pure, and deliberately so: every refusal and every idempotency rule in spec §4 is here, where a
 * unit test can reach it without a container.
 *
 * **The result is never empty.** `migrate` and `waitron_migrator`'s two grants are all pushed
 * unconditionally — see the `migrate` push below, and "Grants are re-issued on every run rather
 * than diffed" at the bottom — so a deployment that already has everything still yields exactly
 * those three, which `instance-plan.test.ts`'s "plans the idempotent grants and a migrate" pins
 * with an exhaustive `toEqual`.
 * An earlier version of this paragraph said an empty result was "what lets the CLI report a no-op".
 * That contradicted `cli.ts`'s own plan-summary comment, and `cli.ts` was the one that was right:
 * a "nothing to do" branch there would be unreachable code claiming to handle a state that cannot
 * arise.
 *
 * `password` is injected so a test can pin it. It is called ONCE PER ROLE CREATED and never for a
 * role that already exists: this tool does not know the password of a role it did not just make,
 * and rotating one would break whatever is already using it.
 */
export function planInstance(
  state: InstanceState,
  request: InstanceRequest,
  password: () => string = generatePassword,
): InstanceAction[] {
  // Refusals first, before a single action is emitted. A plan that created a database and three
  // roles and THEN discovered the stamp disagrees would leave the operator to clean up.
  if (
    state.inside !== null &&
    state.inside.stamp !== null &&
    state.inside.stamp !== request.environment
  ) {
    throw new AppError("deployment.already_stamped", {
      stamped: state.inside.stamp,
      requested: request.environment,
    });
  }
  for (const role of INSTANCE_ROLES) {
    const facts = state.roles[role];
    if (facts !== undefined) assertUsable(role, facts);
  }

  const actions: InstanceAction[] = [];
  if (!state.databaseExists) actions.push({ kind: "create-database", database: request.database });

  // Migrate before any LOGIN role is created — not merely before the stamp. `app_user` and
  // `tenant_provisioner`, the two NOLOGIN roles every REQUIREMENTS entry below names in `memberOf`,
  // are themselves created by the "core" migration set (0001_tenancy_rls.sql line 18,
  // 0011_provisioner_role.sql line 58), not by this tool. Emitting `create-role … IN ROLE app_user`
  // before migrate runs is not a style choice: on a blank cluster `app_user` does not exist yet, and
  // Postgres refuses the grant outright. Verified directly against a real container with this
  // ordering reversed: `create role "waitron_migrator" ... in role "app_user"` raised
  // `error: role "app_user" does not exist` (SQLSTATE 42704, acl.c:get_rolespec_tuple) — the tool
  // failed on its very first end-to-end run against a blank database.
  //
  // UNCONDITIONAL, for the reason the two grants at the bottom of this function already are. This
  // was gated on `state.inside.migratedSets`, which is journal-TABLE existence and NOT "the set
  // finished": `drizzle-orm@0.45.2/pg-core/dialect.js:54-55` creates the journal table, and `:60`
  // only then opens the transaction the set's migrations run in — so a run interrupted inside a set
  // rolls the migrations back and leaves the journal behind. The gate read that leftover as "done",
  // planned no `migrate`, and let `instance` grant, stamp and exit 0 against a deployment whose last
  // set never ran: the same "reported success having done nothing" shape `verifyGrants`
  // (instance-apply.ts) exists to catch, one file over.
  //
  // Re-running the migrator is idempotent in EFFECT — `dialect.js:62` applies a migration only when
  // the journal's watermark is behind it — but it is neither free nor privilege-free, and the
  // second half is the one that bites. Per manifest set (`applyMigrations`, packages/migrations/
  // src/apply.ts:45) Drizzle first issues `CREATE SCHEMA IF NOT EXISTS "public"` (`dialect.js:54`)
  // and `CREATE TABLE IF NOT EXISTS <journal>` (`:55`), BEFORE the journal read at `:56`. Postgres
  // checks the privilege for those two before it evaluates whether the object already exists —
  // `apps/server/README.md`'s "Two connection strings, one purpose split" is the receipt — so the
  // first needs database-level CREATE and the second needs CREATE on `public`. An admin holding
  // neither now fails on a run that used to be a silent no-op: measured on postgres:18-alpine as
  // `42501 permission denied for database` on that first statement (this change's spec §4, and
  // `instance-apply.pg.test.ts`'s "a partially-privileged admin reads state but fails the
  // migrate"). Over and above that, one advisory lock and one journal read per set.
  actions.push({ kind: "migrate" });

  for (const role of INSTANCE_ROLES) {
    const need = REQUIREMENTS[role];
    const facts = state.roles[role];
    if (facts === undefined) {
      actions.push({
        kind: "create-role",
        role,
        password: password(),
        createRole: need.createRole,
        memberOf: need.memberOf,
      });
    } else {
      // The role exists and is usable. Its memberships may still have drifted — an operator who
      // created `waitron_provisioner` by hand from the README, before 0011 existed, has one
      // holding `app_user` alone. That is repairable without touching the password.
      for (const of of need.memberOf) {
        if (!facts.memberOf.includes(of)) {
          actions.push({ kind: "grant-membership", role, memberOf: of });
        }
      }
    }
  }

  // Grants are re-issued on every run rather than diffed. Both are idempotent in PostgreSQL, and
  // reading them back accurately is the part `apps/server/README.md` gets wrong when done by hand:
  // `information_schema.role_table_grants` does not cover database- or schema-level CREATE at all,
  // and `has_database_privilege` answers for the RECURSIVE closure, so a role that holds CREATE
  // only via a group reads as satisfied when the direct grant this tool makes is absent. Issuing
  // both unconditionally is cheaper than a check that can be wrong.
  for (const role of INSTANCE_ROLES) {
    const need = REQUIREMENTS[role];
    if (need.databaseCreate) {
      actions.push({ kind: "grant-database-create", role, database: request.database });
    }
    if (need.schemaCreate !== false) {
      actions.push({
        kind: "grant-schema-create",
        role,
        withGrantOption: need.schemaCreate.withGrantOption,
      });
    }
  }

  if (state.inside?.stamp !== request.environment) {
    actions.push({ kind: "stamp", environment: request.environment });
  }
  return actions;
}

/**
 * Refuses a role this tool must not adopt.
 *
 * SUPERUSER or BYPASSRLS is refused rather than repaired: every grant `instance` makes sits behind
 * an RLS policy such a role ignores outright, so adopting one would produce a deployment that
 * looks provisioned and isolates nothing — the identical refusal `0001_tenancy_rls.sql` makes for
 * a pre-existing `app_user`.
 *
 * A missing attribute is refused rather than ALTERed: this tool did not create the role, does not
 * know its password, and silently widening a role an operator made by hand is not its call.
 */
function assertUsable(role: InstanceRole, facts: RoleFacts): void {
  if (facts.superuser || facts.bypassRls) {
    throw new AppError("provisioning.role_over_privileged", {
      role,
      superuser: facts.superuser,
      bypassRls: facts.bypassRls,
    });
  }
  const missing: string[] = [];
  if (!facts.canLogin) missing.push("LOGIN");
  if (REQUIREMENTS[role].createRole && !facts.createRole) missing.push("CREATEROLE");
  if (missing.length > 0) throw new AppError("provisioning.role_unusable", { role, missing });
}

/**
 * One plan action, as a line an operator can check.
 *
 * The `create-role` case prints the role's attributes and memberships and NOT `action.password`.
 * That is the whole reason this is a function rather than `JSON.stringify(action)`: the plan is
 * printed before the confirmation, on a screen that is not cleared afterwards unless something was
 * created, and `cli.test.ts`'s "never puts a generated password in the plan summary" counts each
 * password's occurrences in the whole transcript to keep it that way.
 *
 * It lives here rather than in `cli.ts` because TWO callers need the identical wording and
 * `errors.ts` promises they have it: the CLI prints it in the plan summary an operator approves,
 * and `verifyGrants` (instance-apply.ts) puts it in `provisioning.grant_ineffective`'s `missing`
 * so the line reporting a failure is the same line that was approved. Two hand-kept copies were
 * ALREADY out of step — the registry claimed the words matched while `verifyGrants` dropped the
 * leading `grant`. One function is what makes that promise structural instead of aspirational.
 * `cli.ts` cannot be the home: `instance-apply.ts` would have to import from it, and `cli.ts`
 * imports `instance-apply.ts`.
 */
export function describeAction(action: InstanceAction): string {
  switch (action.kind) {
    case "create-database":
      return `create database ${action.database}`;
    case "create-role": {
      const attributes = ["login", ...(action.createRole ? ["createrole"] : [])];
      const memberships =
        action.memberOf.length > 0 ? `, member of ${action.memberOf.join(", ")}` : "";
      return `create role ${action.role} (${attributes.join(", ")}${memberships})`;
    }
    case "grant-membership":
      return `grant ${action.memberOf} to ${action.role}`;
    case "grant-database-create":
      return `grant create on database ${action.database} to ${action.role}`;
    case "grant-schema-create":
      return `grant create on schema public to ${action.role}${
        action.withGrantOption ? " with grant option" : ""
      }`;
    case "migrate":
      // Not "apply every migration set". Every set IS handed to the migrator, but Drizzle applies
      // only what its journal's watermark is behind (`dialect.js:62`), and this line is now printed
      // on EVERY run — including a fully-migrated no-op, since the planner stopped gating on
      // journal presence. A line that reads as "re-run all migrations" on a plan an operator is
      // confirming against a live production cluster claims more than the code does.
      return "apply any pending migrations, in every set";
    case "stamp":
      return `stamp the database as ${action.environment}`;
  }
}
