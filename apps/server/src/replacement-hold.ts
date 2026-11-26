import type { KeyRing } from "@waitron/credentials";
import { readNodeMembership, withTransaction, type Database } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import type { Hono } from "hono";
import {
  BOX_EMAIL_CHECK_MS,
  boxAlertMailJob,
  createBoxEmailDuty,
  readBoxEmailContext,
  readOpenEmailedIncidents,
} from "./box-alert-email.js";
import { boxAlertMail } from "./box-alert-mail.js";
import type { ServerConfig } from "./config.js";
import type { DiskFullState } from "./disk-full-state.js";
import { resolveMailDeliveryIn } from "./email-delivery.js";
import type { FreeSpaceState } from "./free-space-watch.js";
import type { HealthState } from "./health.js";
import type { JobRunner } from "./job-runner.js";
import type { Logger } from "./logger.js";
import { abandonMailClaims, mailSendJob } from "./mail-sender.js";
import { mountNodeApi } from "./node-api.js";
import { recordReplacement } from "./stop-alert.js";
import { createTextEmailSender } from "./text-email.js";
import { readVenueLocale } from "./venue-locale.js";
import { mountReplacementPage } from "./waiting-page.js";

export async function mountReplacementHold(deps: {
  app: Hono;
  db: Database;
  config: ServerConfig;
  nodeId: string;
  ring: KeyRing;
  health: HealthState;
  runner: JobRunner;
  disk: DiskFullState;
  space: FreeSpaceState;
  now: () => Date;
  log: Logger;
}): Promise<void> {
  const { app, db, config, nodeId, ring, health, runner, disk, space, now, log } = deps;
  health.takesNoSales = true;
  mountNodeApi(
    app,
    {
      nodeId,
      acceptingSales: false,
      environment: config.environment,
      readMembership: () => readNodeMembership(db),
    },
    log,
  );
  mountReplacementPage(app, log);

  const venueLanguage = (await readVenueLocale(db)) === "es-ES" ? "es" : "en";
  const owners = [boxAlertMail({ previousEpisodeMailIds: new Set(), venueLanguage, log })];
  let recorded = false;
  const record = async () => {
    if (recorded) return;
    await recordReplacement(db, now());
    recorded = true;
  };
  await record().catch((error: unknown) =>
    log("warn", "server.replacement_alert_failed", { errorCode: codeOf(error) }),
  );
  const alerts = createBoxEmailDuty({
    db,
    now,
    disk,
    space,
    log,
    moduleNotices: async () => ({ notices: [], unavailable: [] }),
    emailedIncidents: async () => {
      await record();
      return (await readOpenEmailedIncidents(db)).filter(({ code }) => code === "start.replaced");
    },
    backupStopped: () => undefined,
    context: () =>
      readBoxEmailContext(db, {
        ring,
        venueLanguage,
        practiceMode: config.devMode || config.onboardingIntent === "demo",
        captureOnly: !config.devMode && config.onboardingIntent === "demo",
      }),
    send: createTextEmailSender(),
    isPrimary: () => true,
  });
  await withTransaction(db, (tx) => abandonMailClaims(tx, owners, now())).catch((error: unknown) =>
    log("warn", "server.replacement_mail_recovery_failed", { errorCode: codeOf(error) }),
  );
  runner.add({ ...boxAlertMailJob(alerts, BOX_EMAIL_CHECK_MS), firstPassAfterMs: 0 });
  runner.add(
    mailSendJob({
      db,
      owners,
      now,
      log,
      isPrimary: () => disk.since() === null,
      resolveDelivery: (tx, rule) => resolveMailDeliveryIn(tx, ring, config, rule),
      maxSleepMs: 5000,
    }),
  );
}
