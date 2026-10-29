export type KitchenLanguage = "en" | "es";

const ENGLISH_KITCHEN_WORDS = {
  collectionOrder: "Order",
  forKitchen: "For the kitchen: ",
  changed: "CHANGED",
  cancel: "CANCEL:",
  movedTo: "MOVED TO",
  fromStation: "From",
  withRef: "with {name} from {station}",
  forRef: "for {name} at {station}",
  forNoPreparation: "for {name}, no preparation",
  alsoOnOrder: "Also on this order",
  onHold: "(on hold)",
  noteChanged: "KITCHEN NOTE CHANGED",
  noteRemoved: "KITCHEN NOTE REMOVED",
  noteRemovedBody: "Note for the kitchen removed",
  was: "Was",
  moved: "MOVED",
  order: "Order",
  fromPlace: "From: ",
  toPlace: "To:   ",
  counter: "(counter)",
  reprint: "REPRINT {time}",
  group: "GROUP",
  hold: "HOLD",
  fire: "FIRE",
  void: "VOID",
  recalled: "RECALLED",
  holdChanged: "HOLD CHANGED",
  holdCancelled: "HOLD CANCELLED",
} as const;

export type KitchenTicketWords = { readonly [Key in keyof typeof ENGLISH_KITCHEN_WORDS]: string };

export const KITCHEN_TICKET_WORDS: Readonly<Record<KitchenLanguage, KitchenTicketWords>> = {
  en: ENGLISH_KITCHEN_WORDS,
  es: {
    collectionOrder: "Pedido",
    forKitchen: "Para cocina: ",
    changed: "CAMBIADO",
    cancel: "QUITAR:",
    movedTo: "PASADO A",
    fromStation: "Viene de",
    withRef: "con {name} de {station}",
    forRef: "para {name} en {station}",
    forNoPreparation: "para {name}, sin preparación",
    alsoOnOrder: "También en este pedido",
    onHold: "(en espera)",
    noteChanged: "NOTA PARA COCINA CAMBIADA",
    noteRemoved: "NOTA PARA COCINA ELIMINADA",
    noteRemovedBody: "Nota para cocina eliminada",
    was: "Antes",
    moved: "MOVIDO",
    order: "Pedido",
    fromPlace: "De: ",
    toPlace: "A:  ",
    counter: "(mostrador)",
    reprint: "REIMPRESIÓN {time}",
    group: "GRUPO",
    hold: "EN ESPERA",
    fire: "MARCHAR",
    void: "ANULADO",
    recalled: "RETIRADO",
    holdChanged: "EN ESPERA CAMBIADO",
    holdCancelled: "EN ESPERA CANCELADO",
  },
};

export function kitchenLanguageFor(locale: string): KitchenLanguage {
  return locale.split("-")[0]!.toLowerCase() === "es" ? "es" : "en";
}

export function kitchenTicketWords(locale: string): KitchenTicketWords {
  return KITCHEN_TICKET_WORDS[kitchenLanguageFor(locale)];
}
