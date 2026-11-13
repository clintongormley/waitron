// The till's help-mode texts, kept apart from `strings.ts`. English is the source of truth and `helpEs`
// is typed `Record<HelpKey, string>`, so a key added without its Spanish sibling fails typecheck.
import { currentLocale } from "./t.js";

export const helpEn = {
  "help.label": "Help",
  "help.badge_label": "Help: {part}",
  "help.guide_link": "Read more in the guide",
  "help.guide_title": "Guide",
  "help.guide_close": "Close",
  "help.deferred_close":
    "For a customer who pays the whole bill later, outside Waitron. Confirming closes the bill for good with its invoice, and records no payment. Your accountant gets these bills from Export deferred payments (CSV) on the dashboard's Sales & takings page.",
  "help.payment":
    "Choose an amount, an equal share, items, or the whole amount left. Split equally asks how many people are still to pay. After a part payment, go on to the next guest.",
  "help.counter.park":
    "Saves this order without taking payment and clears the basket for the next customer. The name is optional. Pick the order up again from Parked orders, on this till or any other that serves its zone.",
  "help.counter.parked_orders":
    "Open orders not fully paid, in the zones this device serves. Retrieve puts one in the basket to finish it or take payment; Discard deletes it at once. Each order shows how many items it has, then how many are unsent, held, waiting or ready.",
  "help.counter.waiting_orders":
    "Counter orders in the zones this device serves that are sent but not paid, or paid with dishes still to hand over. Pay takes payment; Hand over records that the customer has taken the order. Each order shows how many items it has, then how many are unsent, held, waiting or ready.",
  "help.counter.guests":
    "Leave it empty for no guests line. With a number, the receipt shows the guests and what each person pays.",
  "help.floor.tables_map":
    "Tap a free table to seat guests, or a table in use to go back to its order. Hold a table and let go to see its details; hold and drag to move it for today. Its details list a service step with Done.",
  "help.floor.tables_map_view":
    "Tap a free table to seat guests, or a table in use to go back to its order. Hold a table and let go to see its details. Its details show a service step.",
  "help.floor.tables_list":
    "Tap a card to seat guests at a free table, or to go back to a table in use. A card marked Needs clearing has a button for that; one marked Needs moving has buttons too, if you may take orders. Tap Done on a service step when the guests want nothing.",
  "help.floor.layout_due":
    "Update layout moves this zone's free tables to the new plan now. Tables with guests or still to clear keep their place until they are free, then show Needs moving. Tables taken off today stay off.",
  "help.floor.needs_moving":
    "Nobody can be seated at this table until this is settled. Leave it here keeps the table where it stands until the floor is next laid out, so it can be used straight away.",
  "help.floor.ready_bar":
    "Tables with food ready to take out. Amber means the food has waited too long, and those tables come first. Tap one to open it; Open opens the first.",
  "help.menu.dishes":
    "Tap a dish to add it. Hold it down, or press Shift+F10 on it, to see its allergens and diet labels first. A search also lists matches on the other menus you can order from.",
  "help.order.send":
    "Fire sends the ticked lines that can go to the kitchen, to be made now, as one group. Send all sends every line that can go: those under Fire now are made at once, and each Group reaches the kitchen held until it is fired.",
  "help.more.profile":
    "Switches this device to another profile it is approved for. Park or clear the order in progress first.",
  "help.more.settings":
    "Opens this device's equipment and the zones it shows. In the zones, choose which ones appear on this till and which opens first.",
  "help.more.zones":
    "Chooses which of this profile's zones this device shows, and which opens first.",
  "help.more.equipment":
    "Chooses what this device prints receipts, payment slips and invoices on, which card reader it uses and which cash drawer it opens. Pick each from the list; a printer or card reader can also be scanned by its label.",
  "help.more.transfers":
    "Asks another department to take over the current tab, and shows the tabs other departments send you to accept or decline. Your department stays responsible for a tab until the other accepts it.",
  "help.more.pass":
    "Opens the pass: a card for each order from a table or the counter, in columns from To fire to Ready.",
  "help.person.fix_hours":
    "Opens your clock record for today, or for another day you choose, to fix a time or add a missing clock-in and clock-out or break. A supervisor, manager or admin other than you approves the change with their PIN; an admin may approve their own.",
  "help.kitchen.card":
    "Each card is an order from a table or the counter. Tap a dish to move it on a step, or the card's heading to move the whole card to the next column. Tap a Ready dish to put it back. On a Whole ticket card, the dishes move together. A dashed card is held: it hasn't been sent to cook yet. Cards turn amber, then red, the longer they wait.",
  "help.kitchen.cards_part": "Cards",
  "help.kitchen.columns":
    "Tap a heading to fold its column. Use Columns to choose which columns show, and in what order.",
  "help.kitchen.notices":
    "Read each change, which names its order, then tap Got it. Got it clears it from every screen at this station; it does not change the card.",
  "help.kitchen.merge":
    "Switches between a board for each station and one board for all of them, where each dish names its station. This device remembers the choice.",
  "help.pass.card":
    "Each card is an order from a table or the counter. Fire, where it shows, sends the card's dishes marked Waiting for the pass to their stations to be cooked. A dashed card is held: the waiter hasn't asked for it yet. A card's left edge changes colour, then turns red, the longer its dishes wait.",
  "help.pass.ready":
    "Marks the food of this course or group ready at every station, including dishes this screen doesn't show. Dishes not yet sent to cook stay as they are.",
} as const;

export type HelpKey = keyof typeof helpEn;

export const helpEs: Record<HelpKey, string> = {
  "help.label": "Ayuda",
  "help.badge_label": "Ayuda: {part}",
  "help.guide_link": "Más información en la guía",
  "help.guide_title": "Guía",
  "help.guide_close": "Cerrar",
  "help.deferred_close":
    "Para un cliente que paga toda la cuenta más tarde, fuera de Waitron. Al confirmar, la cuenta se cierra definitivamente con su factura y no se registra ningún pago. Tu gestor obtiene estas cuentas con Exportar pagos aplazados (CSV), en la página Ventas y recaudación del panel.",
  "help.payment":
    "Elige una cantidad, una parte igual, artículos o todo lo que queda. Dividir a partes iguales pregunta cuántas personas quedan por pagar. Tras un pago parcial, sigue con el siguiente comensal.",
  "help.counter.park":
    "Guarda este pedido sin cobrarlo y vacía la cesta para el siguiente cliente. El nombre es opcional. Recupéralo desde Pedidos aparcados, en esta caja o en cualquier otra que atienda su zona.",
  "help.counter.parked_orders":
    "Pedidos abiertos y sin cobrar del todo, de las zonas que atiende este dispositivo. Recuperar lo pone en la cesta para terminarlo o cobrarlo; Descartar lo borra en el acto. Cada pedido muestra cuántos artículos tiene y cuántos están sin enviar, en espera, esperando o listos.",
  "help.counter.waiting_orders":
    "Pedidos de mostrador de las zonas que atiende este dispositivo enviados sin cobrar, o cobrados con platos aún por entregar. Cobrar cobra el pedido; Entregar anota que el cliente se lo ha llevado. Cada pedido muestra cuántos artículos tiene y cuántos están sin enviar, en espera, esperando o listos.",
  "help.counter.guests":
    "Déjalo vacío para que no salga la línea de comensales. Con un número, el ticket muestra los comensales y lo que paga cada persona.",
  "help.floor.tables_map":
    "Toca una mesa libre para sentar a los clientes, o una ocupada para volver a su pedido. Mantén pulsada una mesa y suéltala para ver sus detalles; mantenla y arrástrala para moverla hoy. Sus detalles muestran el paso de servicio con Hecho.",
  "help.floor.tables_map_view":
    "Toca una mesa libre para sentar a los clientes, o una ocupada para volver a su pedido. Mantén pulsada una mesa y suéltala para ver sus detalles. Sus detalles muestran el paso de servicio.",
  "help.floor.tables_list":
    "Toca una tarjeta para sentar a los clientes en una mesa libre o volver a una ocupada. Una tarjeta Por recoger tiene un botón para ello; una Por mover también tiene botones, si puedes tomar pedidos. Toca Hecho en un paso de servicio cuando los clientes no quieran nada.",
  "help.floor.layout_due":
    "Actualizar plano coloca ya las mesas libres de esta zona según el plano nuevo. Las mesas con clientes o por recoger se quedan donde están hasta quedar libres, y entonces aparecen Por mover. Las mesas quitadas hoy siguen quitadas.",
  "help.floor.needs_moving":
    "No se puede sentar a nadie en esta mesa hasta resolverlo. Dejar aquí mantiene la mesa donde está hasta la próxima vez que se prepare la sala, y así se puede usar ya.",
  "help.floor.ready_bar":
    "Mesas con comida lista para llevar. El ámbar indica que la comida ha esperado demasiado, y esas mesas van primero. Toca una para abrirla; Abrir abre la primera.",
  "help.menu.dishes":
    "Toca un plato para añadirlo. Mantenlo pulsado, o pulsa Mayús+F10 sobre él, para ver antes sus alérgenos y etiquetas de dieta. Una búsqueda también muestra coincidencias en las otras cartas de las que puedes pedir.",
  "help.order.send":
    "Marchar envía a cocina las líneas marcadas que pueden salir, para hacerlas ya, como un grupo. Enviar todo envía todas las líneas que pueden salir: las de Marchar ya se hacen enseguida, y cada Grupo llega a cocina en espera hasta que se marcha.",
  "help.more.profile":
    "Cambia este dispositivo a otro perfil para el que está aprobado. Antes, aparca o vacía el pedido en curso.",
  "help.more.settings":
    "Abre el equipo de este dispositivo y las zonas que muestra. En las zonas, elige cuáles aparecen en esta caja y cuál se abre primero.",
  "help.more.zones":
    "Elige qué zonas de este perfil muestra este dispositivo y cuál se abre primero.",
  "help.more.equipment":
    "Elige dónde imprime este dispositivo los tickets, los justificantes de pago y las facturas, qué lector de tarjetas usa y qué cajón abre. Elige cada uno de la lista; una impresora o un lector de tarjetas también se puede escanear por su etiqueta.",
  "help.more.transfers":
    "Pide a otro departamento que se haga cargo de la cuenta actual y muestra las cuentas que otros departamentos te envían para aceptarlas o rechazarlas. Tu departamento sigue siendo responsable hasta que el otro la acepte.",
  "help.more.pass":
    "Abre el pase: una tarjeta por cada pedido de una mesa o del mostrador, en columnas de Por marchar a Listo.",
  "help.person.fix_hours":
    "Abre tu registro de fichajes de hoy, o de otro día que elijas, para corregir una hora o añadir una entrada y salida o un descanso que faltan. Un supervisor, encargado o administrador que no seas tú aprueba el cambio con su PIN; un administrador puede aprobar el suyo.",
  "help.kitchen.card":
    "Cada tarjeta es un pedido de una mesa o del mostrador. Toca un plato para avanzarlo un paso, o la cabecera de la tarjeta para pasar toda la tarjeta a la siguiente columna. Toca un plato Listo para devolverlo. En una tarjeta de Toda la comanda, los platos avanzan juntos. Una tarjeta con borde discontinuo está en espera: aún no se ha mandado a preparar. Las tarjetas pasan a ámbar y luego a rojo cuanto más esperan.",
  "help.kitchen.cards_part": "Tarjetas",
  "help.kitchen.columns":
    "Toca una cabecera para plegar su columna. Con Columnas eliges qué columnas se ven y en qué orden.",
  "help.kitchen.notices":
    "Lee cada cambio, que nombra su pedido, y toca Entendido. Entendido lo quita de todas las pantallas de esta estación; no cambia la tarjeta.",
  "help.kitchen.merge":
    "Cambia entre un tablero por estación y un solo tablero para todas, donde cada plato indica su estación. Este dispositivo recuerda la elección.",
  "help.pass.card":
    "Cada tarjeta es un pedido de una mesa o del mostrador. Marchar, donde aparece, manda a sus estaciones los platos de la tarjeta que dicen Esperando al pase, para que los preparen. Una tarjeta con borde discontinuo está en espera: el camarero aún no la ha pedido. El borde izquierdo de una tarjeta cambia de color y luego pasa a rojo cuanto más esperan sus platos.",
  "help.pass.ready":
    "Marca como lista la comida de este curso o grupo en todas las estaciones, también los platos que esta pantalla no muestra. Los platos que aún no se han mandado a preparar se quedan como están.",
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
