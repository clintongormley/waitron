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
  "help.floor.tables_map":
    "Tap a free table to seat guests, or a table in use to go back to its order. Hold a table and let go to see its details; hold and drag to move it for today.",
  "help.floor.tables_map_view":
    "Tap a free table to seat guests, or a table in use to go back to its order. Hold a table and let go to see its details.",
  "help.floor.tables_list":
    "Tap a card to seat guests at a free table, or to go back to a table in use. A card marked Needs clearing has its own button; one marked Needs moving does too, if you may change today's floor.",
  "help.floor.layout_due":
    "A different plan is due for this zone than the one today's floor was laid out from: the next period's, or one that was changed. Update layout moves the free tables to the new plan now. Tables with guests or still to clear keep their place until they are free, then show Needs moving. Tables taken off today stay off.",
  "help.floor.needs_moving":
    "Nobody can be seated at this table until this is settled. Leave it here keeps the table where it stands until the floor is next laid out, so it can be used straight away.",
  "help.menu.dishes":
    "Tap a dish to add it. Hold it down, or press Shift+F10 on it, to see its allergens and diet labels first. A search also lists matches on the other menus you can order from.",
  "help.order.send":
    "Fire sends the lines you ticked to the kitchen to be made now, as one group. Send all sends every line: those under Fire now are made at once, and each Group reaches the kitchen held until it is fired. A line that is blocked, no longer offered or still needs a station is not sent.",
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
  "help.floor.tables_map":
    "Toca una mesa libre para sentar a los clientes, o una ocupada para volver a su pedido. Mantén pulsada una mesa y suéltala para ver sus detalles; mantenla y arrástrala para moverla hoy.",
  "help.floor.tables_map_view":
    "Toca una mesa libre para sentar a los clientes, o una ocupada para volver a su pedido. Mantén pulsada una mesa y suéltala para ver sus detalles.",
  "help.floor.tables_list":
    "Toca una tarjeta para sentar a los clientes en una mesa libre o volver a una ocupada. Una tarjeta Por recoger tiene su propio botón; una Por mover también, si puedes cambiar la sala de hoy.",
  "help.floor.layout_due":
    "A esta zona le toca un plano distinto del que se usó para preparar la sala de hoy: el del siguiente periodo, o uno que se ha cambiado. Actualizar plano coloca ya las mesas libres según el plano nuevo. Las mesas con clientes o por recoger se quedan donde están hasta quedar libres, y entonces aparecen Por mover. Las mesas quitadas hoy siguen quitadas.",
  "help.floor.needs_moving":
    "No se puede sentar a nadie en esta mesa hasta resolverlo. Dejar aquí mantiene la mesa donde está hasta la próxima vez que se prepare la sala, y así se puede usar ya.",
  "help.menu.dishes":
    "Toca un plato para añadirlo. Mantenlo pulsado, o pulsa Mayús+F10 sobre él, para ver antes sus alérgenos y etiquetas de dieta. Una búsqueda también muestra coincidencias en las otras cartas de las que puedes pedir.",
  "help.order.send":
    "Marchar envía a cocina las líneas marcadas para hacerlas ya, como un grupo. Enviar todo envía todas las líneas: las de Marchar ya se hacen enseguida, y cada Grupo llega a cocina retenido hasta que se marcha. Una línea bloqueada, que ya no se ofrece o que aún necesita estación no se envía.",
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
