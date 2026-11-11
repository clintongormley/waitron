import type { BoxHostClient, ClockServiceStatus } from "../box-host-client.js";

/** The host's answer for a time service that is on, synchronised or not. */
export function clockServiceAnswer(synchronised: boolean): ClockServiceStatus {
  return { available: true, service: "on", unit: "chrony.service", synchronised, lastSyncAt: null };
}

/** A box host whose time service is synchronised, so a start's time is confirmed by the internet
 * and the start clock gate never holds. It sets nothing. */
export function synchronisedBoxHost(): BoxHostClient {
  return {
    clockStatus: async () => clockServiceAnswer(true),
    setClock: async () => ({ available: false, reason: "missing" }),
  };
}
