import type { CardProviderContribution } from "@waitron/payments";
import { SUMUP_CARD_PROVIDER } from "@waitron/payments-sumup";
import { STRIPE_CARD_PROVIDER } from "@waitron/payments-stripe";

/**
 * Every card-payment provider seat, in composition order. The server twin of `ALL_MODULES`
 * (`packages/composition/src/modules.ts`): the pool (Task 10) and any route that lists providers
 * read this instead of naming a provider package directly. `scripts/module-seams.test.ts` guards
 * that `apps/server/src` reaches a provider package only through this registry or the allowlisted
 * files still migrating behind it.
 */
export const CARD_PROVIDERS: readonly CardProviderContribution[] = [
  SUMUP_CARD_PROVIDER,
  STRIPE_CARD_PROVIDER,
];
