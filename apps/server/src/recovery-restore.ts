import { discardRestoreSetAside } from "./restore.js";
import { RESTORE_DISCARD_TEXT } from "./i18n/recovery-page.js";
import type { Hono } from "hono";
import { AppError, type SupportedLocale } from "@waitron/shared";
import { lockVenueDatabase } from "@waitron/db";
import { readRestoreFlowPhase } from "@waitron/provisioning";
import {
  CLOUD_RECOVERY_FILE,
  SCRATCH_DIR,
  SETUP_OPERATION_FILE,
  TRADING_ENV_FILE,
} from "@waitron/store";
import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { OPTIONAL_BACKUP_STATE } from "./backup-optional-state.js";
import { PREVIOUS_SECRET_SUFFIX, STAGED_SECRET_SUFFIX } from "./restore-secrets.js";
import { clearRestorePlacement, restorePreviousIdentity } from "./restore-request.js";
import { endRestoreFlow, restoreAdminVerifiers } from "./restore-flow.js";
import { syncFolderHolding, stagedPath } from "./fs-atomic.js";
import {
  cleared,
  readRecoveryState,
  updateRecoveryState,
  writeRecoveryState,
} from "./recovery-state.js";
import { withRecoveryLock } from "./recovery-lock.js";
import {
  mountAdministratorChoice,
  renderEnvironmentSection,
  type AdministratorView,
} from "./recovery-administrator.js";
import { escapeHtml, renderDocument } from "./html-page.js";
import "./errors.js";

export interface RestoreRecoveryDeps {
  roots: { stateDir: string; venueDir: string };
  onFinished: () => Promise<void>;
}

export async function renderRestoreDiscard(
  deps: RestoreRecoveryDeps,
  view: AdministratorView,
): Promise<string> {
  const text = RESTORE_DISCARD_TEXT[view.locale];
  if (view.stopped) return `<p>${escapeHtml(text.stopped)}</p>`;
  if (view.message?.kind !== "moved" && (await restoreAdminVerifiers(deps.roots.stateDir)) === null)
    return "";
  const phase = await readRestoreFlowPhase(deps.roots.stateDir);
  return renderEnvironmentSection({
    ...view,
    path: "/recovery-api/restore/discard",
    completed: text.done,
    text: { ...text, detail: phase === "staged" ? text.before : text.after },
  });
}

async function removeFile(path: string): Promise<void> {
  await rm(path, { force: true });
  try {
    await syncFolderHolding(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function discard(deps: RestoreRecoveryDeps): Promise<void> {
  const { stateDir } = deps.roots;
  const phase = await readRestoreFlowPhase(stateDir);
  if (phase === null) throw new AppError("setup.not_ready", {});
  if (phase !== "staged") {
    await clearRestorePlacement(deps.roots);
    await discardRestoreSetAside(deps.roots.venueDir);
  } else {
    const identity = join(stateDir, TRADING_ENV_FILE);
    if (
      await lstat(identity).then(
        () => false,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return true;
          throw error;
        },
      )
    ) {
      await restorePreviousIdentity(stateDir);
    }
  }
  const names = new Set([
    ...RECOVERY_FILES,
    ...OPTIONAL_BACKUP_STATE,
    ...ALL_MODULES.flatMap(
      (module) =>
        module.backup?.verification?.entries
          .filter((entry) => entry.name.startsWith("secrets/"))
          .map((entry) => entry.name.slice("secrets/".length)) ?? [],
    ),
  ]);
  for (const name of names) {
    const path = join(stateDir, name);
    if (phase !== "staged" && !name.startsWith("tls/")) await removeFile(path);
    for (const suffix of [
      STAGED_SECRET_SUFFIX,
      stagedPath(STAGED_SECRET_SUFFIX),
      PREVIOUS_SECRET_SUFFIX,
    ])
      await removeFile(`${path}${suffix}`);
  }
  await removeFile(join(stateDir, SETUP_OPERATION_FILE));
  await removeFile(join(stateDir, CLOUD_RECOVERY_FILE));
  await rm(join(stateDir, SCRATCH_DIR), { recursive: true, force: true });
  await syncFolderHolding(join(stateDir, SCRATCH_DIR));
  await endRestoreFlow(stateDir);
  await updateRecoveryState(
    { read: readRecoveryState, write: writeRecoveryState, lock: withRecoveryLock },
    stateDir,
    cleared,
  );
}

export function mountRestoreDiscard(
  app: Hono,
  deps: RestoreRecoveryDeps,
  render: (view: AdministratorView) => Promise<string>,
  log?: Logger,
): void {
  mountAdministratorChoice(
    app,
    {
      path: "/recovery-api/restore/discard",
      stateDir: deps.roots.stateDir,
      throttleId: "2272eac2-2e3b-4472-a7a9-f01f0ba802ed",
      onFinished: deps.onFinished,
      eventPrefix: "recovery.restore_discard",
      completedPage: (locale: SupportedLocale) =>
        renderDocument(
          locale,
          RESTORE_DISCARD_TEXT[locale].move,
          `<p>${escapeHtml(RESTORE_DISCARD_TEXT[locale].done)}</p>`,
        ),
      choose: async (authorize) => {
        const hold = await lockVenueDatabase(deps.roots.venueDir);
        try {
          const hashes = await restoreAdminVerifiers(deps.roots.stateDir);
          if (hashes === null) throw new AppError("setup.not_ready", {});
          await authorize(hashes);
          await discard(deps);
          return "";
        } finally {
          hold.release();
        }
      },
    },
    render,
    log,
  );
}
