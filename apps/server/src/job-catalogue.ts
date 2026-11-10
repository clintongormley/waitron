export type StepdownMark = { readonly stop: true } | { readonly keepRunning: string };
const stop = { kind: "job", stepdown: { stop: true } } as const;

export const JOB_CATALOGUE = {
  "fiscal.drain": { ...stop, failsHealth: true },
  "payments.reconcile": { ...stop, failsHealth: true },
  "card.follow_up": stop,
  "attendance.end_of_day": stop,
  "mail.send": stop,
  "fiscal.certificate_reminders": stop,
  "box.alert_mail": stop,
  "menu.activation": stop,
  "fiscal.tamper_watch": {
    kind: "job",
    stepdown: {
      keepRunning:
        "checks the append-only triggers and, on a mismatch, records a refusal and restarts the box; local, sends nothing outside the box",
    },
  },
  "clock.watch": stop,
  "storage.free_space": {
    kind: "job",
    stepdown: {
      keepRunning:
        "on low space puts back the spare file and deletes old local backup archives; local, sends nothing outside the box",
    },
  },
  "backups.scheduled": {
    kind: "job",
    stepdown: { keepRunning: "stops after the sending loop has finished" },
  },
  "backups.sealed_state": {
    kind: "job",
    stepdown: {
      keepRunning: "waits for a local refresh, which must be awaited at close, not before",
    },
  },
  stream: {
    kind: "service",
    stepdown: { keepRunning: "stops last, after anything that may still write venue.db" },
  },
  "cloud.connection": stop,
  housekeeping: stop,
  "cloud.suggestions": stop,
  "demo.printer": stop,
  "fiscal.reconciliation": stop,
} as const satisfies Record<
  string,
  { readonly kind: "job" | "service"; readonly stepdown: StepdownMark; readonly failsHealth?: true }
>;
export type JobName = keyof typeof JOB_CATALOGUE;
export const JOB_NAMES: readonly JobName[] = Object.keys(JOB_CATALOGUE) as JobName[];
