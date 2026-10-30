import type { SetupApi } from "./api/client.js";
import type {
  FirstSetupInspection,
  FirstSetupResolutionSnapshot,
  StartAgainConfirm,
  StartAgainRefusalCause,
  StartAgainSummary,
} from "./api/first-setup-types.js";
import { startAgainRefusalCause } from "./first-setup-session.js";

const SUMMARY_KEYS = ["reached", "recoveryRecordDamaged", "recovery", "databaseUnreadable"];
const SUMMARY_REACHED = ["claimed", "named", "fiscal-started", "fiscal-finished"];
const RECOVERY_KEYS = ["startedAt", "lastActiveAt", "lastActiveSource", "failed", "cloud"] as const;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readableRecovery(value: unknown): boolean {
  return (
    object(value) &&
    Object.keys(value).length === RECOVERY_KEYS.length &&
    RECOVERY_KEYS.every((key) => key in value) &&
    typeof value.startedAt === "string" &&
    typeof value.lastActiveAt === "string" &&
    ["memory", "saved-step"].includes(value.lastActiveSource as string) &&
    typeof value.failed === "boolean" &&
    typeof value.cloud === "boolean"
  );
}
const flag = (value: unknown) => value === undefined || value === true;
function summaryOf(value: unknown): StartAgainSummary {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !SUMMARY_KEYS.includes(key)) ||
    !SUMMARY_REACHED.includes(value.reached as string) ||
    !flag(value.recoveryRecordDamaged) ||
    !flag(value.databaseUnreadable) ||
    !(value.recovery === undefined || readableRecovery(value.recovery))
  )
    throw { code: "setup.attempt_invalid" };
  return value as unknown as StartAgainSummary;
}
const sameSummary = (a: StartAgainSummary, b: StartAgainSummary) =>
  a.reached === b.reached &&
  a.recoveryRecordDamaged === b.recoveryRecordDamaged &&
  a.databaseUnreadable === b.databaseUnreadable &&
  (a.recovery === undefined
    ? b.recovery === undefined
    : b.recovery !== undefined &&
      RECOVERY_KEYS.every((key) => a.recovery![key] === b.recovery![key]));

/** What Start again would delete, as the box says it; read with no setup password or owner tab. */
export async function readWipeSummary(
  api: SetupApi,
  snapshot: FirstSetupResolutionSnapshot,
): Promise<StartAgainSummary> {
  return summaryOf(await api.startAgainSummary(snapshot));
}

/**
 * Sends Start again for the summary the page showed, after reading it again: a summary that changed
 * since it was shown sends nothing.
 */
export async function sendWipe(
  api: SetupApi,
  snapshot: FirstSetupResolutionSnapshot,
  database: FirstSetupInspection["database"],
  shown: StartAgainSummary,
): Promise<{ restarting: true }> {
  if (!sameSummary(await readWipeSummary(api, snapshot), shown))
    throw { code: "setup.attempt_conflict" };
  const confirm: StartAgainConfirm =
    database === "missing"
      ? { confirmMissingDatabase: { nothingFiledOrSold: true, shown } }
      : {
          ...(shown.recovery !== undefined
            ? { confirmRecoveryDiscard: { shown } }
            : shown.databaseUnreadable === true
              ? { confirmUnreadableDatabase: { shown } }
              : {}),
          ...(shown.recoveryRecordDamaged === true && {
            recoveryRecordDamagedShown: true as const,
          }),
        };
  const result = await api.startAgainFirstSetup(snapshot, confirm);
  if (result?.restarting !== true) throw { code: "setup.attempt_conflict" };
  return result;
}

/**
 * The refusal the page draws for a Start again error, or `undefined` for one it describes as any
 * other error. `setup.owner_required` is drawn as unavailable: the owner-tab words are false for a
 * Start again that needs no owner tab.
 */
export function wipeRefusal(error: unknown): StartAgainRefusalCause | "unavailable" | undefined {
  const cause = startAgainRefusalCause(error);
  if (cause !== undefined) return cause;
  return object(error) &&
    (error.code === "setup.not_ready" || error.code === "setup.owner_required")
    ? "unavailable"
    : undefined;
}
