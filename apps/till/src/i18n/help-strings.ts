// The till's help-mode texts, kept apart from `strings.ts`. English is the source of truth and `helpEs`
// is typed `Record<HelpKey, string>`, so a key added without its Spanish sibling fails typecheck.
import { currentLocale } from "./t.js";

export const helpEn = {
  "help.label": "Help",
  "help.badge_label": "Help: {part}",
  "help.guide_link": "Read more in the guide",
  "help.guide_title": "Guide",
  "help.guide_close": "Close",
  "help.counter.park":
    "Saves this order without taking payment and clears the basket for the next customer. The name is optional. Pick the order up again from Parked orders, on this till or any other that serves its zone.",
  "help.counter.parked_orders":
    "Orders still open and not fully paid, in the zones this device serves. Retrieve puts one in the basket to finish it or take payment. Discard deletes it at once, but not while it holds money from a payment, or while a payment or refund is going through.",
  "help.counter.waiting_orders":
    "Counter orders in the zones this device serves that are not finished: sent but not paid, handed over but not paid, or paid with dishes sent to the kitchen but not yet handed over. Pay takes payment; Hand over, where it shows, records that the customer has taken the order.",
  "help.counter.guests":
    "Leave it empty for no guests line. With a number, the receipt shows the guests and what each person pays.",
  "help.menu.dishes":
    "Tap a dish to add it. Hold it down, or press Shift+F10 on it, to see its allergens and diet labels first. A search also lists matches on the other menus you can order from.",
  "help.more.profile":
    "Switches this device to another profile it is approved for. Park or clear the order in progress first.",
  "help.more.settings":
    "Opens this device's equipment and the zones it shows. In the zones, choose which ones appear on this till and which opens first.",
  "help.more.equipment":
    "Chooses what this device prints receipts, payment slips and invoices on, which card reader it uses and which cash drawer it opens. Pick each from the list; a printer or card reader can also be scanned by its label.",
  "help.more.transfers":
    "Asks another department to take over the current tab, and shows the tabs other departments send you to accept or decline. Your department stays responsible for a tab until the other accepts it.",
  "help.more.pass":
    "Opens the pass: the open orders, each with its dishes grouped by course, or by group on a table's bill, and which of them are ready.",
  "help.person.fix_hours":
    "Opens your clock record for today, or for another day or place you choose, to fix a time or add a missing clock-in and clock-out or break. A supervisor, manager or admin other than you approves the change with their PIN; an admin may approve their own.",
} as const;

export type HelpKey = keyof typeof helpEn;

export const helpEs: Record<HelpKey, string> = {
  "help.label": "Ayuda",
  "help.badge_label": "Ayuda: {part}",
  "help.guide_link": "Más información en la guía",
  "help.guide_title": "Guía",
  "help.guide_close": "Cerrar",
  "help.counter.park":
    "Guarda este pedido sin cobrarlo y vacía la cesta para el siguiente cliente. El nombre es opcional. Recupéralo desde Pedidos aparcados, en esta caja o en cualquier otra que atienda su zona.",
  "help.counter.parked_orders":
    "Pedidos todavía abiertos y sin cobrar del todo, de las zonas que atiende este dispositivo. Recuperar lo pone en la cesta para terminarlo o cobrarlo. Descartar lo borra en el acto, pero no si tiene dinero de un pago, ni mientras hay un pago o una devolución en curso.",
  "help.counter.waiting_orders":
    "Pedidos de barra de las zonas que atiende este dispositivo que no están terminados: enviados sin cobrar, entregados sin cobrar, o cobrados con platos enviados a cocina pero sin entregar. Cobrar cobra el pedido; Entregar, donde aparece, anota que el cliente se lo ha llevado.",
  "help.counter.guests":
    "Déjalo vacío para que no salga la línea de comensales. Con un número, el ticket muestra los comensales y lo que paga cada persona.",
  "help.menu.dishes":
    "Toca un plato para añadirlo. Mantenlo pulsado, o pulsa Mayús+F10 sobre él, para ver antes sus alérgenos y etiquetas de dieta. Una búsqueda también muestra coincidencias en las otras cartas de las que puedes pedir.",
  "help.more.profile":
    "Cambia este dispositivo a otro perfil para el que está aprobado. Antes, aparca o vacía el pedido en curso.",
  "help.more.settings":
    "Abre el equipo de este dispositivo y las zonas que muestra. En las zonas, elige cuáles aparecen en esta caja y cuál se abre primero.",
  "help.more.equipment":
    "Elige dónde imprime este dispositivo los tickets, los justificantes de pago y las facturas, qué lector de tarjetas usa y qué cajón abre. Elige cada uno de la lista; una impresora o un lector de tarjetas también se puede escanear por su etiqueta.",
  "help.more.transfers":
    "Pide a otro departamento que se haga cargo de la cuenta actual y muestra las cuentas que otros departamentos te envían para aceptarlas o rechazarlas. Tu departamento sigue siendo responsable hasta que el otro la acepte.",
  "help.more.pass":
    "Abre el pase: los pedidos abiertos, cada uno con sus platos agrupados por curso, o por grupo en la cuenta de una mesa, y cuáles están listos.",
  "help.person.fix_hours":
    "Abre tu registro de fichajes de hoy, o de otro día o lugar que elijas, para corregir una hora o añadir una entrada y salida o un descanso que faltan. Un supervisor, encargado o administrador que no seas tú aprueba el cambio con su PIN; un administrador puede aprobar el suyo.",
};

const helpCatalogues: Record<string, Partial<Record<HelpKey, string>>> = {
  en: helpEn,
  "en-GB": helpEn,
  es: helpEs,
  "es-ES": helpEs,
};

/** An unknown locale, or one missing the key, degrades to the English text. */
export function helpText(key: HelpKey, locale: string = currentLocale()): string {
  return helpCatalogues[locale]?.[key] ?? helpEn[key];
}

/** The accessible name of a part's badge, with the part's own label in `{part}`. */
export function helpBadgeLabel(part: string): string {
  return helpText("help.badge_label").replace("{part}", () => part);
}
