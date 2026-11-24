import type { Database, Transaction } from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { PinThrottle } from "@waitron/identity";
import type { ModuleTimeRecordExport, FloorAnnotator, TableRemoval } from "@waitron/module";
import type { PaymentProvider, CardProviderContribution } from "@waitron/payments";
import type { AddressLookupAccess } from "./address-lookup-api.js";
import type { AttendanceRecorder } from "./attendance-capture.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { DiskFullState } from "./disk-full-state.js";
import type { LiveEvents } from "./live-api.js";
import type { TillBoxClockDeps } from "./till-box-clock-api.js";
import type { TradingAdmission } from "./trading-admission.js";
import type { OnboardingIntent } from "./trading-config.js";
import type { TradingContext } from "./trading-context.js";

export interface TillApiDeps {
  addressLookup?: AddressLookupAccess;
  cloudEmergency?: () => { address: string } | null;
  paymentsEnabled?: boolean;
  exporter?: ModuleTimeRecordExport;
  admission: TradingAdmission;
  attendance?: AttendanceRecorder;
  liveEvents?: LiveEvents;
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  cfg: TradingContext;
  floorAnnotators?: readonly FloorAnnotator[];
  tableRemovals?: readonly TableRemoval[];
  secureCookies: boolean;
  /**
   * Only ever the practice-mode local simulator; a real card sale routes through {@link pool} by
   * its reader's `provider`.
   */
  cardProvider?: PaymentProvider;
  refundSimulator?: PaymentProvider;
  /**
   * Optional only for suites that never reach the reader-pay path; a live boot always supplies it.
   */
  pool?: CardProviderPool;
  /**
   * Read by the full-disk gate, the reader payments and, through the deps they pass, the cash and
   * manual-card sale, collect and bill-payment routes. Unset, nothing is refused for a full disk; a live boot always
   * supplies it.
   */
  disk?: DiskFullState;
  /**
   * The start clock gate, read by `clockStopsRefund` when the tender refund and bill refund routes
   * check again after a provider wait. Unset, that check ignores the gate; a live boot always
   * supplies it.
   */
  clockUnconfirmed?: () => boolean;
  /**
   * Optional only for suites that never reach the reader-pay path; a live boot always supplies it.
   */
  providers?: readonly CardProviderContribution[];
  devMode?: boolean;
  deviceChooserEnabled?: boolean;
  /** The venue's default UI locale, distinct from its receipt language. */
  venueLocale: string;
  onboardingIntent?: OnboardingIntent;
  /** Injected by tests; production gets one `createPinThrottle()` per mount. */
  pinThrottle?: PinThrottle;
  /** "Check the time": mounts the till's clock check when the seat can confirm a stop. */
  boxClock?: TillBoxClockDeps;
  invoiceEmailAvailable?: (tx: Transaction) => Promise<boolean>;
  testPages?: Pick<import("./page-test-pages.js").PageTestPages, "holdOn">;
  workforceEnabled?: boolean;
  attendanceResponsesEnabled?: boolean;
}
