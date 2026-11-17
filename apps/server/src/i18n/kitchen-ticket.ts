const ENGLISH_KITCHEN_WORDS = {
  collectionOrder: "Order",
  forKitchen: "For the station: ",
  changed: "CHANGED",
  cancel: "CANCEL:",
  movedTo: "MOVED TO",
  fromStation: "From",
  withRef: "with {name} from {station}",
  forRef: "for {name} at {station}",
  forNoPreparation: "for {name}, no preparation",
  alsoOnOrder: "Also on this order",
  onHold: "(on hold)",
  noteChanged: "STATION NOTE CHANGED",
  noteRemoved: "STATION NOTE REMOVED",
  noteRemovedBody: "Note for the station removed",
  was: "Was",
  moved: "MOVED",
  order: "Order",
  orders: "Orders",
  nameChanged: "NAME CHANGED",
  now: "Now",
  unnamed: "(unnamed)",
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
  goesWith: "Goes with {stations}",
  takeAway: "TAKE AWAY",
} as const;

export type KitchenTicketWords = { readonly [Key in keyof typeof ENGLISH_KITCHEN_WORDS]: string };

export const KITCHEN_TICKET_WORDS = {
  en: ENGLISH_KITCHEN_WORDS,
  es: {
    collectionOrder: "Pedido",
    forKitchen: "Para la estación: ",
    changed: "CAMBIADO",
    cancel: "QUITAR:",
    movedTo: "PASADO A",
    fromStation: "Viene de",
    withRef: "con {name} de {station}",
    forRef: "para {name} en {station}",
    forNoPreparation: "para {name}, sin preparación",
    alsoOnOrder: "También en este pedido",
    onHold: "(en espera)",
    noteChanged: "NOTA PARA LA ESTACIÓN CAMBIADA",
    noteRemoved: "NOTA PARA LA ESTACIÓN ELIMINADA",
    noteRemovedBody: "Nota para la estación eliminada",
    was: "Antes",
    moved: "MOVIDO",
    order: "Pedido",
    orders: "Pedidos",
    nameChanged: "NOMBRE CAMBIADO",
    now: "Ahora",
    unnamed: "(sin nombre)",
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
    goesWith: "Sale con {stations}",
    takeAway: "PARA LLEVAR",
  },
} satisfies Readonly<Record<string, KitchenTicketWords>>;

export type KitchenLanguage = keyof typeof KITCHEN_TICKET_WORDS;

export function wordingLanguage<L extends string>(
  available: readonly L[],
  locale: string,
  fallback: L,
): L {
  const parts = locale.toLowerCase().split("-");
  for (let length = parts.length; length > 0; length--) {
    const tag = parts.slice(0, length).join("-");
    const match = available.find((key) => key.toLowerCase() === tag);
    if (match !== undefined) return match;
  }
  return fallback;
}

export function kitchenLanguageFor(locale: string): KitchenLanguage {
  return wordingLanguage(Object.keys(KITCHEN_TICKET_WORDS) as KitchenLanguage[], locale, "en");
}

export function kitchenTicketWords(locale: string): KitchenTicketWords {
  return KITCHEN_TICKET_WORDS[kitchenLanguageFor(locale)];
}
