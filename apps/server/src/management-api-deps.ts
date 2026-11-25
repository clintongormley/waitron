import type { KeyRing } from "@waitron/credentials";
import type { Database, Transaction } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import type { PasswordThrottle } from "@waitron/provisioning";
import type { AccountActionRateLimiter } from "./account-rate-limit.js";
import type { EmailDelivery } from "./email-delivery.js";
import type { GoogleOidcConfig, exchangeGoogleCode } from "./google-oidc.js";
import type { TradingContext } from "./trading-context.js";

/**
 * Everything the dashboard's management HTTP routes need. Unlike `TillApiDeps` it wires no fiscal
 * backend, clock or card provider.
 */
export interface ManagementApiDeps {
  db: Database;
  cfg: { nodeId: string };
  /**
   * The venue config the department receipt settings GET route reads — the same value
   * `mountTillApi` receives. Optional so harnesses that never reach that route can omit it; a
   * request that does reach it without it fails closed (`requireVenueCfg`).
   */
  venueCfg?: TradingContext;
  validateOperationDescription?: (description: string) => void;
  secureCookies: boolean;
  /** The WebAuthn Relying Party ID passkeys are bound to (`config.ts`'s `managementRpId`). */
  rpId: string;
  /** The exact served origin, scheme and port included; a local ceremony's response is checked
   * against what `venuePasskeyOrigins` answers for it. */
  origin: string;
  /** Venue default used when the recipient has not chosen their own UI language. */
  venueLocale?: string;
  accountMailMode?: (tx: Transaction) => Promise<EmailDelivery["mode"] | "cloud">;
  assertAccountMailPrimary?: () => Promise<void>;
  passwordThrottle?: PasswordThrottle;
  accountActionRateLimiters?: {
    passwordReset: AccountActionRateLimiter;
    completion: AccountActionRateLimiter;
  };
  credentialKeyRing: KeyRing;
  googleOidc?: GoogleOidcConfig;
  googleCodeExchange?: typeof exchangeGoogleCode;
  /** Each enabled module's part in removing a live table a floor-plan save deletes. */
  tableRemovals?: readonly TableRemoval[];
}
