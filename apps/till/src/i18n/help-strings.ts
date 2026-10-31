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
    "Orders still open and not fully paid, in the zones this device serves. Retrieve puts one in the basket to finish it or take payment. Discard deletes it at once, but not while it holds money from a payment, or while a payment or refund is going through. Each order shows how many items it has, then how many are unsent, held, waiting or ready.",
  "help.counter.waiting_orders":
    "Counter orders in the zones this device serves that are not finished: sent but not paid, handed over but not paid, or paid with dishes sent to the kitchen but not yet handed over. Pay takes payment; Hand over, where it shows, records that the customer has taken the order. Each order shows how many items it has, then how many are unsent, held, waiting or ready.",
  "help.counter.guests":
    "Leave it empty for no guests line. With a number, the receipt shows the guests and what each person pays.",
  "help.floor.tables_map":
    "Tap a free table to seat guests, or a table in use to go back to its order. Hold a table and let go to see its details; hold and drag to move it for today. Its details list a service step with Done.",
  "help.floor.tables_map_view":
    "Tap a free table to seat guests, or a table in use to go back to its order. Hold a table and let go to see its details. Its details show a service step.",
  "help.floor.tables_list":
    "Tap a card to seat guests at a free table, or to go back to a table in use. A card marked Needs clearing has its own button; one marked Needs moving does too, if you may change today's floor. A card with a service step has Done, if you may take orders: tap it when the guests want nothing.",
  "help.floor.layout_due":
    "A different plan is due for this zone than the one today's floor was laid out from: the next period's, or one that was changed. Update layout moves the free tables to the new plan now. Tables with guests or still to clear keep their place until they are free, then show Needs moving. Tables taken off today stay off.",
  "help.floor.needs_moving":
    "Nobody can be seated at this table until this is settled. Leave it here keeps the table where it stands until the floor is next laid out, so it can be used straight away.",
  "help.floor.ready_bar":
    "Tables with food ready to take out. Tables in amber, whose food has waited as long as its station's Ready warning time, go before the rest. Tap one to open it; Open opens the first.",
  "help.menu.dishes":
    "Tap a dish to add it. Hold it down, or press Shift+F10 on it, to see its allergens and diet labels first. A search also lists matches on the other menus you can order from.",
  "help.order.send":
    "Fire sends the lines you ticked to the kitchen to be made now, as one group. Send all sends every line: those under Fire now are made at once, and each Group reaches the kitchen held until it is fired. A line that is blocked, no longer offered or still needs a station is not sent. Before sending a dish whose period ended earlier today, the till asks you to check with the kitchen.",
  "help.more.profile":
    "Switches this device to another profile it is approved for. Park or clear the order in progress first.",
  "help.more.settings":
    "Opens this device's equipment and the zones it shows. In the zones, choose which ones appear on this till and which opens first.",
  "help.more.zones":
    "Chooses which of this profile's zones this device shows, and which opens first.",
  "help.more.equipment":
    "Chooses what this device prints receipts, payment slips and invoices on, which card reader it uses and which cash drawer it opens. Pick each from the list; a printer or card reader can also be scanned by its label.",
  "help.more.transfers":
    "Asks another department to take over the current tab, and shows the tabs other departments send you to accept or decline. Your department stays responsible for a tab until the other accepts it. A tab offered to your department, or still yours in the zones this device serves, shows how many items it has, then how many are unsent, held, waiting or ready.",
  "help.more.pass":
    "Opens the pass: the open orders, each with its dishes grouped by course, or by group on a table's bill, and which of them are ready.",
  "help.person.fix_hours":
    "Opens your clock record for today, or for another day or place you choose, to fix a time or add a missing clock-in and clock-out or break. A supervisor, manager or admin other than you approves the change with their PIN; an admin may approve their own.",
  "help.kitchen.card":
    "Each card is a group a table sent, or a counter order, in the column of its least advanced dish; its minutes count from when its first dish was sent to this station to be cooked, or moved here. Tap a dish to move it on one step (on a Whole ticket card, with every dish at its step), or the card's heading to move on the dishes holding it back. Its top edge turns from green to amber, then its whole border red, as the card waits, by the station's late flags. A card with a dashed border is held until a waiter requests cooking.",
  "help.kitchen.cards_part": "Cards",
  "help.kitchen.columns":
    "Tap a column's heading to fold it to a narrow strip, and again to open it. Columns sets the order of the columns and hides the ones you do not need. This device keeps both, for each board.",
  "help.kitchen.notices":
    "Read each change, which names its order, then tap Got it. Got it clears it from every screen at this station; it does not change the card.",
  "help.kitchen.merge":
    "Switches between a board for each station and one board for all of them, where each dish names its station. This device remembers the choice.",
  "help.pass.card":
    "One card per order, its dishes by course, or by group on a table's bill. The minutes count from when the order was opened. The left edge turns blue, then red, as its dishes wait, by their stations' late flags; a dish that waits too long says Forgotten.",
  "help.pass.cards_part": "Order cards",
  "help.pass.ready":
    "Marks every fired dish of this course or group Ready, at every station, not only the ones this screen shows. Held dishes do not change.",
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
    "Pedidos todavía abiertos y sin cobrar del todo, de las zonas que atiende este dispositivo. Recuperar lo pone en la cesta para terminarlo o cobrarlo. Descartar lo borra en el acto, pero no si tiene dinero de un pago, ni mientras hay un pago o una devolución en curso. Cada pedido muestra cuántos artículos tiene y cuántos están sin enviar, en espera, esperando o listos.",
  "help.counter.waiting_orders":
    "Pedidos de barra de las zonas que atiende este dispositivo que no están terminados: enviados sin cobrar, entregados sin cobrar, o cobrados con platos enviados a cocina pero sin entregar. Cobrar cobra el pedido; Entregar, donde aparece, anota que el cliente se lo ha llevado. Cada pedido muestra cuántos artículos tiene y cuántos están sin enviar, en espera, esperando o listos.",
  "help.counter.guests":
    "Déjalo vacío para que no salga la línea de comensales. Con un número, el ticket muestra los comensales y lo que paga cada persona.",
  "help.floor.tables_map":
    "Toca una mesa libre para sentar a los clientes, o una ocupada para volver a su pedido. Mantén pulsada una mesa y suéltala para ver sus detalles; mantenla y arrástrala para moverla hoy. Sus detalles muestran el paso de servicio con Hecho.",
  "help.floor.tables_map_view":
    "Toca una mesa libre para sentar a los clientes, o una ocupada para volver a su pedido. Mantén pulsada una mesa y suéltala para ver sus detalles. Sus detalles muestran el paso de servicio.",
  "help.floor.tables_list":
    "Toca una tarjeta para sentar a los clientes en una mesa libre o volver a una ocupada. Una tarjeta Por recoger tiene su propio botón; una Por mover también, si puedes cambiar la sala de hoy. Una tarjeta con un paso de servicio tiene Hecho, si puedes tomar pedidos: tócalo cuando no quieran nada.",
  "help.floor.layout_due":
    "A esta zona le toca un plano distinto del que se usó para preparar la sala de hoy: el del siguiente periodo, o uno que se ha cambiado. Actualizar plano coloca ya las mesas libres según el plano nuevo. Las mesas con clientes o por recoger se quedan donde están hasta quedar libres, y entonces aparecen Por mover. Las mesas quitadas hoy siguen quitadas.",
  "help.floor.needs_moving":
    "No se puede sentar a nadie en esta mesa hasta resolverlo. Dejar aquí mantiene la mesa donde está hasta la próxima vez que se prepare la sala, y así se puede usar ya.",
  "help.floor.ready_bar":
    "Mesas con comida lista para llevar. Las mesas en ámbar, cuya comida ha esperado tanto como el tiempo de Listo sin recoger de su estación, van antes que las demás. Toca una para abrirla; Abrir abre la primera.",
  "help.menu.dishes":
    "Toca un plato para añadirlo. Mantenlo pulsado, o pulsa Mayús+F10 sobre él, para ver antes sus alérgenos y etiquetas de dieta. Una búsqueda también muestra coincidencias en las otras cartas de las que puedes pedir.",
  "help.order.send":
    "Marchar envía a cocina las líneas marcadas para hacerlas ya, como un grupo. Enviar todo envía todas las líneas: las de Marchar ya se hacen enseguida, y cada Grupo llega a cocina en espera hasta que se marcha. Una línea bloqueada, que ya no se ofrece o que aún necesita estación no se envía. Antes de enviar un plato cuyo periodo ya terminó hoy, la caja te pide que lo consultes con la cocina.",
  "help.more.profile":
    "Cambia este dispositivo a otro perfil para el que está aprobado. Antes, aparca o vacía el pedido en curso.",
  "help.more.settings":
    "Abre el equipo de este dispositivo y las zonas que muestra. En las zonas, elige cuáles aparecen en esta caja y cuál se abre primero.",
  "help.more.zones":
    "Elige qué zonas de este perfil muestra este dispositivo y cuál se abre primero.",
  "help.more.equipment":
    "Elige dónde imprime este dispositivo los tickets, los justificantes de pago y las facturas, qué lector de tarjetas usa y qué cajón abre. Elige cada uno de la lista; una impresora o un lector de tarjetas también se puede escanear por su etiqueta.",
  "help.more.transfers":
    "Pide a otro departamento que se haga cargo de la cuenta actual y muestra las cuentas que otros departamentos te envían para aceptarlas o rechazarlas. Tu departamento sigue siendo responsable hasta que el otro la acepte. Una cuenta que se ofrece a tu departamento, o que sigue siendo de tu departamento en las zonas que atiende este dispositivo, muestra cuántos artículos tiene y cuántos están sin enviar, en espera, esperando o listos.",
  "help.more.pass":
    "Abre el pase: los pedidos abiertos, cada uno con sus platos agrupados por curso, o por grupo en la cuenta de una mesa, y cuáles están listos.",
  "help.person.fix_hours":
    "Abre tu registro de fichajes de hoy, o de otro día o lugar que elijas, para corregir una hora o añadir una entrada y salida o un descanso que faltan. Un supervisor, encargado o administrador que no seas tú aprueba el cambio con su PIN; un administrador puede aprobar el suyo.",
  "help.kitchen.card":
    "Cada tarjeta es un grupo que envió una mesa, o un pedido de mostrador, en la columna de su plato menos avanzado; sus minutos cuentan desde que su primer plato se mandó a preparar a esta estación, o se movió aquí. Toca un plato para avanzarlo un paso (en una tarjeta que dice Toda la comanda, con todos los platos de su paso), o la cabecera de la tarjeta para avanzar los platos que la retienen. Su borde superior pasa de verde a ámbar, y después todo el borde a rojo, mientras la tarjeta espera, según los avisos de demora de la estación. Una tarjeta con el borde discontinuo está en espera hasta que un camarero pida la preparación.",
  "help.kitchen.cards_part": "Tarjetas",
  "help.kitchen.columns":
    "Toca la cabecera de una columna para plegarla en una franja estrecha, y otra vez para abrirla. Columnas ordena las columnas y oculta las que no necesitas. Este dispositivo guarda las dos cosas para cada tablero.",
  "help.kitchen.notices":
    "Lee cada cambio, que nombra su pedido, y toca Entendido. Entendido lo quita de todas las pantallas de esta estación; no cambia la tarjeta.",
  "help.kitchen.merge":
    "Cambia entre un tablero por estación y un solo tablero para todas, donde cada plato indica su estación. Este dispositivo recuerda la elección.",
  "help.pass.card":
    "Una tarjeta por pedido, con sus platos por curso, o por grupo en la cuenta de una mesa. Los minutos cuentan desde que se abrió el pedido. El borde izquierdo pasa a azul y luego a rojo mientras sus platos esperan, según los avisos de demora de sus estaciones; un plato que espera demasiado dice Olvidado.",
  "help.pass.cards_part": "Tarjetas de pedido",
  "help.pass.ready":
    "Marca como listos todos los platos ya marchados de este curso o grupo, en todas las estaciones, no solo las que muestra esta pantalla. Los platos en espera no cambian.",
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
