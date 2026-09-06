import type { FiscalContribution } from "@waitron/fiscal";
import { NoneBackend } from "./backend.js";

/**
 * The no-regime module's fiscal-slot contribution. The sale-path backend records nothing, and
 * `drain` — the submission pass — has no authority to contact, so it returns the empty `DrainResult`
 * (every counter zero, no next due time, nothing skipped) without touching its deps.
 *
 * No `provisioningSecret`: a venue under no fiscal obligation seals nothing at provision time.
 *
 * No provisioning seat either (so this module declares none on its descriptor): `invoice_series` is
 * a core table seeded by the generic venue plan's `create-series` action and, for a standby, carried
 * in the mirror bundle and inserted by `insertReservedSeriesTx` — never by a fiscal module. The
 * standby carrier skips any module without one (`m.provisioning?.standby === undefined) continue`,
 * apps/server/src/reserved-identity.ts), and a no-regime node has no SIF, installation number or
 * hash chain to reserve, so there is nothing disjoint for a `standby` seat to derive.
 */
export const FISCAL_NONE_SLOT: FiscalContribution = {
  id: "none",
  makeBackend: () => new NoneBackend(),
  drain: async () => ({
    nextDueAt: null,
    batchesSent: 0,
    recordsSubmitted: 0,
    recordsAccepted: 0,
    recordsHalted: 0,
    incidentsRaised: 0,
    skipped: [],
  }),
};
