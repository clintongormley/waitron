import { isValidEmail } from "./email.js";
import { isUuid } from "./ids.js";

export type RoutingOrigin = { applianceId: string; nodeId: string; recoveryEpoch: string };
export type OperationIdentity = { origin: RoutingOrigin; key: string };
export type DocumentChoice = "receipt" | "invoice";
export type Designation = "original" | "duplicate";
export type DeliveryContext =
  | { surface: "till"; deviceId: string; profileId: string }
  | { surface: "dashboard"; deviceId: string | null; profileId: string | null };
type DeliveryFacts = {
  origin: RoutingOrigin;
  applianceId: string;
  saleId: string;
  language: string;
  context: DeliveryContext;
  shownDesignation: Designation;
};
export type PrintIntent = DeliveryFacts & {
  document: DocumentChoice;
  printerId: string;
  replacesAttemptId: string | null;
};
export type EmailIntent = DeliveryFacts & {
  document: "invoice";
  recipient: string;
  retryAttemptId: string | null;
};
export type DeliveryIntent =
  ({ medium: "print" } & PrintIntent) | ({ medium: "email" } & EmailIntent);
export type DeliveryResult = {
  origin: RoutingOrigin;
  requestKey: string;
  saleId: string;
  document: DocumentChoice;
  designation: Designation;
  applianceId: string;
  acceptanceOrder: string;
  printerId: string | null;
  work: { kind: "receipt-job" | "page-job" | "invoice-attempt"; id: string };
  auditId: string | null;
};
export type OperationResult<T> =
  | { state: "prepared" }
  | { state: "accepted"; result: T }
  | { state: "refused" | "fenced"; code: string };
export type InvoiceSave = {
  origin: RoutingOrigin;
  applianceId: string;
  saveId: string;
  deviceId: string;
  expectedRevision: number;
  selection: "default" | { id: string };
};
export type InvoiceSaveResult = {
  origin: RoutingOrigin;
  saveId: string;
  deviceId: string;
  revision: number;
  chosenId: string | null;
  resolvedId: string | null;
};
export type RecoveryResolution = "read" | "fence";
export type DocumentOffers = {
  origin: RoutingOrigin;
  saleId: string;
  invoiceType: "F1" | "F2";
  invoiceNumber: string;
  applianceId: string;
  documents: DocumentChoice[];
  languages: string[];
  language: string;
  context: DeliveryContext;
  designation: Designation;
  printers: { id: string; name: string; kind: "a4" | "receipt" }[];
  chosenPrinterId: string | null;
  defaultPrinterId: string | null;
  invoiceRevision: number | null;
  actions: {
    print: boolean;
    email: boolean;
    replacesAttemptId: string | null;
    retryAttemptId: string | null;
  };
};

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(field);
  return value as Record<string, unknown>;
}
function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw new TypeError(field);
  return value.toLowerCase();
}
function nullableUuid(value: unknown, field: string): string | null {
  return value === null ? null : uuid(value, field);
}
function originOf(value: unknown): RoutingOrigin {
  const body = record(value, "origin");
  return {
    applianceId: uuid(body.applianceId, "origin.applianceId"),
    nodeId: uuid(body.nodeId, "origin.nodeId"),
    recoveryEpoch: uuid(body.recoveryEpoch, "origin.recoveryEpoch"),
  };
}
function choice<const T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new TypeError(field);
  return value as T;
}
function contextOf(value: unknown): DeliveryContext {
  const body = record(value, "context");
  const surface = choice(body.surface, "context.surface", ["till", "dashboard"]);
  if (surface === "till") {
    return {
      surface,
      deviceId: uuid(body.deviceId, "context.deviceId"),
      profileId: uuid(body.profileId, "context.profileId"),
    };
  }
  return {
    surface,
    deviceId: nullableUuid(body.deviceId, "context.deviceId"),
    profileId: nullableUuid(body.profileId, "context.profileId"),
  };
}

export function parseDeliveryIntent(value: unknown): DeliveryIntent {
  const body = record(value, "body");
  const medium = choice(body.medium, "medium", ["print", "email"]);
  const facts: DeliveryFacts = {
    origin: originOf(body.origin),
    applianceId: uuid(body.applianceId, "applianceId"),
    saleId: uuid(body.saleId, "saleId"),
    language: languageOf(body.language),
    context: contextOf(body.context),
    shownDesignation: choice(body.shownDesignation, "shownDesignation", ["original", "duplicate"]),
  };
  if (medium === "print") {
    return {
      medium,
      ...facts,
      document: choice(body.document, "document", ["receipt", "invoice"]),
      printerId: uuid(body.printerId, "printerId"),
      replacesAttemptId: nullableUuid(body.replacesAttemptId, "replacesAttemptId"),
    };
  }
  if (typeof body.recipient !== "string" || !isValidEmail(body.recipient))
    throw new TypeError("recipient");
  return {
    medium,
    ...facts,
    document: choice(body.document, "document", ["invoice"]),
    recipient: body.recipient.trim(),
    retryAttemptId: nullableUuid(body.retryAttemptId, "retryAttemptId"),
  };
}
function languageOf(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError("language");
  return value;
}

export function parseInvoiceSave(value: unknown): InvoiceSave {
  const body = record(value, "body");
  if (
    typeof body.expectedRevision !== "number" ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0
  ) {
    throw new TypeError("expectedRevision");
  }
  return {
    origin: originOf(body.origin),
    applianceId: uuid(body.applianceId, "applianceId"),
    saveId: uuid(body.saveId, "saveId"),
    deviceId: uuid(body.deviceId, "deviceId"),
    expectedRevision: body.expectedRevision,
    selection:
      body.selection === "default"
        ? "default"
        : { id: uuid(record(body.selection, "selection").id, "selection.id") },
  };
}

export function canonicalDeliveryIntent(
  intent: DeliveryIntent,
  resolved: { printerKind: "a4" | "receipt" | null },
): string {
  const normalized = parseDeliveryIntent(intent);
  const kind = resolved.printerKind;
  if (normalized.medium === "email" ? kind !== null : kind !== "a4" && kind !== "receipt") {
    throw new TypeError("printerKind");
  }
  return JSON.stringify({ version: 1, ...normalized, printerKind: kind });
}
