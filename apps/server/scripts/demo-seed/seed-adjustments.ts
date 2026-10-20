// The owner's example reasons from the service design (§7). They are examples, not a required list,
// so they belong to the demo venue.

import type { Transaction } from "@waitron/db";
import {
  createAdjustmentReason,
  listAdjustmentReasons,
  updateAdjustmentReason,
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

/** Creates each example reason not already present. One that matches a reason already present by
 * English name renames that reason into the seed's languages and keeps its rules, because a starter
 * reason's rules win over the demo's. */
export async function seedAdjustmentReasons(
  tx: Transaction,
  { locale, dataSet, languages }: SeedAdjustmentReasonsInput,
): Promise<void> {
  const existing = await listAdjustmentReasons(tx, { includeInactive: true });
  const byEnglish = new Map(existing.map((reason) => [reason.names.en ?? reason.name, reason]));
  for (const reason of dataSet.adjustmentReasons) {
    const names = inLanguages(reason.names, languages);
    const name = reason.names[locale];
    const present = byEnglish.get(reason.names.en);
    if (present === undefined) {
      await createAdjustmentReason(tx, { ...reason, names, name });
      continue;
    }
    await updateAdjustmentReason(tx, present.id, {
      name,
      names,
      kind: present.kind,
      actions: present.actions,
      maxPercentBp: present.maxPercentBp,
      maxAmount: present.maxAmount,
      applyRoles: present.applyRoles,
      approverRoles: present.approverRoles,
      noteRequired: present.noteRequired,
    });
  }
}
