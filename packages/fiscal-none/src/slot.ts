import { emptyDrainResult, type FiscalContribution } from "@waitron/fiscal";
import { NoneBackend } from "./backend.js";

/**
 * The no-regime module's fiscal-slot contribution. The sale-path backend records nothing, and
 * `drain` — the submission pass — has no authority to contact, so it returns the empty `DrainResult`
 * (every counter zero, no next due time, nothing skipped) without touching its deps. `resetInFlight`
 * does nothing, because nothing here is ever in flight.
 *
 * No `provisioningSecret`: a venue under no fiscal obligation seals nothing at provision time. No
 * `venueFields` either: the legal name, the series codes and the operation description go nowhere
 * near an authority here, so there is no filing format for them to violate and nothing to refuse.
 *
 * No provisioning seat either (so this module declares none on its descriptor): `invoice_series` is
 * a core table, never seeded by a fiscal module; the standby carrier skips any module without one
 * (apps/server/src/reserved-identity.ts); and a no-regime node has no SIF, installation number or
 * hash chain to reserve, so there is nothing disjoint for a `standby` seat to derive.
 */
export const FISCAL_NONE_SLOT: FiscalContribution = {
  id: "none",
  activationReadiness: "not-applicable",
  activationReadinessTarget: () => null,
  makeBackend: () => new NoneBackend(),
  drain: async () => emptyDrainResult(),
  resetInFlight: async () => {},
};
