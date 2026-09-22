import { AppError } from "@waitron/shared";
import type { DeploymentEnvironment } from "@waitron/db";
import "./errors.js";

/** The variable the environment is derived from — the same one `apps/server` boots under, so a
 * scripted deployment stamps a venue directory for the environment its server will then demand.
 * Named once so the derivation and the refusal that reports it cannot drift apart. */
const ENVIRONMENT_VARIABLE = "WAITRON_ENV";

/**
 * Which environment a venue directory this run stamps belongs to, read from `WAITRON_ENV`.
 *
 * **The default is `preproduction` and `production` has to be typed out** (CLAUDE.md §5). A
 * production invoice number is never reused, so a database stamped `production` by omission would
 * take real numbering for test sales and leave a permanent hole in the series — which is exactly
 * what Veri*Factu detects. Every other reading of a missing value is recoverable; this one is not.
 *
 * **Unset means absent OR empty.** An operator's `VAR=` line in an env file falls back to the same
 * default as no line at all, rather than being refused as an invalid environment.
 *
 * **`dev` is accepted and maps to `preproduction`.** It is a development-only input that turns on
 * the dev device switcher in the server; fiscally it is preproduction, and the stamp never sees the
 * word. A box started with `WAITRON_ENV=dev` can therefore be provisioned by this tool without
 * changing its environment first.
 *
 * **Anything else is REFUSED, never rounded to the nearer of the two.** `Production`, `prod` and a
 * space-padded ` production` all throw: an approximation of the word is not the word.
 *
 * **This is a second implementation of `apps/server/src/config.ts`'s `deploymentEnvironment`, and
 * deliberately so** — a package cannot import an app, and `apps/server` already depends on this
 * package. The two agree case for case (`environment.test.ts`'s table, and
 * `apps/server/src/config.test.ts`'s), and nothing in this repository runs both over one input, so
 * the tables are the only thing holding them together. What differs is the error: this one throws
 * from this package's own registry, because `server.*` is reserved for facts about the server
 * process and a CLI is not one.
 */
export function resolveEnvironment(env: Record<string, string | undefined>): DeploymentEnvironment {
  const raw = env[ENVIRONMENT_VARIABLE];
  if (raw === undefined || raw === "") return "preproduction";
  if (raw === "dev") return "preproduction";
  if (raw !== "production" && raw !== "preproduction") {
    throw new AppError("provisioning.invalid_environment", {
      variable: ENVIRONMENT_VARIABLE,
      value: raw,
    });
  }
  return raw;
}
