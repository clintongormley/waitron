// Makes the block below augment the real "@waitron/shared" module rather than declare a new one.
import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /** No print job carries this id. */
    "print_job.not_found": { id: string };
    /** The job is a drawer command or remains eligible for automatic delivery. */
    "print_job.not_resendable": { id: string };
    /** An unsent drawer command expired; stored in print_jobs.last_error, never retried. */
    "print_job.drawer_expired": Record<string, never>;
    /** A claimed drawer has no reported outcome; repeating its pulse is forbidden. */
    "print_job.drawer_outcome_unknown": Record<string, never>;
    /** No printer carries this id. `id` is the id looked up. */
    "printer.not_found": { id: string };
    /** A transport is missing a connection field it requires. `reason` is a stable English
     * discriminator (e.g. `network_tcp_missing_host`), never a user-facing sentence. */
    "printer.invalid_config": { reason: string };
    /** The device key (USB serial / Bluetooth MAC) already names a printer in this venue. `localKey`
     * is echoed so the dashboard can point at the existing registration. */
    "printer.already_registered": { localKey: string };
    /** An ongoing dashboard alert: `{count}` print jobs are stuck at printer `{printer}` — waiting too
     * long or out of delivery attempts, as `printersInTrouble` (apps/server/src/print-job-trouble.ts)
     * counts them. Not thrown; raised by the printing alert source. */
    "printer.jobs_waiting": { printer: string; count: number };
    /** A queue-only reason: no fresh visible report names this USB/Bluetooth printer. */
    "printer.not_visible": Record<string, never>;
    /** A print job ended because its Bluetooth printer was unpaired; it may already have printed, if
     * the agent had sent it and its report was lost. Not thrown; stored as the job's `last_error` by
     * `endUnpairedPrinterJobs`. */
    "printer.unpaired": Record<string, never>;
    /** A print job ended because its printer was deleted; it may already have printed, if an
     * agent had sent it before the delete. Not thrown; stored as the job's `last_error` by
     * `endDeletedPrinterJobs`. */
    "printer.deleted": Record<string, never>;
    /** A print job ended where it waited because it was reprinted on another printer. Not
     * thrown; stored as the job's `last_error` by `endMovedPrintJob`. */
    "print_job.moved": Record<string, never>;
    /** No print agent carries this id. `id` is the id looked up. */
    "agent.not_found": { id: string };
    /** The bearer token did not verify, or the agent is revoked. */
    "agent.unauthorized": Record<string, never>;
    /** An ongoing dashboard alert: agent `{agent}` has not checked in for several minutes. Not thrown;
     * raised by the printing alert source. */
    "agent.silent": { agent: string };
  }
}
