import { SUMUP_PANEL } from "@waitron/payments-sumup/dashboard";
import { STRIPE_PANEL } from "@waitron/payments-stripe/dashboard";
import type { CardProviderPanel } from "@waitron/dashboard-kit";

// The dashboard's card-provider PANEL registry: every payment provider that contributes a UI panel
// names itself here, and the generic Payments screen (Task 15) iterates this list to mount them without
// naming a provider. This is the browser twin of `@waitron/composition`'s `CARD_PROVIDERS` server list;
// the app under apps/dashboard imports neither a provider package nor this list's members directly, only
// this registry. Adding Redsys later is one new package plus one line here.
export const CARD_PROVIDER_PANELS: readonly CardProviderPanel[] = [SUMUP_PANEL, STRIPE_PANEL];
