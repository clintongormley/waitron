import type { Hono } from "hono";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import {
  lockVenueDatabase,
  openVenueDatabase,
  readSettings,
  saveSettings,
  withTransaction,
} from "@waitron/db";
import { VENUE_FILE } from "@waitron/store";
import { MODULES_SETTINGS } from "./modules.js";
import { readRecoveryDatabase } from "./recovery-environment.js";
import { readRestoreAdminVerifiers } from "./restore-request.js";
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
import { BOOKINGS_RECOVERY_TEXT } from "./i18n/recovery-page.js";
import { renderDocument, escapeHtml } from "./html-page.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export interface BookingsRecoveryDeps {
  roots: { stateDir: string; venueDir: string };
  onFinished: () => Promise<void>;
}
async function eligible(deps: BookingsRecoveryDeps): Promise<boolean> {
  const state = await readRecoveryState(deps.roots.stateDir);
  return (
    state.level === "recovery" &&
    !state.refused &&
    state.lastErrorCode !== "storage.disk_full" &&
    (await readRecoveryDatabase(
      deps.roots,
      async (db) => (await readSettings(db, MODULES_SETTINGS)).doc.modules.bookings !== false,
    ))
  );
}
export async function renderBookingsRecovery(
  deps: BookingsRecoveryDeps,
  view: AdministratorView,
): Promise<string> {
  const text = BOOKINGS_RECOVERY_TEXT[view.locale];
  if (view.stopped) return `<p>${escapeHtml(text.stopped)}</p>`;
  if (view.message?.kind !== "moved" && !(await eligible(deps).catch(() => false))) return "";
  return renderEnvironmentSection({
    ...view,
    path: "/recovery-api/bookings/off",
    passwordId: "bookings-password",
    text,
    completed: text.done,
  });
}
export function mountBookingsRecovery(
  app: Hono,
  deps: BookingsRecoveryDeps,
  render: (view: AdministratorView) => Promise<string>,
  log?: Logger,
): void {
  mountAdministratorChoice(
    app,
    {
      path: "/recovery-api/bookings/off",
      stateDir: deps.roots.stateDir,
      throttleId: "3e394bdd-919e-4d65-a2f7-a89036d80691",
      eventPrefix: "recovery.bookings",
      onFinished: deps.onFinished,
      completedPage: (locale) =>
        renderDocument(
          locale,
          BOOKINGS_RECOVERY_TEXT[locale].move,
          `<p>${escapeHtml(BOOKINGS_RECOVERY_TEXT[locale].done)}</p>`,
        ),
      choose: async (authorize) => {
        const hold = await lockVenueDatabase(deps.roots.venueDir);
        try {
          if (!(await eligible(deps))) throw new AppError("setup.not_ready", {});
          await authorize(await readRestoreAdminVerifiers(join(deps.roots.venueDir, VENUE_FILE)));
          const opened = await openVenueDatabase(deps.roots.venueDir);
          try {
            await withTransaction(opened.venue, async (tx) => {
              const { doc, revision } = await readSettings(tx, MODULES_SETTINGS);
              await saveSettings(tx, MODULES_SETTINGS, {
                doc: { modules: { ...doc.modules, bookings: false } },
                expectedRevision: revision,
                personId: null,
              });
            });
          } finally {
            await opened.close();
          }
          await updateRecoveryState(
            { read: readRecoveryState, write: writeRecoveryState, lock: withRecoveryLock },
            deps.roots.stateDir,
            cleared,
          );
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
