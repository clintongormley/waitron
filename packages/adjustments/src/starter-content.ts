import type { StarterContentLanguage, StarterTranslations } from "@waitron/country-packs";

/** The starter void and comp reasons' names in each language a new venue can start with, keyed by
 * the English name `provisioning.ts` seeds. */
export const STARTER_REASON_NAMES = {
  "Entry error": {
    es: "Error al marcar",
    ca: "Error en marcar",
    "ca-ES-valencia": "Error en marcar",
    gl: "Erro ao marcar",
  },
  "Item not available": {
    es: "Producto agotado",
    ca: "Producte no disponible",
    "ca-ES-valencia": "Producte no disponible",
    gl: "Produto non dispoñible",
  },
  "Customer changed mind": {
    es: "Cambio de opinión",
    ca: "Canvi d'opinió",
    "ca-ES-valencia": "Canvi d'opinió",
    gl: "Cambio de opinión",
  },
  "Not served": {
    es: "No servido",
    ca: "No servit",
    "ca-ES-valencia": "No servit",
    gl: "Non servido",
  },
  Other: {
    es: "Otro motivo",
    ca: "Altre motiu",
    "ca-ES-valencia": "Altre motiu",
    gl: "Outro motivo",
  },
  Complaint: { es: "Queja", ca: "Queixa", "ca-ES-valencia": "Queixa", gl: "Queixa" },
  "On the house": {
    es: "Invitación",
    ca: "Invitació",
    "ca-ES-valencia": "Invitació",
    gl: "Invitación",
  },
  "Staff meal": {
    es: "Comida de personal",
    ca: "Àpat del personal",
    "ca-ES-valencia": "Menjar del personal",
    gl: "Comida do persoal",
  },
  Discount: { es: "Descuento", ca: "Descompte", "ca-ES-valencia": "Descompte", gl: "Desconto" },
} as const satisfies StarterTranslations<StarterContentLanguage>;
