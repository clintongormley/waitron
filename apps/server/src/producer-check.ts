import type { WaitronModule } from "@waitron/module";
import { isAppError } from "@waitron/shared";

export interface CheckOutput {
  log(line: string): void;
  error(line: string): void;
}

/**
 * Runs each fiscal module's own check of the process's settings as a production start would, and
 * answers the exit status. A line names a code, a setting and a reason, never a value.
 */
export function checkFiscalSettings(modules: readonly WaitronModule[], out: CheckOutput): 0 | 1 {
  const checked = modules.flatMap((module) =>
    module.fiscal?.refuseSettings === undefined ? [] : [module.fiscal],
  );
  if (checked.length === 0) {
    out.log("no fiscal module has settings to check");
    return 0;
  }
  let status: 0 | 1 = 0;
  for (const fiscal of checked) {
    try {
      fiscal.refuseSettings!("production");
      out.log(`${fiscal.id}: the settings pass`);
    } catch (error) {
      out.error(`${fiscal.id}: ${described(error)}`);
      status = 1;
    }
  }
  return status;
}

function described(error: unknown): string {
  if (!isAppError(error)) {
    return error instanceof Error ? `an unexpected ${error.name}` : "an unexpected failure";
  }
  const { setting, reason } = error.params as { setting?: unknown; reason?: unknown };
  if (typeof setting !== "string" || typeof reason !== "string") return error.code;
  return `${error.code} (setting ${setting}, reason ${reason})`;
}
