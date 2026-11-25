import type { Database, Transaction } from "@waitron/db";
import type { ReceiptQrText } from "@waitron/fiscal";
import type { Permission } from "@waitron/identity";
import type { SignedMembershipDocument } from "@waitron/membership";
import type { SupportedLocale } from "@waitron/shared";
import type { EnrolRateLimiter } from "./enrol-rate-limit.js";
import type { LiveEvents } from "./live-api.js";
import type { RenderInvoicePage } from "./page-print-api.js";
import type { PageTestPages } from "./page-test-pages.js";
import type { PairingMode } from "./pairing-mode.js";
import type { ReceiptDocumentInput } from "./receipt-facts.js";
import type { LayOutSaleReceipt } from "./receipt-print.js";
import type { TradingContext } from "./trading-context.js";

export interface PrintApiDeps {
  bus?: LiveEvents;
  stopping?: AbortSignal;
  db: Database;
  cfg: TradingContext;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  pairingMode: PairingMode;
  /** Injected by tests over a controllable clock; production gets the default limiter. */
  enrolRateLimiter?: EnrolRateLimiter;
  /** Fallback language for test instructions when neither the user nor the browser has a preference. */
  venueLocale: SupportedLocale;
  /** This node's advertised LAN addresses, for its self-enrolled print agent. */
  listIpv4?: () => string[];
  /** The time a printer's test page shows; tests fix it. */
  now?: () => Date;
  /** The venue fiscal backend's words around a receipt QR; the sample receipt has a QR only with them. */
  receiptQrText?: ReceiptQrText;
  /** The stored invoice an A4 page job prints (`readInvoiceDocument` over the venue's backend). */
  readInvoiceDocument: (tx: Transaction, saleId: string) => Promise<ReceiptDocumentInput>;
  /** A filed sale's receipt laid out for another printer (`layOutSaleReceipt` over the venue's backend). */
  layOutSaleReceipt: LayOutSaleReceipt;
  renderInvoicePage?: RenderInvoicePage;
  /** The office printers' test pages; boot shares its store with the alert sources. */
  testPages?: PageTestPages;
}
export type PrintPermissionGate = <T>(
  sessionId: string,
  fn: (tx: Transaction, personId: string) => Promise<T>,
  permission?: Permission,
) => Promise<T>;
