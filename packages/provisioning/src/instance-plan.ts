import { AppError } from "@waitron/shared";
import { type DeploymentEnvironment } from "@waitron/db";
import { generatePassword } from "./identifiers.js";
import {
  INSTANCE_MIGRATOR_ROLE,
  INSTANCE_ROLES,
  type InstanceRole,
  type InstanceState,
  type RoleFacts,
} from "./instance-state.js";
import "./errors.js";

export type InstanceAction =
  | { kind: "create-database"; database: string; owner: string }
  | {
      kind: "create-role";
      role: InstanceRole;
      password: string;
      createRole: boolean;
      memberOf: string[];
    }
  | { kind: "grant-membership"; role: InstanceRole; memberOf: string }
  | { kind: "migrate" }
  | { kind: "stamp"; environment: DeploymentEnvironment };

export interface InstanceRequest {
  database: string;
  environment: DeploymentEnvironment;
}

/** The role each login inherits its table privileges through — created by the migration, not a
 * login this tool mints. */
const APP_USER = "app_user";

/**
 * The two deployment logins and what they must hold.
 * The migrator needs CREATEROLE (it creates app_user's members) and OWNS the database — from which
 * database- and schema-level CREATE follow implicitly, so no CREATE grant is planned. The app
 * inherits app_user and owns nothing.
 */
export const REQUIREMENTS: Record<
  InstanceRole,
  {
    createRole: boolean;
    memberOf: string[];
    ownsDatabase: boolean;
  }
> = {
  waitron_migrator: {
    createRole: true,
    memberOf: [APP_USER],
    ownsDatabase: true,
  },
  waitron_app: {
    createRole: false,
    memberOf: [APP_USER],
    ownsDatabase: false,
  },
};

/**
 * State + request → the actions that close the gap, or a throw.
 *
 * Pure, and deliberately so: every refusal and every idempotency rule in spec §4 is here, where a
 * unit test can reach it without a container.
 *
 * **The result is never empty.** `migrate` is pushed unconditionally (see its push below), so a
 * fully-provisioned deployment still yields exactly `[migrate]`, which `instance-plan.test.ts`'s
 * "plans exactly a migrate" pins with an exhaustive `toEqual`. There is no "nothing to do" branch in
 * `cli.ts` because there is no state that produces one.
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
  // Refusals first, before a single action is emitted. A plan that created a database and a role
  // and THEN discovered the stamp disagrees would leave the operator to clean up.
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
  // Ownership is fixed at CREATE (owner decision 2026-09-07, never `REASSIGN OWNED`): a database
  // owned by anyone but the migrator cannot be made to satisfy replication by granting, so it is
  // refused rather than adopted. `databaseExists` implies `databaseOwner` is set.
  if (state.databaseExists && state.databaseOwner !== INSTANCE_MIGRATOR_ROLE) {
    throw new AppError("provisioning.database_not_owned", {
      database: request.database,
      owner: state.databaseOwner,
    });
  }
  for (const role of INSTANCE_ROLES) {
    const facts = state.roles[role];
    if (facts !== undefined) assertUsable(role, facts);
  }

  const actions: InstanceAction[] = [];
  const migrator = state.roles[INSTANCE_MIGRATOR_ROLE];

  // The migrator is created FIRST, over the admin (instance-apply.ts routes it through the
  // `createrole_self_grant` transaction), so it can OWN the database created next and so migrate can
  // run AS it. `memberOf: []`: app_user does not exist until the migration creates it, so the
  // migrator's membership is a SEPARATE grant after migrate rather than an `IN ROLE` at creation.
  if (migrator === undefined) {
    actions.push({
      kind: "create-role",
      role: INSTANCE_MIGRATOR_ROLE,
      password: password(),
      createRole: REQUIREMENTS[INSTANCE_MIGRATOR_ROLE].createRole,
      memberOf: [],
    });
  }

  if (!state.databaseExists) {
    actions.push({
      kind: "create-database",
      database: request.database,
      owner: INSTANCE_MIGRATOR_ROLE,
    });
  }

  // Migrate AS the migrator (the session role option, instance-apply.ts). UNCONDITIONAL, so a run
  // interrupted inside a set is repaired: `state.inside.migratedSets` is journal-TABLE existence, not
  // "the set finished" — `drizzle-orm@0.45.2/pg-core/dialect.js:54-55` creates the journal table and
  // `:60` only then opens the transaction the set's migrations run in, so a rolled-back set leaves
  // the journal behind. Gating on it planned no `migrate` and let `instance` stamp and exit 0
  // against a deployment whose last set never ran. Re-running is idempotent in EFFECT
  // (`dialect.js:62` applies only what the journal watermark is behind).
  actions.push({ kind: "migrate" });

  // The migrator's app_user membership, granted after migrate (as the migrator, which now owns
  // app_user and holds ADMIN OPTION on it) — freshly created above, or drifted on a re-run.
  if (migrator === undefined || !migrator.memberOf.includes(APP_USER)) {
    actions.push({ kind: "grant-membership", role: INSTANCE_MIGRATOR_ROLE, memberOf: APP_USER });
  }

  // waitron_app is created LAST, as the migrator, `IN ROLE app_user` (which now exists) — or its
  // membership is repaired without rotating its password.
  const app = state.roles.waitron_app;
  if (app === undefined) {
    actions.push({
      kind: "create-role",
      role: "waitron_app",
      password: password(),
      createRole: REQUIREMENTS.waitron_app.createRole,
      memberOf: REQUIREMENTS.waitron_app.memberOf,
    });
  } else {
    for (const of of REQUIREMENTS.waitron_app.memberOf) {
      if (!app.memberOf.includes(of)) {
        actions.push({ kind: "grant-membership", role: "waitron_app", memberOf: of });
      }
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
 * A superuser can DISABLE TRIGGER; the append-only guarantee is the triggers. Refused, never repaired.
 *
 * A missing attribute is refused rather than ALTERed: this tool did not create the role, does not
 * know its password, and silently widening a role an operator made by hand is not its call.
 */
export function assertUsable(role: InstanceRole, facts: RoleFacts): void {
  if (facts.superuser) {
    throw new AppError("provisioning.role_over_privileged", {
      role,
      superuser: true,
    });
  }
  const missing: string[] = [];
  if (!facts.canLogin) missing.push("LOGIN");
  if (REQUIREMENTS[role].createRole && !facts.createRole) missing.push("CREATEROLE");
  // SET ROLE is required of the MIGRATOR only: migrate and the post-migrate role work run AS the
  // migrator over the admin's own credentials, and only the admin that created it with
  // `createrole_self_grant = 'set'` holds that membership. `adminCanSetRole` is read for both roles
  // but nothing ever SET ROLEs to the app role, so it is not checked there.
  if (role === INSTANCE_MIGRATOR_ROLE && !facts.adminCanSetRole) missing.push("SET ROLE");
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
      return `create database ${action.database} owned by ${action.owner}`;
    case "create-role": {
      const attributes = ["login", ...(action.createRole ? ["createrole"] : [])];
      const memberships =
        action.memberOf.length > 0 ? `, member of ${action.memberOf.join(", ")}` : "";
      return `create role ${action.role} (${attributes.join(", ")}${memberships})`;
    }
    case "grant-membership":
      return `grant ${action.memberOf} to ${action.role}`;
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
