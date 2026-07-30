import { AppError } from "@waitron/shared";
import { type DeploymentEnvironment } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
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
  | { kind: "grant-membership"; role: InstanceRole; of: string }
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
 * unit test can reach it without a container. An empty result means "everything is already
 * present" — which is what lets the CLI report a no-op rather than asking an operator to confirm
 * one.
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
  const applied = new Set(state.inside?.migratedSets ?? []);
  if (manifestSets().some((set) => !applied.has(set.name))) actions.push({ kind: "migrate" });

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
        if (!facts.memberOf.includes(of)) actions.push({ kind: "grant-membership", role, of });
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
