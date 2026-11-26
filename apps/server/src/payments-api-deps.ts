import type { KeyRing } from "@waitron/credentials";
import type { Database, DeploymentEnvironment } from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { PinThrottle, Permission } from "@waitron/identity";
import type { CardProviderContribution, PaymentProvider } from "@waitron/payments";
import type { AttendanceRecorder } from "./attendance-capture.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { CardSimulatorSeat } from "./card-simulator.js";
import type { TradingAdmission } from "./trading-admission.js";
import type { OnboardingIntent } from "./trading-config.js";
import type { TradingContext } from "./trading-context.js";

/**
 * The routes never import a provider package. `fetch` is injected by tests; the live host omits it and the seats fall back to the global.
 */
export interface PaymentsApiDeps {
  admission: TradingAdmission;
  paymentsEnabled?: boolean;
  db: Database;
  /** For filing the sale of a stuck payment the provider reports captured. */
  backend: FiscalBackend;
  clock: TrustedClock;
  cfg: TradingContext;
  isPrimary: () => boolean;
  ring: KeyRing;
  environment: DeploymentEnvironment;
  pool: CardProviderPool;
  providers: readonly CardProviderContribution[];
  simulator?: PaymentProvider;
  cardSimulator?: CardSimulatorSeat;
  onboardingIntent?: OnboardingIntent;
  fetch?: typeof fetch;
  /** Injected by tests; production gets one `createPinThrottle()` per mount. */
  pinThrottle?: PinThrottle;
  attendance?: AttendanceRecorder;
  /** The start clock gate, read by `clockStopsRefund` when the dashboard's refund resolutions check
   * again after a provider wait; unset, that check ignores it; a live boot always supplies it. */
  clockUnconfirmed?: () => boolean;
}
export const PAYMENTS_MANAGE: Permission = "hardware.manage";
