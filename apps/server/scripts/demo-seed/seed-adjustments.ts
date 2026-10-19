// The owner's example reasons from the service design (§7). They are examples, not a required list,
// so they belong to the demo venue.

import type { Transaction } from "@waitron/db";
import {
  createAdjustmentReason,
  listAdjustmentReasons,
  type AdjustmentReasonInput,
} from "@waitron/adjustments";
import { decimal } from "@waitron/shared";
import type { SeedLocale } from "./menu.js";
import type { DemoDataSet, DemoText } from "./data-set.js";
import type { CasaDelgadoLanguage } from "./data-sets/casa-delgado-es.js";
import { inLanguages } from "./in-languages.js";

export type SeedReason<L extends string = string> = Omit<
  AdjustmentReasonInput,
  "name" | "names"
> & {
  names: DemoText<L>;
};

// A reason sharing a starter reason's English and Spanish names (`ADJUSTMENTS_PROVISIONING`) is
// skipped on a provisioned venue. Void reasons carry no roles (a cancel's rule is the refund
// permission); every Comp reason carries a euro cap.
export const DEMO_ADJUSTMENT_REASONS: readonly SeedReason<CasaDelgadoLanguage>[] = [
  {
    names: {
      en: "Entry error",
      es: "Error al marcar",
      ca: "Error en marcar",
      "ca-ES-valencia": "Error en marcar",
      gl: "Erro ao marcar",
    },
    kind: "void",
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRoles: [],
    approverRoles: [],
    noteRequired: false,
  },
  {
    names: {
      en: "Item not available",
      es: "Producto agotado",
      ca: "Producte no disponible",
      "ca-ES-valencia": "Producte no disponible",
      gl: "Produto non dispoñible",
    },
    kind: "void",
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRoles: [],
    approverRoles: [],
    noteRequired: false,
  },
  {
    names: {
      en: "Customer changed mind",
      es: "Cambio del cliente",
      ca: "Canvi d'opinió",
      "ca-ES-valencia": "Canvi d'opinió",
      gl: "Cambio de opinión",
    },
    kind: "void",
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRoles: [],
    approverRoles: [],
    noteRequired: false,
  },
  {
    names: {
      en: "Not served",
      es: "No servido",
      ca: "No servit",
      "ca-ES-valencia": "No servit",
      gl: "Non servido",
    },
    kind: "void",
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRoles: [],
    approverRoles: [],
    noteRequired: false,
  },
  {
    names: {
      en: "Other",
      es: "Otro motivo",
      ca: "Altre motiu",
      "ca-ES-valencia": "Altre motiu",
      gl: "Outro motivo",
    },
    kind: "void",
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRoles: [],
    approverRoles: [],
    noteRequired: true,
  },
  {
    names: {
      en: "Complaint",
      es: "Queja del cliente",
      ca: "Queixa",
      "ca-ES-valencia": "Queixa",
      gl: "Queixa",
    },
    kind: "comp",
    actions: ["comp", "discount_percent"],
    maxPercentBp: null,
    maxAmount: decimal("30.00"),
    applyRoles: ["supervisor", "manager", "admin"],
    approverRoles: ["manager", "admin"],
    noteRequired: true,
  },
  {
    names: {
      en: "Friends and family",
      es: "Amigos y familia",
      ca: "Amics i família",
      "ca-ES-valencia": "Amics i família",
      gl: "Amigos e familia",
    },
    kind: "comp",
    actions: ["discount_percent"],
    maxPercentBp: 2000,
    maxAmount: decimal("50.00"),
    applyRoles: ["manager", "admin"],
    approverRoles: ["manager", "admin"],
    noteRequired: true,
  },
  {
    names: {
      en: "Employee discount",
      es: "Descuento de empleado",
      ca: "Descompte d'empleat",
      "ca-ES-valencia": "Descompte d'empleat",
      gl: "Desconto de empregado",
    },
    kind: "comp",
    actions: ["discount_percent"],
    maxPercentBp: 3000,
    maxAmount: decimal("20.00"),
    applyRoles: ["supervisor", "manager", "admin"],
    approverRoles: ["manager", "admin"],
    noteRequired: false,
  },
  {
    names: {
      en: "Manager special",
      es: "Invitación del encargado",
      ca: "Invitació de l'encarregat",
      "ca-ES-valencia": "Invitació de l'encarregat",
      gl: "Invitación do encargado",
    },
    kind: "comp",
    actions: ["comp", "discount_percent", "discount_amount"],
    maxPercentBp: 10000,
    maxAmount: decimal("100.00"),
    applyRoles: ["manager", "admin"],
    approverRoles: ["admin"],
    noteRequired: true,
  },
];

export interface SeedAdjustmentReasonsInput {
  locale: SeedLocale;
  dataSet: DemoDataSet;
  /** The venue's content languages; each reason's names are cut to them. */
  languages: readonly string[];
}

/** Creates each example reason not already present under its name in the seed's language. */
export async function seedAdjustmentReasons(
  tx: Transaction,
  { locale, dataSet, languages }: SeedAdjustmentReasonsInput,
): Promise<void> {
  const present = new Set(
    (await listAdjustmentReasons(tx, { includeInactive: true })).map((reason) => reason.name),
  );
  for (const reason of dataSet.adjustmentReasons) {
    const name = reason.names[locale];
    if (present.has(name)) continue;
    await createAdjustmentReason(tx, {
      ...reason,
      names: inLanguages(reason.names, languages),
      name,
    });
  }
}
