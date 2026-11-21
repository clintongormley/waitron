# Servicio en mesa

Con el simulador de pagos, los controles de cobro del mostrador y la ventana de pago de
cuentas ofrecen **Aprobar**, **Rechazar** o **Sin respuesta** antes de pulsar **Tarjeta**. No se cobra ninguna tarjeta real. **Sin respuesta**
mantiene el pago bloqueado para que puedas practicar su recuperación. En **Pagos** del panel,
un encargado elige **Consultar al proveedor** y confirma. Así termina el intento de práctica sin
registrar un cobro.

## Invitar o aplicar un descuento {#comps-and-discounts}

Elige un motivo al dejar un artículo gratis o aplicar un descuento. Con **Aplicar invitaciones**,
puedes aplicarlo hasta los límites del motivo y de la cuenta. Si necesitas autorización, elige a
alguien con **Autorizar invitaciones** y pídele que introduzca su PIN. Puede superar esos límites
y aplicar sus propias invitaciones sin el PIN de otra persona. Por defecto, el personal puede aplicar
invitaciones dentro de los límites; supervisores, encargados y administradores pueden autorizarlas.

En **Cancelaciones y descuentos** del panel, indica **0** cuando cada invitación necesite
autorización. Los motivos nuevos empiezan en 0; cambia el importe o bórralo para permitir invitaciones sin límite.
**Queja**, **Invitación** y **Descuento** empiezan en 0; **Comida de
personal** permite hasta un 50% de descuento por artículo antes de pedir autorización.

Si una invitación deja la cuenta a cero, Waitron la cierra y emite la factura en el momento. Entrega esa factura al cliente.

## Repartir una cuenta del mostrador {#counter-part-payments}

Pulsa **Cobrar** para cobrar toda o parte de una cuenta del mostrador. Empiezas con **Toda la cuenta**
seleccionada; también puedes indicar una cantidad, dividir a partes iguales o elegir artículos.
Elige **Efectivo** o **Tarjeta** en cada pago. Después de un pago parcial, comprueba **Queda por pagar**
antes de cobrar el siguiente.

Añade un artículo antes de cobrar o enviar un pedido.

Si se rechaza el cobro en efectivo de un pedido aparcado que has editado, los cambios siguen en
la cesta. Corrige el importe y vuelve a intentarlo, o aparca el pedido para guardar los cambios sin cobrar.

## Usar otro datáfono {#outside-card}

Cobra primero la tarjeta en el otro datáfono. En **Cobrar**, elige **Otro datáfono**. Si tu local
tiene SumUp conectado, **Esta cuenta de SumUp** aparece seleccionada. Elige **Cobrado fuera de
Waitron** si el datáfono utiliza otra cuenta u otro proveedor. Si no hay una conexión con SumUp,
Waitron registra el pago como **Cobrado fuera de Waitron**. Puedes indicar el número de operación
y el nombre del datáfono para identificar el pago más adelante.

Si el local acepta propinas, introduce en **Propina** la que has cobrado en ese datáfono.
La propina que escribas antes de elegir **Otro datáfono** se conserva; comprueba que el total
coincide con el del datáfono.

Registra cada pago cuando lo cobres, mientras Waitron acepte pagos. Si Waitron rechaza un pago,
sigue las indicaciones antes de volver a registrarlo; no cobres dos veces al cliente. Si no tienes
un datáfono de reserva, elige **Efectivo**.

Puedes consultar estos datos en **Ventas y recaudación** al seleccionar un solo día. **Otros terminales**
muestra el estado actual del pago y los reembolsos completados, aunque hayan cambiado después.
**Descargar para tu gestor (XLSX)** incluye una hoja separada de estos pagos, seleccionados por
fecha del calendario y no por el cambio de día de negocio.

En **Comprobar pagos con tarjeta**, dentro de Informes, abre **Comparación de SumUp** para consultar un día natural
en la zona horaria del local. Una coincidencia vincula una anotación de la misma cuenta con un
cargo de SumUp del mismo importe, incluida la propina, con un margen de 30 minutos. Comprueba
los cargos ambiguos o sin coincidencia en SumUp antes de corregir nada. La comparación no envía
devoluciones. Si la comparación está incompleta, vuelve a intentarlo tras la última comprobación,
prevista para la 01:00 UTC después de que termine el día.

Los grupos de devoluciones comparan la consulta guardada de SumUp con tus anotaciones actuales.
Actualiza después de anotar un resultado. Una coincidencia confirmada tiene el mismo identificador
e importe; una coincidencia solo por importe no está verificada, así que compruébala en SumUp antes
de actuar. Compara ambas fechas y la fecha de consulta. Si faltan datos, verás el motivo; la vista
no envía dinero ni anota un resultado. Si faltan la fecha o la referencia, compruébalo en SumUp; las
entradas sin referencia pueden describir la misma devolución. Las devoluciones de otros proveedores o de pagos de reserva
sin vínculo único aparecen por separado. Si devuelves un pago antiguo desde la aplicación de
SumUp, compruébalo también allí: esta vista solo lo encuentra si SumUp lo incluye el día de la
devolución. Ese caso aún no se ha probado con SumUp.

## Elegir documentos después de cobrar {#settlement-document}

Después del último pago, elige **Recibo** o **Factura completa**. Un cambio que deja
la cuenta pagada ofrece la misma elección. Para imprimir, espera a que **Imprimir en {printer}**
nombre el destino y púlsalo. Una factura completa conserva el cliente registrado.

Cuando se ofrece **Enviar por correo electrónico**, puedes enviar un recibo o una factura completa en PDF.
Introduce el correo del cliente y pulsa **Enviar**. Imprimir y enviar por correo son acciones
independientes. Si la caja dice **Compruébalo antes de intentarlo de nuevo**, puede que el documento
ya se haya entregado: pregunta al cliente o mira la impresora antes. Si falla el envío, o el cliente
no lo tiene, pulsa **Volver a enviar el correo** para repetirlo a la misma dirección o elige otra
dirección.

Pulsa **Listo** o cierra la ventana para continuar. Salvo que lo hayas enviado por correo
electrónico, el recibo se imprime al cerrar. Si la impresora está desactivada o no funciona, se
imprime por sí solo cuando vuelva a funcionar; si al día siguiente no se ha impreso, imprímelo desde la
venta. Si el dispositivo no tiene impresora de tickets, elige una o envía el
correo antes de cerrar; si no, se imprime si el dispositivo pasa a tener una en el plazo de un día. Cierras la mesa por separado.
Después de imprimir una cuenta con **Imprimir la cuenta**, la ventana que aparece tras el último
pago ofrece una copia en lugar del original, que se imprimió con la cuenta; imprímela solo si el
cliente pide otro recibo.
Si necesitas un documento más tarde, abre la venta y elige **Imprimir/Reimprimir**.

## Comprobar un pago con tarjeta antes de cancelar {#cancel-pending-card}

Si al cancelar un pedido se indica que hay un pago con tarjeta pendiente, espera a que termine el
datáfono y después pulsa **Cobrar** para comprobar ese pago antes de volver a cancelar. Si ya se
cobró la tarjeta, no pidas al cliente que pague otra vez.

## Emitir una factura completa {#full-invoice}

Cuando un cliente de una mesa necesita una factura a su nombre, elige **Factura completa** para
la cuenta e introduce su identificador, su razón social y su dirección completa antes de imprimir
la cuenta o de su último pago. La elección guardada permite superar el límite de factura simplificada. Al cobrar toda
la cuenta o al imprimirla con **Imprimir la cuenta** se emite la factura; al registrar que se han
ido sin pagar también se emite y queda pendiente de pago. Una cuenta que sigue abierta al terminar
el día de trabajo se emite entonces.

**Factura completa** está en la zona de cobro de la cuenta, debajo del pedido, y en el menú **⋮**,
bajo el nombre de la cuenta; las dos abren el mismo formulario para la cuenta en pantalla. Ninguna
aparece cuando la cuenta ya está pagada o ya se ha emitido su factura. Convertir una cuenta pagada
en factura completa sería corregir una factura ya emitida, y Waitron todavía no ofrece esa
corrección. Cuando ya has elegido un cliente, su nombre y su identificador aparecen debajo de
**Factura completa**, en la zona de cobro. Al juntar cuentas, o al mover todos los platos a otra
cuenta, la caja pregunta antes de cambiar el cliente de una factura completa.

¿Has guardado una factura completa por error? Vuelve a abrir **Factura completa** y elige
**Factura simplificada en su lugar**. Cuando la cuenta ya está impresa o tiene un pago, sigue
siendo factura completa.

En el mostrador, elige **Factura completa** antes de **Cobrar**. Al cobrar todo el pedido se
emite la factura. Tramitar un pedido de mostrador por sí solo no emite una factura.

Para una factura completa nueva, **Entrega** empieza en A4 si tu caja tiene una impresora
de facturas A4. Elige **Impresora de tickets** si necesitas la factura en papel de tickets.

Cuando el formulario muestra **Entrega**, **A4 en {printer}** o **Correo electrónico** envía el
original por sí solo al emitirse la factura. Con **Impresora de tickets**, la factura se imprime al
elegir **Imprimir la cuenta**; si no, se imprime al cerrar la ventana posterior al cobro.
Si el formulario dice que no se ofrece el **Correo electrónico**, añade un correo de contacto en la
pestaña **Recibos** del departamento en **Departamentos y zonas**, en el panel.

Elige **NIF español** para un NIF, NIE o CIF. Para un pasaporte u otro documento aceptado,
elige su **Tipo de identificador**, **País emisor** y **Número de documento**. Introduce el número
tal como aparece. Puedes usar un pasaporte con una dirección española: el país emisor pertenece
al documento, independientemente de dónde viva el cliente. Una factura completa necesita un
identificador. **Cancelar** vuelve sin guardar.

Elige el país de la dirección e introduce la calle y el número y la ciudad. Una dirección
española también necesita un código postal válido de cinco cifras y la provincia; ambos son
opcionales en otros países. Por ejemplo, una dirección francesa puede ser **2 Main Street**,
**París**, **Francia**, sin código postal ni provincia. No añadas el país a la calle. La factura
impresa y el ticket en la pantalla de caja muestran el país en el idioma del ticket. El detalle
del pedido lo muestra en el idioma de tu pantalla.

Cada factura completa muestra el domicilio fiscal de tu negocio. Si es incorrecto o está
incompleto, corrígelo en **Ajustes del local → Datos del local**: elige **Cambiar domicilio
fiscal** en la tarjeta **Negocio**. Si usas **Igual que la dirección del local**, corrige antes la dirección del
local. Las facturas que se emitan después
muestran el nuevo domicilio; las ya emitidas conservan el que tenían al emitirse.

## Elegir un documento y una impresora {#invoice-printer}

Abre una venta en **Buscar cuenta** para revisar su ticket con el formato de papel de 80 mm.
El ticket se muestra en el idioma en que se emitió. Para una copia en papel, elige **Imprimir/Reimprimir**. Para una factura completa, elige
**Recibo** para la versión compacta o **Factura** para el formato de factura. Una factura
simplificada muestra directamente sus impresoras de recibos. Ambas versiones de una factura
completa conservan los datos del cliente registrados.

Elige una impresora de la lista de tu dispositivo. **Usar el predeterminado** sigue la
predeterminada del perfil; otra elección se guarda en **Equipo de este dispositivo**. Si otro
dispositivo lleva la impresora de recibos, Waitron pregunta antes de que te la quedes.

Espera a que **Imprimir en {printer}** o **Imprimir una copia en {printer}** nombre tu destino y
púlsalo. Elegir un documento o una impresora, actualizar la lista y volver atrás no imprime nada.
La copia sigue preguntando el idioma cuando hay más de uno; cancelar no imprime nada. Si la
elección no se ha guardado, pulsa **Reintentar**; usa **Actualizar** si no se ha podido leer la lista.

Para una factura completa antigua sin cuenta, ábrela en **Transacciones** y elige **Factura**.
Usa **Recibo** para una copia compacta cuando se haya completado un original. Si falla la impresión,
comprueba el destino de **Reintentar original** o elige la impresora de recibos indicada en su lugar.

Si el TPV indica que la impresora de oficina se ha quedado sin papel, añade papel y espera la
factura. El aviso puede seguir en la pantalla de inicio de sesión si el TPV se bloquea. Si puede que
la factura se haya impreso, revisa la impresora antes de volver a enviarla.

## Imprimir desde Pedidos del panel {#dashboard-documents}

Para buscar una cuenta anterior, elige **Cualquier fecha** o indica el intervalo de fechas. La búsqueda
abarca todas las cuentas que coincidan, incluidas las de otras páginas. Usa **Página anterior** y
**Página siguiente** para avanzar de 50 en 50. Pulsa **Apertura**, **Factura** o **Total** para ordenar;
pulsa de nuevo el mismo encabezado para invertir el orden. La búsqueda por palabras muestra primero las
coincidencias más cercanas. Vacía **Buscar** para ordenar solo por la columna.

Para obtener un documento más tarde, abre **Pedidos** en el panel y elige **Imprimir / Reimprimir**
en la cuenta. Para una factura completa, elige **Ticket** para papel de tickets o **Factura** para
la lista mixta de impresoras; ambos conservan la factura y el cliente registrados. Una factura
simplificada abre directamente sus impresoras de tickets. Espera a que termine cualquier original
en cola en A4 o por correo antes de elegir Ticket para una factura completa.

Elige la impresora y pulsa **Imprimir en {printer}** o **Imprimir una copia en {printer}**. **A4**
identifica una impresora de oficina. Este navegador recuerda por separado la última impresora que
aceptó un envío para Ticket y Factura. Si ya no está disponible, vuelve a elegir. Al abrir la lista,
si solo hay una impresora disponible, aparece seleccionada. Usa **Actualizar impresoras** si no
aparece ninguna,
o **Cancelar** para salir sin imprimir.

## Justificantes de pago {#reader-slips}

Si quien paga quiere justificante, elige **Imprimir justificante de pago** después de cobrar en
efectivo, con **Otro datáfono** o con lector de tarjetas. Si es un pago parcial, imprímelo desde
la confirmación antes de cobrar el siguiente. Tras el último pago, usa **Documento para el cliente**.
El botón aparece cuando tu dispositivo tiene impresora de justificantes. Si el lector imprime su
propio justificante, el lector se encarga de ese pago. El justificante muestra el
pago y cómo se hizo. Con **Otro datáfono**, incluye el datáfono y el número de operación que indicaste.

Si falla tu solicitud de impresión, puedes pulsar **Imprimir justificante de pago** de nuevo.
Para sustituir un justificante que ya se imprimió, usa
**Reimprimir** en la [Cola de impresión](printers.md#print-queue).

Si un lector de tarjetas imprime su propio justificante de pago, abre **Pagos con tarjeta** en el
panel, edita ese lector y activa **Imprime su propio justificante automáticamente**. Después elige
**Guardar**. Waitron deja los justificantes de ese lector en manos del propio lector. Este ajuste
describe el lector; no cambia la configuración de su impresora. Empieza desactivado en un lector nuevo.

Si añades de nuevo un lector reconocido, conserva tu elección. Consulta [Lectores de tarjetas](printers.md#card-readers)
para eliminar un lector o añadirlo de nuevo. La exportación de configuración incluye la política
de pagos, pero no los lectores ni este ajuste.

## Confía en el servidor antes de abrir la caja {#certificate-trust}

La página de la caja **Este dispositivo todavía no confía en la caja** usa el idioma compatible
preferido de tu navegador; si no encuentra ninguno, usa el inglés. Elige **Abre la página de
configuración para ver las instrucciones** para instalar el certificado del servidor en este
dispositivo y vuelve a abrir la caja.

## Devolver un pago entero o una parte {#refund-payment}

Cuando tengas que devolver un pago de una cuenta, empieza por ese pago para comprobar cuánto queda
disponible para devolver.

En la ventana de pagos de la cuenta, elige **Devolver** junto al pago. La ventana **Devolver un
pago** te pide cuánto se devuelve y por qué. Para **Una parte**, escribe el **Importe a devolver**.
Elige el **Motivo** de la lista. Un motivo que necesita una nota te pide que la escribas, y la nota queda registrada como motivo. Un pago de artículos concretos se devuelve
entero y después esos artículos pueden pagarse de nuevo.

Mientras la cuenta no tenga factura, **Devolver** junto a un pago que tiene su propio ticket abre
**Rectificar factura** en ese ticket.

Elige **Devolver** con el importe mostrado. Si no puedes aprobar devoluciones, un supervisor o
encargado introduce su PIN. En una devolución en efectivo, entrega el dinero al cliente cuando el
resultado te lo indique.

Si un cambio deja la cuenta debiendo menos de lo que ya ha recibido, el mensaje ofrece **Devolver**
con el importe que sobra. Elígelo para abrir los pagos de la cuenta. Si solo se puede devolver un
pago, se abre su ventana de devolución con el importe que sobra seleccionado. Si se pueden
devolver varios pagos, elige cuál quieres devolver. Si no se pueden consultar los pagos, la
ventana explica el problema; ciérrala y vuelve a abrirla antes de elegir un pago.

Si el proveedor de pagos aún no puede hacer la devolución, este intento no ha devuelto dinero.
Puedes cerrar la ventana e iniciar una nueva devolución más tarde.

Cuando termine la devolución, elige **Ver justificante** junto a ella en los pagos de la cuenta.
Después de facturar, puedes abrir la devolución desde **Transacciones** en **Buscar cuenta**.
Elige **Imprimir** para la primera copia. Puedes reimprimirla desde la **Cola de impresión** del panel durante siete días.

## Cancela un plato de una cuenta guardada del mostrador {#counter-cancel-item}

Usa × para quitar un plato que aún no has enviado. En un plato enviado, × y **Cancelar** abren
**Cancelar plato**. Elige cuántos cancelar. Si la preparación ha empezado, elige si conservas o
quitas el cobro y selecciona un motivo. Quitar ese cobro puede requerir el PIN de un supervisor.

**Atrás** deja el plato como está. Tras confirmar, la cesta se actualiza desde la cuenta guardada.
Si eliges **Descartar** en un pedido aparcado con platos enviados, el terminal abre primero ese
pedido. Cancela sus platos enviados antes de descartarlo. Si conservas el cobro de un plato
cancelado, cobra la cuenta.

## Cancelar un plato de una cuenta pagada {#cancel-paid-dish}

Cuando una mesa ha pagado un plato que no va a llegar, cancélalo para que la estación deje de
prepararlo y el cliente pueda recuperar el dinero. Entre los platos enviados de la mesa, elige
**Cancelar…** en el menú **Más** del plato. En una cuenta pagada solo se ofrece para lo que aún no se ha servido.

La ventana **Cancelar plato** indica **Esta cuenta ya está cerrada**. Elige **Cuántos**, hasta los que
aún no se han servido. Si el plato ha pasado a la estación pero nadie lo ha marcado como empezado,
responde a **En preparación**. Después elige un **Motivo**.

Marca **Devolución** para devolver el dinero del plato. Empieza marcada cuando la preparación no ha
empezado y sin marcar cuando sí. El botón principal dice entonces **Cancelar y devolver** con el
importe. Sin la marca dice **Cancelar**, y la cuenta mantiene el cobro. Si no puedes hacer
devoluciones, alguien que pueda introduce su PIN.

La marca solo aparece cuando este dispositivo puede devolver el pago. Si el cliente pagó de una
forma que este dispositivo no acepta, la ventana dice **Devuelve el dinero en una caja: Devolver un
pago, en el recibo.** Después de **Cancelar y devolver**, la devolución del recibo se abre ya
rellenada, como se explica en **Devolver un pago desde el recibo**.

## Cerrar una mesa pagada con platos aún por llegar {#finish-paid-table}

Cuando eliges **Cerrar mesa** y una cuenta pagada aún tiene platos sin servir, una ventana con un
título como **2 platos sin servir** los muestra, y puedes cancelarlos todos o, si alguno tiene ticket de estación, pasar
la comida al mostrador.

Para un plato que ha pasado a la estación pero no está marcado como empezado, responde a **En
preparación**. Para los demás, la ventana muestra la respuesta. Marca **Devolución** junto a cada
plato cuyo dinero se devuelve; un plato empieza marcado cuando la preparación no ha empezado. Un
solo **Motivo** sirve para todos los platos, y empieza en **No servido** si tu local conserva
ese motivo.

Elige **Cancelar y devolver** con el total de los platos marcados, o **Cancelar** si no hay ninguno
marcado. **Atrás** deja la mesa abierta. Si marcas **Devolución** y no puedes hacer devoluciones,
alguien que pueda introduce su PIN. Si un pago se cobró de una forma que este dispositivo no
acepta, la ventana te indica que lo devuelvas en una caja desde el recibo.

Cuando la mesa se cierra, una ventana **Devolución** muestra cada recibo con platos marcados. Elige
uno para abrir su devolución, ya rellenada. Si solo hay un recibo, su devolución se abre
directamente.

Si los clientes van a esperar y recoger la comida en el mostrador, elige **Lo recogerán en el
mostrador**. Aparece cuando al menos uno de los platos tiene ticket de estación. No se cancela ni se
devuelve nada. Los platos en espera pasan ahora a la estación, cada cuenta cuyos platos por llegar
tienen ticket de estación pasa a ser un pedido pagado que espera en el mostrador, y la mesa se
cierra. El pedido espera en **Pedidos pendientes**, en la pantalla **Mostrador**, marcado
**Pagado, sin entregar**, y aparece en **Buscar cuenta**; elige **Entregar** cuando lo recojan.

## Devolver un pago desde el recibo {#refund-receipt}

En un recibo anterior, elige **Devolver un pago**. Elige el **Pago original**, revisa el **Importe
del pago que se devuelve** y la **Propina que se devuelve**, y elige un **Motivo**. Un motivo que
necesita una nota te pide que la escribas. Elige **Devolver**. En efectivo,
entrega el dinero al cliente cuando la devolución se haya hecho.

Después de **Cancelar y devolver**, o de **Cerrar mesa** con platos marcados, la ventana se abre
ya rellenada. El pago queda elegido cuando solo uno se puede devolver en este dispositivo. El
importe es el total de los platos, la propina es 0,00, el motivo es el que diste al cancelar y los
platos aparecen debajo.

No necesitas otro PIN para devolver hasta el valor pendiente de los platos cancelados, sin
propina. Si subes el importe o añades propina, necesitas permiso para devolver o una nueva
aprobación con PIN. La devolución sigue contando para los platos cancelados, hasta su valor.
Una tarjeta registrada desde un datáfono aparte siempre pide un PIN nuevo para confirmar que la
devolución en el datáfono se ha hecho.

Mantén abierta esta ventana de devolución para usar la aprobación de la cancelación. Si la
cierras antes de enviar una devolución y abres otra desde el ticket más tarde, introduce de nuevo
el importe y el motivo y consigue la aprobación si se te pide.

Cuando el pago elegido tiene menos que el total de los platos, el importe es lo que tiene, y una
línea como **Quedan 2,00 € por devolver de otro pago** indica lo que falta. Cuenta desde el
importe de la ventana, así que también aparece, o sube, si bajas el importe. Para devolver el
resto, elige otra vez **Devolver un pago** y escoge un pago. Esa ventana no viene rellenada: escribe tú el
importe y el motivo. Si no puedes hacer devoluciones, pide el PIN, y las entradas de esos platos en
el informe no muestran esa parte. Si ese pago no se puede devolver en este dispositivo, la ventana te indica que lo
devuelvas en una caja.

Si el proveedor de pagos aún no puede hacer la devolución, este intento no ha devuelto dinero.
Puedes cerrar la ventana e iniciar una nueva devolución más tarde.

Para imprimir el justificante de una devolución desde un recibo, búscala en la pestaña
**Transacciones** de **Buscar cuenta** y elige **Imprimir**. Puedes reimprimirlo desde la **Cola
de impresión** del panel durante siete días.

## Rectificar una factura {#correct-invoice}

Cuando a una cuenta pagada se le cobró de más, rectifica su factura: el cliente recibe la
diferencia y Waitron presenta una factura rectificativa por ella. En un recibo anterior, elige
**Rectificar factura**, junto a **Devolver un pago**. La caja no puede rectificar una factura
completa a nombre de un cliente.

Si el cobro de más fue en platos concretos, márcalos en **Platos que se rectifican (opcional)**; si
no, déjalos todos sin marcar. Escribe el **Dinero a devolver, IVA incluido** y revisa el IVA que se
muestra para cada tipo. Elige un **Motivo** y después **Rectificar y devolver**. Si no puedes
rectificar facturas, alguien que pueda introduce su PIN.

Cuando la cuenta se pagó solo en efectivo, se abre el cajón y la factura rectificativa se presenta
en el momento: da al cliente el importe que muestra la ventana. Si no, la ventana muestra lo que
queda por devolver, con un paso de efectivo cuando parte se pagó en efectivo, y un paso **Devolver a
la tarjeta** para cada tarjeta. **Devolver 6,05 € en efectivo** abre el cajón. **Devolver a la
tarjeta** abre **Devolver un pago** ya rellenado para esa tarjeta; devuelve las tarjetas de una en
una. Mientras una devolución a la tarjeta espera la respuesta de la entidad, elige **Volver a
consultar** para ver su respuesta.

Cuando una devolución a la tarjeta termina una rectificación más tarde, su recibo rectificativo no
se imprime solo. Para darlo al cliente, ábrelo en **Buscar cuenta**, en la pestaña
**Transacciones**, donde su tipo es **Rectificación**, e imprímelo desde ahí.

Si cierras la ventana antes de devolver todo el dinero, la rectificación sigue abierta. **Buscar
cuenta** la muestra en **Rectificaciones en curso**; elígela para seguir y después elige una de
estas opciones:

- **Registrar la rectificación** aparece cuando todo está devuelto pero la factura rectificativa no
  se presentó sola; la presenta.
- **Terminar ahora** presenta una factura rectificativa por lo devuelto hasta ahora y no devuelve
  más.
- **Descartar** termina una rectificación que no ha devuelto nada.
- **Cerrar y conservar las devoluciones** la termina sin factura rectificativa, cuando la ventana
  dice que no se puede presentar. El dinero devuelto queda devuelto.

Si la ventana dice que una petición anterior no recibió respuesta, elige **Enviar de nuevo**.

## Devolver una tarjeta en un datáfono aparte {#separate-terminal}

Si el TPV indica que el servidor no tiene espacio en disco, espera a que un encargado resuelva el bloqueo
antes de devolver el dinero en el datáfono: Waitron no puede registrar la devolución mientras dure.

Para un pago con tarjeta registrado desde un datáfono aparte, Waitron te pide que lo devuelvas
primero en ese datáfono. Completa la devolución allí antes de elegir **Devuelto en el datáfono**.
Después, un supervisor o encargado aprueba su registro en Waitron con su PIN.

Si una devolución no recibe respuesta, revisa los pagos de la cuenta antes de intentarla otra vez.
La primera petición puede haberse completado.

## Marcar un paso de servicio como hecho {#service-steps}

Un paso de servicio te recuerda volver a una mesa en el momento adecuado, como **Tomar nota** un par
de minutos después de marcar **Montar mesa** como hecho, o **¿Postre?** cinco minutos después de servir
los Platos principales. Un local nuevo empieza con **Montar mesa**, **Tomar nota**, **¿Postre?** y
**¿Café o la cuenta?**, que vence cinco minutos después de servir los Postres. Si falta cualquiera
de esos cursos iniciales, un departamento nuevo empieza con los dos primeros pasos; añade tus
propias visitas ligadas a cursos en Mesas. Cada paso empieza en un momento así y vence unos minutos después. Tu local los
configura en **Pasos de servicio**, en la pestaña **Mesas** del departamento, en el panel. Allí puedes
leer la comida desde que se sienta el grupo hasta que se va, con sus momentos fijos, pasos y cursos.
Elige **Marchar ya** o **Dejar para después** en cada fila de curso. Un curso retenido ofrece su
propio tiempo de aviso, con **Al momento** y **Deshabilitado**. Pulsa **Guardar** para conservar
estas opciones con los demás ajustes del departamento. Usa **Cursos** para cambiar los nombres
y el orden compartidos.

Elige por nombre cuándo empieza un paso, por ejemplo **Tras Montar mesa**, y ajusta su demora.
La lista lo coloca junto a ese inicio. Cambiar el nombre de otro paso conserva el vínculo;
eliminarlo también quita los pasos que empiezan tras él. Revisa esos pasos antes de guardar.

Cuando vence un paso, la tarjeta de la mesa muestra su nombre, con un botón **Hecho** si puedes
tomar pedidos. En el plano, si no hay nada más urgente, la mesa se vuelve azul con una campana. Los
detalles de la mesa muestran el paso, con **Hecho** si puedes tomar pedidos.
Una mesa muestra un paso cada vez: el último que ha vencido.

Un paso que lleva cinco minutos esperando recibe un contorno ámbar, salvo que tenga prioridad un
aviso más urgente. Abre los detalles de la mesa para leer el paso y su espera; **5′** junto a la
campana del plano significa cinco minutos.

Toca **Hecho** cuando hayas pasado por la mesa y los clientes no quieran nada. Quita el paso que se
ve y cualquier paso anterior que estuviera tapando. Muchas veces no hace falta tocarlo, porque estas
cosas también lo quitan:

- Un pedido enviado después de que venza el paso. También quita un paso anterior que quedara tapado
  detrás.
- El primer pedido de los clientes, que quita todos los pasos que empezaron antes.
- Que los clientes se vayan.

Hasta que se envía el primer pedido, no se muestra ningún paso mientras se toma nota en la mesa.

Un paso ya hecho vuelve cuando ocurre otra vez el momento en que empieza, como cuando se sirven más
platos de un curso. Un paso que se repite cada pocos minutos desde el último pedido vuelve con cada
repetición: **Hecho** quita la que se ve, y otro pedido vuelve a empezar la cuenta.

## Cada plato es su propia línea {#portions}

Cuando tomas un pedido de 2 × Hamburguesa con queso, en una mesa o en el mostrador, la cuenta tiene
dos hamburguesas, cada una con su queso, en lugar de una línea de dos. Así puedes cancelar una hamburguesa, o en una mesa servirla o moverla, y su queso
va con ella, y la cuenta y la estación saben siempre qué hamburguesa es cuál.

Mientras los platos son iguales sigues viendo una sola fila, **2 × Hamburguesa**, en la cuenta y en
**Enviado**. La fila se separa en cuanto un plato cambia, por ejemplo cuando se sirve una hamburguesa
o se le aplica un descuento. Al tocar una fila en **Enviado** se marca entera como servida; **Marcar
servido** en los detalles de la fila pregunta cuántos. [**Mover platos…**](table-service.md#move-dishes) te deja
elegir cuántos platos de una fila pasan a otra cuenta, cada uno con sus extras. **Descuento** y
**Cancelar** actúan sobre la fila y te dejan elegir cuántos de sus platos. **Cambiar plato**, en los
detalles de la fila, cambia todos los platos de la fila y permite aumentar la cantidad.
Para reducirla, usa **Cancelar…**.

Los alérgenos y las etiquetas dietéticas se actualizan desde el producto mientras mantienes el
pedido abierto. No necesitas publicar la carta ni guardar el pedido.

Para consultar los alérgenos y las etiquetas dietéticas de un plato enviado, abre sus detalles y
lee **Registrado al enviar**. Un plato en espera sigue mostrando su declaración actual hasta que
lo liberas.

Un plato al peso es distinto, porque cada uno se pesa por separado: si añades dos veces el mismo
plato al peso tienes dos líneas, no una del doble de peso, y un plato al peso pasa entero a otra
cuenta. En una mesa o en el mostrador puedes añadir hasta 99 unidades de un mismo plato cada vez.

En el mostrador, un pedido que aparcas y vuelves a abrir muestra sus 2 × Hamburguesa como una sola
fila mientras no se haya pagado nada de él.

## Volver a tus mesas con platos sin enviar {#unsent-tables}

En un turno con mucho trabajo es fácil empezar un pedido en una mesa, que te llamen desde otra y
olvidar los platos que no llegaste a enviar. Por eso, en un móvil o una tableta, la barra de arriba
muestra **Sala** y después un botón como **✎ M4**, con el nombre corto de la mesa, por cada mesa
donde tienes platos sin enviar; aunque varias cuentas tuyas tengan platos sin enviar allí, la mesa
tiene un solo botón. Toca un botón para volver a esa mesa. La mesa en la que estás aparece
resaltada. Cuando ya no queda nada tuyo sin enviar en ella, por ejemplo después de enviarlo todo, su
botón sigue resaltado sin el ✎ hasta que sales, y entonces desaparece, mientras que una mesa de la
que sales con platos aún sin enviar conserva su botón con ✎. Si
otra persona se queda con tu cuenta, deja de contar como tuya: al momento en la mesa en la que
estás, y en cualquier otra mesa cuando Sala vuelva a actualizar sus mesas. Cuando hay más botones
de los que caben, **Sala** se queda en su sitio y los botones de las mesas se deslizan de lado junto
a él; un borde difuminado indica que hay más por ese lado.

Con un teclado, Tab lleva al botón seleccionado. Las flechas izquierda y derecha abren la pestaña
anterior o siguiente, pasando de **Sala** a tus mesas y volviendo al principio al llegar al final.
Inicio abre **Sala** y Fin abre la última mesa.

Si tocas **Sala** después de una mesa, se abre la zona de esa mesa, si este dispositivo la muestra.
Todo lo demás está en **Más** (☰): tu nombre, con las acciones de fichaje si fichas en este
dispositivo, cuando no cabe en la barra, lo que en un móvil ocurre siempre; las pantallas que
permite tu perfil; **Zonas en este dispositivo**, **Equipo**, **Idioma**, **Tema** y, si este
dispositivo tiene pantalla táctil y su navegador admite la vibración, **Vibrar al pulsar un
botón**, bajo el título **Ajustes**; **Acerca de Waitron**; **Salir**; y, mientras el local tiene un logotipo, **Con la
tecnología de Waitron** debajo.

## Tomar un pedido en un móvil {#phone-order}

En un móvil, o en cualquier pantalla de mesa de menos de 720 px de ancho, **Carta** y **Pedido**,
arriba, muestran una cosa u otra, y **Pedido** indica cuántos platos hay en tu **Nuevo pedido**,
como **Pedido · 3**. Una mesa se abre en **Carta** hasta que se ha enviado algo de la cuenta en
pantalla, y desde entonces en **Pedido**.

En **Carta**, un número sobre un plato indica cuántos hay de él en tu **Nuevo pedido**. Mientras
tenga algo, una barra abajo dice qué, como **Nuevo pedido · 3 artículos — 2 × Croquetas · 1 ×
Paletilla**: toca **Enviar todo** para enviarlo y ver **Pedido**, o toca el texto para verlo en
**Pedido**.

En un terminal de camarero, **Pedido** mantiene abajo el **Total**, **Pendiente de pago en la
mesa** y **Cobrar**, con **Enviar todo** encima mientras tengas platos por enviar. Después de
enviarlo todo, el terminal de camarero se queda en la mesa hasta que tocas **Sala**. En una
pantalla de 720 px de ancho o más, como la de una tableta, la carta y el pedido aparecen uno junto
al otro.

## Cartas a precio fijo {#set-menus}

Indica cuántas cartas de cada tipo lleva la cuenta. Abre su carpeta desde la cuadrícula
o escribe su nombre en **Buscar** y pulsa el resultado. Después, elige los platos. En la
carpeta puedes ver qué platos están incluidos y cuáles tienen suplemento. Si la comida es
para llevar, elige **Para llevar** en la cuenta antes de añadir una carta a precio fijo.

Abre el resumen en **Pedido** para ver dónde va cada plato y qué sitios quedan libres.
Si un plato no tiene sitio, elige una de las opciones que aparecen o pulsa **Cancelar**
para dejar el pedido como estaba. Desde el resumen puedes mover un plato a otra carta
de la misma cuenta o cancelar una carta vacía.

Para pasar una carta a otra cuenta, abre **Mover platos** y selecciona la carta. Sus
platos se mueven con ella. Si eliges un solo plato, comprueba su precio en la otra
cuenta antes de confirmar.

En el **Mostrador**, elige **Para llevar**, indica cuántas cartas quieres y abre la
carpeta para elegir los platos. Puedes **Aparcar** el pedido antes de añadir los
platos. Para añadirlos después, busca la cuenta en **Pedidos aparcados** y pulsa
**Recuperar**.

## Dar a una mesa un nombre corto {#short-names}

Un móvil o una tableta muestra el nombre corto de una mesa en los botones de mesa de la barra y en
la barra Listo, donde hay poco espacio, y las tarjetas de la [pantalla de
la estación](kitchen-service.md#kitchen-screen) y del [pase](kitchen-service.md#pass-screen) nombran su
mesa por él. En el **Plano de sala** del panel, cada mesa tiene un **Nombre corto** debajo de su
**Nombre**, que se rellena a partir del nombre: «T1» para «Terraza 1», «Ven» para «Ventana», y un
nombre de cuatro caracteres o menos tal cual. Sigue al nombre hasta que escribes uno propio, de
hasta cinco caracteres, que no puede llevar «+» porque la caja lo usa para las mesas unidas. Dos
mesas del local no pueden compartir un nombre corto, aunque cambien las mayúsculas: si Guardar dice
«Terraza 1 ya usa T1», escribe otro, como «Tb1». **Añadir mesas** muestra los nombres cortos que
dará, y deja escribirlos cuando eliges nombres personalizados; **Añadir mesa unida** pide uno.

## Cambiar de cuenta {#bill-switcher}

Si se devolvió parte de un pago antes de registrar su factura, no vuelvas a cobrar.
En **Comprobar pagos con tarjeta**, dentro de Informes, comprueba los importes cobrados, devueltos y aún retenidos. Elige
**Conservar en esta cuenta** para aplicar el dinero restante a la cuenta. Antes de confirmar,
comprueba el importe aplicado, el exceso conservado como propina y lo que aún tienes que cobrar.
Por ejemplo, de 100 € cobrados y 40 € devueltos, puedes conservar 60 € en la cuenta y cobrar solo
lo que falte. Solo puedes conservar un exceso si las propinas están activadas.

Para devolver todo el dinero, devuelve el resto en SumUp y elige **Confirmar devolución completa**
en Waitron. Usa también esta opción si el pago de la cuenta ya figura como fallido. Si SumUp no
puede confirmar los importes, comprueba sus devoluciones e inténtalo de nuevo. Una vez liberado,
vuelve a abrir el pedido para continuar. Revisa los demás
pagos del aviso de devolución compartido antes de marcarlo como atendido; puede que los pagos
posteriores no aparezcan en él.

Es habitual que los clientes paguen por separado: dos parejas en una misma mesa, o alguien que paga
sus propias bebidas. Cada uno tiene entonces su propia cuenta en la mesa. El selector de cuentas,
arriba en la pantalla de la mesa, indica qué cuenta está en pantalla, como **Cuenta 1 · 38,50 €**, o
**Cuenta 2 · 3 cuentas · Clint · 54,00 €** cuando la mesa tiene tres. Aparece aunque la mesa tenga una sola
cuenta, así que una segunda cuenta está siempre a un toque.

En el mostrador, usa **Pedidos aparcados** para recuperar o descartar la cuenta de una mesa.
Descartar su última cuenta deja la mesa ocupada con una cuenta nueva y vacía. Para liberar la mesa,
usa **Cerrar mesa**.

Toca el selector para ver las cuentas de la mesa por orden de número. Cada fila muestra el número y
el nombre de la cuenta, lo que queda por pagar o **Pagada ✓** (**Pago aplazado** si se cerró
como pago aplazado), y una línea como **Ana tiene un
pedido sin enviar: 3 artículos** por cada persona con platos sin enviar en esa cuenta. Cuando otra
cuenta tiene platos tuyos sin enviar, el selector lo indica, como **✎ Cuenta 2 sin enviar**, y la
lista marca esa cuenta con **✎ Sin enviar**. Elige una fila para poner esa cuenta en pantalla. Una cuenta pagada también se abre, para que puedas ponerle
nombre o, si tiene ticket, imprimir una copia, pero no admite platos nuevos. **+ Cuenta nueva** está
siempre al final de la lista: abre una cuenta nueva y vacía en la mesa y la pone en pantalla.

Con el teclado, pulsa Intro para abrir el selector, usa las flechas arriba y abajo para llegar
a una cuenta y pulsa Intro para mostrarla. Inicio y Fin llevan a la primera y la última opción.
Escape cierra la lista.

Todo lo demás que haces en la mesa está en el menú **⋮**, junto al selector, en dos partes. La
primera, con el nombre de la cuenta en pantalla como título, por ejemplo **Cuenta 2 · Clint**, actúa
solo sobre esa cuenta: **Poner nombre a esta cuenta**, **Mover platos…**, **Juntar cuentas**,
**Mover esta cuenta**, **Descuento en la cuenta**, **Registrar salida sin pagar**, **Factura
completa**, **Imprimir la cuenta**, **Copia del ticket**, **Cancelar y abonar** y **Reabrir para
dividir**, cada una cuando corresponde. La segunda, **Toda la mesa**, actúa sobre todos los de la mesa:
**Alergias**, **Poner nombre a los clientes**, **Comensales**, **Marcar cuenta pedida para …** con
el nombre del grupo (una vez pedida, **Anular la petición de cuenta de …**), **Separar una mesa**
(cuando el grupo ocupa más de una mesa), **Unir una mesa**, **Mover clientes** y **Cerrar mesa**.
Una acción que necesita una elección, como con qué cuenta juntar, se abre junto al pedido, y
**Atrás** la cierra.

Unir una mesa, o mover clientes a otra, conserva todas las cuentas: las que llegan toman los
siguientes números del grupo que las recibe. Para juntar dos cuentas, abre la cuenta que debe
recibir la otra y elige **Juntar cuentas**. La cuenta que recibe puede tener un pago parcial;
la que añades no puede tener pagos. Si la cuenta que añades tiene factura completa a nombre de un
cliente que no figura en la cuenta que recibe, la caja pregunta antes: elige a qué cliente se
factura la cuenta juntada, o **No juntar**. Si mueves la última cuenta de la mesa, la caja sigue en
la mesa con una cuenta nueva y vacía.

Si otra caja junta la cuenta que tienes en pantalla con otra, o la mueve a otra mesa, tu pantalla
pasa a otra de las cuentas de la mesa y lo indica, por
ejemplo **Cuenta 2 ya no está en esta mesa. Ahora se muestra Cuenta 1.** Los platos que habías
añadido a la cuenta que se fue y no habías enviado no pasan a la cuenta que ahora se muestra:
aparecen bajo **Tus cambios no se han guardado.**, con **Descartar cambios** y **Actualizar el
pedido**. Una cuenta cobrada en otra caja sigue en tu pantalla, marcada como **Pagada**.

Debajo del pedido, el pie muestra el **Total** de esta cuenta, después **Pendiente de pago en la
mesa** para todas las cuentas, y **Cobrar**. La elección de **Factura completa** y el idioma del
ticket aparecen a su lado cuando se ofrecen. Una cuenta cobrada en parte cuya factura aún no se ha
emitido también muestra cuánto se ha recibido y cuánto queda. El pie no tiene **Aparcar**: la
cuenta ya espera en su mesa. En un terminal de camarero, si se cobra una cuenta con factura simplificada y quedan otras,
**Volver a la mesa** abre la primera cuenta pendiente.

Waitron no cobra una cuenta con platos sin enviar. Mientras la cuenta en pantalla tiene platos en tu
**Nuevo pedido**, o se muestran platos sin enviar de otra persona para ella con su botón
**Tomar el pedido**, los botones que empiezan un cobro se ven apagados. Aun así responden: un toque
no empieza ningún cobro y explica por qué, por ejemplo **Cuenta 1. Envía o quita los platos sin
enviar antes de cobrar.** Envía o quita tus propios platos. Para los de otra persona, toca primero
**Tomar el pedido** y después envíalos o quítalos. Los platos sin enviar de otra cuenta de la mesa
no frenan esta. Si se envió un cobro de esta cuenta y su resultado no se ha confirmado, **Cobrar**
sigue abriéndolo, para que puedas saber si se
completó; esa ventana no acepta un cobro nuevo mientras haya platos sin enviar.

Si eliges **Cerrar mesa** con una cuenta aún sin pagar, la caja indica **Hay una cuenta de esta mesa
sin pagar. Cóbrala antes de cerrar la mesa** encima del pie. **Cobrar esta cuenta** pone en pantalla
una cuenta sin pagar para que la cobres. **Imprimir la cuenta**, cuando aparece, pone esa cuenta
en pantalla y la imprime, o muestra los platos aún sin servir.

Si un cliente se va sin pagar, selecciona su cuenta, abre **⋮** y elige **Registrar salida sin
pagar** bajo esa cuenta. Comprueba el importe e indica el motivo. Si hace falta autorización,
elige un responsable o encargado y pídele que introduzca su PIN.

Solo se detiene la comida pendiente de servir de esa cuenta, con tickets de cancelación para la
estación. Las demás cuentas conservan su comida, así que puedes servir el postre de quien ya ha
pagado. Se registra como pendiente lo que aún se debe de la cuenta; lo ya pagado se conserva. Cuando
el cliente vuelva a pagar, abre la cuenta desde **Buscar cuenta** y cobra allí lo que falta. La
mesa sigue abierta mientras quede otra cuenta por cerrar o comida pagada por servir. Sirve lo que
queda y elige **Cerrar mesa** cuando todos hayan terminado.

Una cuenta que sigue abierta al terminar el día de trabajo recibe entonces su ticket, sin
imprimirlo. Cóbrala con **Cobrar** o registra una salida sin pagar. Una cuenta con platos en espera
o sin enviar sigue abierta. Una cuenta con una rectificación abierta de un pago que tiene su propio
ticket sigue abierta hasta que esa rectificación se termine o se descarte.

Si la cuenta se emitió al terminar el día de trabajo, selecciona el día en que se abrió en
**Ventas y recaudación**. Para los impuestos, consulta [Modelo 303 (IVA)](invoices.md#vat-return). Las fechas registradas
en las facturas pueden situar la cuenta en otro período.

Si un cobro consta como no cobrado, puedes volver a cobrarlo. Si su resultado no se ha confirmado,
elige **Comprobar de nuevo** para continuar ese mismo cobro antes de cobrar otro. Si no estaba
registrado, puede cobrar la tarjeta o registrar el efectivo.
Si un pago sigue pendiente, o la tarjeta ya se ha cobrado pero el pago no se ha registrado, elige
**Comprobar pagos con tarjeta / acceder**. No vuelvas a cobrar una tarjeta ya cobrada. Inicia sesión para
consultar o registrar el resultado confirmado por el proveedor en **Pagos de cuentas**. Después
de registrarlo, vuelve a abrir la cuenta y cobra solo su saldo pendiente.

Si falla esa comprobación, sigue [Falló la comprobación de un cobro con tarjeta](table-service.md#card-check-failed).

Si el lector ha cobrado otro importe, compara en el aviso lo que se pidió y lo que se cobró.
Comprueba el saldo de la cuenta antes de cobrar otro pago, para cobrar solo lo que quede pendiente.

## Imprimir la cuenta {#print-bill}

Cuando los clientes pidan la cuenta, ponla en pantalla, abre **⋮** y elige **Imprimir la cuenta**.
Su ticket se emite en ese momento y se imprime en la impresora de tickets de este dispositivo, y la
caja indica **Cuenta emitida**. Una factura completa preparada para A4 o correo electrónico va allí.
Cada cuenta de la mesa se imprime por separado, así que los clientes de otra cuenta pueden seguir
comiendo.

Elige **Factura completa** antes de imprimir: una vez impresa la cuenta, su tipo de factura no puede
cambiar.

Primero envía o quita los platos que aún no se han enviado. Si hay platos de la cuenta sin marcar
como servidos, todavía no se imprime nada: la caja los muestra bajo **Aún sin servir:**. Si los
clientes ya los han tomado, elige **Marcar como servidos** donde aparezca y vuelve a elegir
**Imprimir la cuenta**. Si no, elige **Imprimir igualmente**: un plato que al final no llegue se devuelve después
del cobro con [Rectificar una factura](table-service.md#correct-invoice). La caja no puede rectificar una factura completa a nombre de
un cliente, así que en esas cuentas quita antes de imprimir los platos que puedan no llegar.

Una cuenta impresa no admite más platos. Si los clientes piden algo más, ponlo en **+ Cuenta
nueva**.

Si después los clientes quieren pagar por separado, abre **⋮** y elige **Reabrir para dividir**. El
ticket se abona y sus platos pasan a una cuenta nueva, listos para [**Mover platos…**](table-service.md#move-dishes).
Una vez pagada una parte, ya no se puede dividir así: los demás clientes pagan el resto con
**Cobrar**.

Cuando un cliente ya ha pagado una parte de la cuenta con
[un ticket propio](table-service.md#pay-window), la cuenta muestra los platos y después descuenta
ese pago con el número de su ticket, su fecha y su importe.

Cobra con **Cobrar** como siempre, de una vez o por partes.

## Falló la comprobación de un cobro con tarjeta {#card-check-failed}

Para un pago que aparezca en **Pagos de cuentas y devoluciones pendientes del proveedor
de tarjetas**, elige **Consultar al proveedor** allí. Una vez registrado, vuelve a abrir la cuenta
para ver cuánto queda por pagar. Waitron también reintenta estos pagos automáticamente. Si el
registro sigue fallando, conserva los datos del pedido y del cobro y no vuelvas a cobrar; es un
fallo de Waitron o de este servidor.

## Mover platos a otra cuenta {#move-dishes}

Cuando un cliente decide pagar sus propias bebidas, pasa esos platos a una cuenta suya. Abre el menú
**⋮** y elige **Mover platos…**. Está disponible en una cuenta de mesa que sigue abierta, aunque
parte de ella ya esté pagada.

El panel, con la cuenta como título, por ejemplo **Mover platos de Cuenta 1**, muestra los platos
de la cuenta, cada uno con sus extras bajo el nombre, y un plato al peso con su peso, por ejemplo
**Jamón ibérico ×0,32**. Marca un plato para moverlo; sus extras van con él. Los platos iguales comparten una
fila, por ejemplo **Caña** con un **4** al lado: al marcar la fila se toman todos, o tantos como permitan los pagos de la cuenta, y **−** y **+**
fijan después cuántos, como **2 de 4**, con el importe de los que se mueven. Un plato al peso solo tiene la casilla, porque pasa entero.

Algunas casillas salen en gris, con el motivo debajo del plato:

- **Tiene un pago**: el plato tiene un pago en curso o recibido, así que se queda en esta cuenta.
  Espera a que termine un pago en curso; devuelve un pago recibido antes de mover su plato.
- **Los pagos retienen 40,00 € en esta cuenta: mueve menos platos**: elige menos platos para que
  la cuenta conserve lo necesario para sus pagos, incluidos los que siguen en curso. Los demás
  platos sí pueden pasar.

En **Mover a**, elige adónde van los platos: otra de las cuentas abiertas de la mesa, o **+ Cuenta
nueva**. Una cuenta que ya ha recibido un pago simplemente debe más después. **Mover** sigue apagado hasta que marques un plato y elijas adónde va.
Después de moverlos, una cuenta nueva se pone en pantalla; si los pasas a otra cuenta, esta sigue en
pantalla. Cada plato conserva su curso y sigue enviado, marchado o servido como estaba. Si mueves
los últimos platos sin pagar de una cuenta pagada en parte, la cuenta queda pagada del todo y se
emite su factura.

Si una cuenta está a nombre de un cliente para factura completa y mueves todos sus platos a una
cuenta que no nombra al mismo cliente, la caja pregunta antes: elige el cliente al que se facturan
los platos, o **No mover**.

Si alguien paga un plato en otra caja mientras el panel está abierto, su fila pasa a **Tiene un pago**
cuando la caja vuelve a leer la cuenta, y ese plato deja de estar entre los que elegiste. Si tocas
**Mover** antes, la caja rechaza el cambio con el motivo, por ejemplo **Este artículo ya está
pagado, así que no se puede cambiar, mover ni cobrar otra vez. Devuelve antes su pago**, y no se
mueve nada. Si el cambio dejara la cuenta por debajo de lo que ya se ha pagado, la caja dice cuánto
y ofrece un botón **Devolver** por ese importe. Si se rechaza el cambio porque la cuenta que
elegiste tiene un cobro o una devolución con tarjeta en curso, o porque entretanto se ha presentado
o pagado, la caja nombra esa cuenta antes del motivo, por ejemplo **Cuenta 2: Esta cuenta ya está
cerrada**. Si otra persona tiene platos sin enviar en alguna de las dos cuentas, toma antes su
pedido. Abre otra vez **Mover platos…** para elegir de nuevo.

## Separar una mesa {#split-table}

Cuando parte de un grupo pasa a una mesa propia, abre el menú **⋮**, elige **Separar una mesa** y toca
la mesa que se separa. Marca lo que se lleva: cuentas enteras o platos sueltos de cualquier cuenta.
Indica los comensales de cada mesa y elige **Separar**.

## Mover una cuenta o separar una mesa con platos en espera {#held-dishes-move}

Una cuenta con platos en espera puede pasar a otra mesa con **Mover esta cuenta** o **Separar una
mesa**. Allí los platos siguen en espera. Después cada mesa marcha su propio grupo: marchar uno no envía
ningún plato de la otra mesa.

## Traspasar una cuenta de Mostrador a otro departamento {#department-transfers}

Abre una cuenta guardada en **Mostrador** y elige **Traspasos** en la barra superior del TPV, o en
**Más** en un dispositivo de mano. Elige **Solicitar traspaso**, selecciona el **Departamento de
destino** y pulsa **Guardar**. Tu departamento sigue
siendo responsable hasta que el mostrador receptor acepte. Mientras la solicitud esté pendiente,
puedes elegir **Retirar solicitud**.

Para recibir una cuenta, abre **Traspasos** y elige **Ver cuenta actual** junto a la solicitud
entrante. Revisa **Productos pedidos** y **Trabajo pendiente en la estación** antes de elegir **Aceptar
traspaso**. Elige la **Zona de destino** y, si hace falta, una **Mesa de destino**, y pulsa
**Guardar**. Para rechazarla, elige **Rechazar traspaso**, introduce el **Motivo del rechazo**
y pulsa **Guardar**.

## Vender para tomar aquí o para llevar {#eat-here-or-take-away}

Donde la comida para llevar paga otro IVA, la pestaña **Servicio** de un departamento en el panel
pregunta **Cómo se vende**: **Para tomar aquí**, **Para llevar** o **Se elige en la caja**. Con
**Se elige en la caja**, el personal lo elige en cada pedido, y **Empieza como** fija cómo empieza
un pedido de mostrador; un pedido en mesa empieza para tomar aquí. Los pedidos ya abiertos siguen
como estaban cuando cambias esto.

En la caja, toca **Para tomar aquí** o **Para llevar** sobre el pedido antes de enviarlo a cocina
o de cobrarlo; después, el pedido se queda como está.

## Poner nombre a una cuenta {#bill-names}

Las cuentas de unos clientes van numeradas, y la caja muestra cada una con su número y el nombre que
le pongas, como **Cuenta 2 · Clint**, y en algunos sitios con el nombre de los clientes delante,
como **4 · Cuenta 2 · Clint**. Para poner nombre a la cuenta en pantalla, por ejemplo el del cliente
que la paga, abre el menú **⋮**, elige **Poner nombre a esta cuenta**, escribe hasta 40 caracteres y
elige **Guardar**. Vacía el campo para quitar el nombre. **Poner nombre a los clientes**, en **Toda
la mesa** del mismo menú, pone nombre a todo el grupo. Si otra persona tiene platos sin enviar en la
cuenta, toma primero su pedido.

Para cambiar el nombre que ve la estación, usa **Poner nombre a los clientes**. Si queda trabajo
pendiente en la estación, sus impresoras reciben un [ticket de cambio de nombre](kitchen-service.md#party-names).

Una cuenta conserva su número mientras sigue con esos clientes. Juntar una cuenta con otra deja un
hueco: junta la Cuenta 2 con la Cuenta 1 y quedan las Cuentas 1 y 3. Una cuenta que llega de otra
mesa o del mostrador toma el siguiente número de los clientes, y también las cuentas de una mesa que
unes. Una mesa que separas con cuentas vuelve a empezar por la Cuenta 1, igual que una mesa que
se vuelve a ocupar cuando sus clientes terminan. Una cuenta conserva su nombre cuando se mueve,
también al mostrador, donde no tiene número. Solo puedes poner nombre a una cuenta en una mesa. El
nombre no se imprime en los tickets de estación ni en los recibos.

## Ver qué mesas tienen comida lista {#ready-bar}

Cuando la estación tiene platos listos, quieres saber a qué mesas llevarlos sin tener que ir a mirar.
En un móvil o una tableta, una barra al pie de **Sala** muestra cada mesa con comida lista y cuántos
platos esperan, por ejemplo **Listo · M2 · 3**. Cada mesa aparece con su nombre corto, por ejemplo
M2 para Mesa 2, o con su nombre completo mientras no tenga uno; una mesa unida a otra hoy muestra
las dos, por ejemplo M4+M5. Mientras ninguna comida haya esperado demasiado, primero aparece la
mesa cuya comida lleva más tiempo esperando.

La comida que se queda en el pase se enfría, así que la barra te avisa cuando un plato ha esperado
demasiado. Cuando un plato listo ha esperado tanto como el tiempo de **Listo sin recoger** de su
estación (3 minutos si no lo cambias
[en **Estaciones de preparación**](kitchen-service.md#service-lifetime)), la barra se vuelve ámbar,
su borde late despacio y dice cuánto ha esperado la comida de la primera mesa, por ejemplo **Listo
4 min · M5 · 2 · M9 · 1**. Cada estación se juzga por su propio tiempo, así que una ensalada de una
estación de 6 minutos y un plato de la parrilla de una de 3 avisan en momentos distintos. Las mesas
cuya comida ha esperado ese tiempo van primero, en ámbar, y los minutos siguen contando mientras
miras. En un dispositivo configurado para reducir el movimiento, la barra sigue en ámbar sin latir.
Toca una mesa para abrirla, o toca **Abrir ›** para abrir la primera de la lista. Si hay más
mesas de las que caben, desliza la lista hacia un lado; un borde difuminado indica que hay más por
ese lado.

La barra muestra solo las mesas de las zonas que enseña este dispositivo, y desaparece
cuando no queda nada listo. Una caja muestra en cambio una lista **Listo** encima de las mesas, con
una línea por cada estación. La lista cuenta la comida lista de las mesas de todas las zonas que
permite su perfil, no solo de las que enseña.

## Ver una zona como mapa o lista {#floor-view}

Toca **Lista** o **Mapa** para cambiar cómo muestra sus mesas la zona que tienes en pantalla. En un
móvil, el cambio está en el menú ⋮ de la zona. El dispositivo guarda tu elección para cada zona, así
que la zona se abre igual la próxima vez, y cambiar una zona no cambia las demás. Una zona que no
has cambiado se abre como mapa cuando tiene mesas colocadas en su plano, y como lista cuando no
tiene ninguna.

## Unir y separar mesas {#join-tables}

Una mesa unida guardada empieza como sus mesas reales juntas en un grupo con nombre. Para añadir una mesa, abre sus detalles en el mapa y elige **Unir con…**. Para separar mesas, abre el grupo, elige **Separar mesas…**, marca las mesas que quieres sacar y confirma **Separar**. Usa **Unir con…** para volver a añadir una mesa al grupo.

## Restablecer una zona al plano de hoy {#zone-reset}

Para deshacer los cambios de hoy en una zona, abre su menú ⋮, elige **Volver al plano …** con el nombre del plano que aparece y confirma **Restablecer**.

Después de restablecer la zona, coloca las mesas libres como aparecen en el mapa.

Deja las mesas con comida en camino donde están hasta que entregues el pedido. Si hoy has separado
un grupo, termina cualquier pedido abierto en una mesa separada antes de volver a unir el grupo.
Cuando una mesa indique **Por mover**, muévela y elige **Marcar movida**.

## Elegir el equipo de este dispositivo {#equipment}

En un TPV, elige **Más**, **Ajustes** y **Equipo**. En un dispositivo de mano, elige **Más**
y **Equipo**. En cada lista disponible, elige el equipo que quieres usar en este dispositivo,
o **Usar el predeterminado** para seguir la elección de su perfil.

Si el lector del perfil indica **Disponible para elegir**, selecciona **Usar el predeterminado**
en el dispositivo con el que vas a cobrar. Si otro dispositivo tiene el lector, en **Equipo**
verás cuál es.

Cuando aparezca **Escanear** para una impresora de tickets, una impresora de justificantes de pago
o un lector de tarjetas, usa su etiqueta de Waitron en lugar de la lista. Si eliges de la lista un
equipo que lleva otro dispositivo, confirma **Quitárselo**; al escanear lo tomas sin confirmación,
así que comprueba qué equipo estás escaneando.

## Cambiar el perfil de este dispositivo {#device-profile}

Cuando este dispositivo está aprobado para otro perfil que tienes permiso para usar, **Más** (☰)
ofrece **Perfil**. Elige otro **Perfil de dispositivo** y toca **Cambiar**.

Antes de cambiar, aparca o vacía el pedido en curso. Si hay un pago con tarjeta en curso,
elige **Comprobar pagos con tarjeta / acceder** para consultar el resultado e inicia
sesión allí si se solicita. Después, vuelve a pulsar **Cambiar**. **Cancelar** mantiene el
perfil actual.
Las otras personas que tengan sesión en este dispositivo salen de ella si el nuevo perfil no les
permite iniciar sesión.
Para elegir qué zonas muestra este dispositivo, consulta
[Elegir las zonas que muestra este dispositivo](table-service.md#device-zones).

## Elegir las zonas que muestra este dispositivo {#device-zones}

Un dispositivo muestra todas las zonas que permite su perfil. Si solo atiendes la terraza, las demás
zonas estorban, así que puedes elegir cuáles muestra este dispositivo y en cuál se abre. En una
caja, abre **Más** (☰), luego **Ajustes** y luego **Zonas en este dispositivo**. En un móvil o una
tableta, abre **Más** (☰) y elige **Zonas en este dispositivo**, en **Ajustes**. Marca **Mostrar**
en cada zona que quieras, elige la que **Abre primero** y toca **Guardar**.

Desde entonces, **Sala** muestra solo las zonas que has elegido, y con una sola zona no muestra
pestañas de zona. Una caja muestra en Sala las zonas de mesas elegidas y en Mostrador las zonas de
mostrador elegidas. Un móvil o una tableta no tiene Mostrador, así que su Sala muestra todas las
zonas que has elegido. Hasta que guardas una elección, un móvil o una tableta se abre donde siempre;
después se abre en tu zona de **Abre primero**. Tras abrir una mesa, mira
[Volver a tus mesas con platos sin enviar](table-service.md#unsent-tables).

La elección es de este dispositivo y del perfil con el que ha entrado, así que otro dispositivo con
el mismo perfil conserva la suya, y al cambiar de perfil vuelve la elección de ese perfil. Si un
responsable retira la aprobación de un perfil para este dispositivo, vuelve a elegir las zonas
si recuperas ese perfil. Solo puedes elegir las zonas que permite el perfil actual. Si un móvil o una tableta no puede consultar su
elección al entrar, lo indica y muestra todas las zonas que permite su perfil hasta que puede.

Una mesa de una zona que este dispositivo no muestra no admite platos nuevos aquí, y sus platos sin
enviar no se pueden enviar desde este dispositivo. Por eso Waitron no oculta la zona de la mesa que
tienes abierta mientras tiene platos sin enviar. Si las zonas cambian mientras estás en una mesa
así, el cambio espera. Aún puedes enviar o quitar los platos sin enviar de la mesa, pero no añadir
otros nuevos, y la zona se oculta cuando ya no quedan. Si este dispositivo ya no puede atender la
zona de la mesa, por ejemplo porque un responsable la ha quitado del perfil, tampoco puedes
enviarlos ni quitarlos: la zona se oculta al salir de la mesa, y sus platos sin enviar se quedan en
ella. Ocultar una zona no revisa las mesas en las que no estás, así que sus platos sin enviar
esperan hasta que vuelvas a mostrar la zona.

## Ha fallado la comprobación de la huella {#fingerprint-check-failed}

Si Waitron indica que ha fallado la comprobación de la huella, avisa a un responsable para que
se repare el fallo antes de reintentar la operación de factura. La operación rechazada no crea
ninguna factura ni consume su número; las facturas ya guardadas no cambian.

Si la tarjeta ya se ha cobrado, no vuelvas a cobrarla. Conserva los datos de la cuenta y del pago
para que el responsable pueda recuperar el pago una vez reparado el fallo.

## Cobra toda la cuenta o una parte {#pay-window}

Para cobrar una cuenta, abre **Cobrar** en Mostrador o en la cuenta de la mesa. En una mesa, envía o quita
primero los artículos sin enviar. Arriba se muestran **Total**, **Pagado hasta ahora**,
**Pago con tarjeta en curso** y **Queda por pagar**. Parte de lo que queda por pagar, no del
total original de la cuenta.

**Elige qué paga este comensal.** Elige **Toda la cuenta** para cobrar todo lo que
queda. Elige **Una cantidad** para aportar un importe, **Dividir a partes iguales** para cobrar
una parte igual o **Artículos** para platos concretos. Para una parte igual, indica cuántas
personas quedan por pagar, incluida esta. Para artículos, elige los platos y ajusta la cantidad
si solo se pagan algunos. Una cuenta impresa ofrece estas opciones para cobrar lo que queda. Si la
cuenta está presentada para su cobro y aún no se ha emitido su factura, elige **Cobrar por partes**
para ver las mismas opciones.

Elige la forma de pago y pulsa **Continuar** para comprobarla antes de cobrar. Si la cuenta
cambia antes de confirmar, comprueba los importes actualizados antes de volver a confirmar.

**Un ticket propio.** Cuando un cliente paga una parte de una cuenta que aún no tiene factura y que
va con ticket, no con factura completa, la confirmación pregunta si quiere su propio ticket por ese importe. **Sí** le imprime un ticket
propio, y el ticket de la mesa lo descuenta. **No** lo deja en el ticket de la mesa.
Para ver qué ticket de la mesa descontó un pago parcial, abre su ticket en **Buscar cuenta**.

**Efectivo y cambio.** Elige **Efectivo** e introduce el **Efectivo entregado** real. La
confirmación muestra cuánto se descuenta de la cuenta y el **Cambio a devolver**. Si el local
acepta propinas, elige entre devolver todo el cambio, dejarlo todo como propina o dejar una
cantidad. Revisa el cambio después de elegir la propina, pulsa **Cobrar** y devuelve ese cambio.

**Tarjeta y lector.** Elige **Tarjeta**. En un teléfono, comprueba el lector en **Lector e
impresora**; usa **Cambiar** o escanea su etiqueta de Waitron si tienes otro en la mano. En
Mostrador, elige el lector cuando se ofrezca una lista. Comprueba el lector y el total antes de
confirmar. Para usar otra máquina, sigue [Usar otro datáfono](table-service.md#outside-card).

Si el local acepta propinas, introduce **Propina con tarjeta (opcional)** antes de continuar.
La confirmación separa **Se descuenta de la cuenta**, **Propina** y **Se cobra en la tarjeta**.
Una cantidad superior a lo que queda se convierte en propina: confirma con el cliente el cargo
completo antes de enviarlo. Por ejemplo, aportar 50 € con tarjeta cuando quedan 40 € descuenta
40 € de la cuenta y añade 10 € de propina. Si el local no acepta propinas, usa el importe que el
mensaje indica que se puede cobrar.

En un teléfono, el botón de confirmación nombra el importe y el lector. Al pulsarlo, el panel de
espera muestra ese mismo importe y lector, con el tiempo transcurrido. Completa el paso de la
tarjeta en ese lector y espera el resultado. Que el teléfono siga esperando no demuestra que el
cobro haya fallado.

Si el cliente cambia de idea mientras el lector SumUp espera la tarjeta, pulsa **Cancelar cobro**
en esta ventana, en Mostrador o al cobrar una cuenta presentada. Espera a que el terminal confirme
que no se ha cobrado nada antes de volver a cobrar. Si ya se ha cobrado la tarjeta, el terminal
muestra el cobro como realizado.

**Sigue con el siguiente comensal.** Tras un pago parcial, comprueba **Queda por pagar**. En un
teléfono, pulsa **Cobrar al siguiente** para continuar; un reparto igual también indica qué parte
va a cobrarse. Revisa cuántas personas quedan si cambia el grupo. Tras el último pago, elige el
[documento para el cliente](table-service.md#settlement-document). Cerrar la mesa es una acción
aparte, después del cobro.

**Otro teléfono está cobrando.** **Pago con tarjeta en curso** es dinero reservado para esa
tarjeta, por lo que se resta de **Queda por pagar**. En una cuenta de 70 € con un cobro de 30 €
en curso, otro teléfono puede cobrar los 40 € restantes. No puede volver a descontar de la cuenta
los 30 € reservados. Si no queda saldo aparte de esa tarjeta, espera su resultado. Con propinas
activadas, introducir más de 40 € en **Una cantidad** cobra el exceso como propina en este cobro;
confirma ese cargo con el cliente. Si la ventana pregunta si quieres **Cobrar otro**, compruébalo
con la otra persona antes de hacerlo. Un teléfono que tenía abierto un importe anterior puede pedirte
confirmar los importes actualizados. Comprueba tanto lo que se descuenta de la cuenta como la
propina antes de confirmar.

**Se perdió el wifi o no llegó el resultado.** No empieces otro cobro solo porque el teléfono
perdió la conexión. Reconecta y mira los pagos de la cuenta. Si sigue **Cobro sin confirmar**,
usa **Comprobar de nuevo** para continuar ese mismo cobro. No es solo una consulta: si el primer
pago no estaba registrado, puede cobrar la tarjeta o registrar el efectivo. Conserva los datos
del efectivo y del lector mientras averiguas el resultado.

Si el pago figura como no cobrado, puedes cobrarlo de nuevo. Si sigue pendiente, o la tarjeta se
cobró pero el pago no se registró, elige **Comprobar pagos con tarjeta / acceder** y sigue
[Comprobar un pago con tarjeta antes de cancelar](table-service.md#cancel-pending-card). No vuelvas
a cobrar una tarjeta que sabes que ya se ha cobrado. Si falla la comprobación, sigue
[Falló la comprobación de un cobro con tarjeta](table-service.md#card-check-failed).

## Cerrar una cuenta como pago aplazado {#deferred-payment}

Úsalo cuando el cliente vaya a pagar toda la cuenta más tarde, fuera de Waitron. Abre **Cobrar** en
la cuenta y elige **Cerrar como pago aplazado** (donde se ofrezca **Toda la cuenta**, elígela
antes). Comprueba la cuenta, la factura y el total, y confirma. Waitron emite la factura si aún no se ha emitido y cierra la cuenta
definitivamente. No registra ningún pago de la cuenta, ni ahora ni después, y la cuenta muestra
**Pago aplazado** desde entonces.

El botón solo aparece en una cuenta sin nada cobrado. En la cuenta de una mesa, todos los platos
tienen que estar servidos o cancelados antes; en el mostrador, la cuenta tiene que llevar factura
simplificada. Un responsable lo permite en un dispositivo activando **Cierra cuentas
como pago aplazado** en el perfil del dispositivo, en **Perfiles de dispositivo** del panel.

Tu gestor obtiene la lista de estas cuentas con **Exportar pagos aplazados (CSV)**, en la página
**Ventas y recaudación** del panel.

## Practicar con distintos dispositivos en Demostración {#demo-devices}

En un navegador sin emparejar, abre la caja para elegir un dispositivo. Si ya está
emparejado, sigue usando ese dispositivo; pulsa **Elegir otro dispositivo** en la
pantalla de acceso para cambiarlo. Una pantalla de cocina ofrece la misma opción junto al idioma.

Elige dispositivos distintos en cada pestaña para iniciar y cerrar sesión por separado. Las
pestañas que eligen el mismo dispositivo comparten su sesión. Usa **Emparejar otro dispositivo**
si necesitas añadir uno.
