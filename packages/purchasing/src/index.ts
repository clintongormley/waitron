export {
  createPurchaseInvoice,
  deletePurchaseInvoice,
  getPurchaseInvoice,
  listPurchaseInvoices,
  updatePurchaseInvoice,
} from "./operations.js";
export type {
  CreatePurchaseInvoiceInput,
  ListPurchaseInvoicesInput,
  PurchaseInvoice,
  PurchaseInvoiceHeaderInput,
  PurchaseInvoiceLine,
  PurchaseInvoiceLineInput,
  PurchaseRegime,
  PurchaseVatKind,
  UpdatePurchaseInvoiceInput,
} from "./types.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
import "./errors.js";
