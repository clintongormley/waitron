// Makes the block below augment the real "@waitron/shared" module rather than declare a new one.
import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /** No print job carries this id. */
    "print_job.not_found": { id: string };
    /** The job is a drawer command or remains eligible for automatic delivery. */
    "print_job.not_resendable": { id: string };
    /** No printer carries this id. `id` is the id looked up. */
    "printer.not_found": { id: string };
    /** A transport is missing a connection field it requires. `reason` is a stable English
     * discriminator (e.g. `network_tcp_missing_host`), never a user-facing sentence. */
    "printer.invalid_config": { reason: string };
    /** The device key (USB serial / Bluetooth MAC) already names a printer in this venue. `localKey`
     * is echoed so the dashboard can point at the existing registration. */
    "printer.already_registered": { localKey: string };
    /** An ongoing dashboard alert: `{count}` print jobs are stuck at printer `{printer}` — waiting too
     * long or out of delivery attempts. Not thrown; raised by the printing alert source. */
    "printer.jobs_waiting": { printer: string; count: number };
    /** No print agent carries this id. `id` is the id looked up. */
    "agent.not_found": { id: string };
    /** The bearer token did not verify, or the agent is revoked. No params, so the failure never
     * discloses which agent ids exist. */
    "agent.unauthorized": Record<string, never>;
    /** An ongoing dashboard alert: agent `{agent}` has not checked in for several minutes. Not thrown;
     * raised by the printing alert source. */
    "agent.silent": { agent: string };
  }
}
