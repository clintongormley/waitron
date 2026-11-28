# Servicio en mesa

Con el simulador de pagos, los controles de cobro del mostrador y la ventana de pago de
cuentas ofrecen **Aprobar**, **Rechazar** o **Sin respuesta** antes de pulsar **Tarjeta**. No se cobra ninguna tarjeta real. **Sin respuesta**
mantiene el pago bloqueado para que puedas practicar su recuperación. En **Pagos** del panel,
un encargado elige **Consultar al proveedor** y confirma. Así termina el intento de práctica sin
registrar un cobro.

## Invitar o aplicar un descuento {#comps-and-discounts}

Elige un motivo en **Descuento…** al dejar un artículo gratis o reducir su precio. Con **Aplicar invitaciones**,
puedes aplicarlo hasta los límites del motivo y de la cuenta. Si necesitas autorización, elige a
alguien con **Autorizar invitaciones** y pídele que introduzca su PIN. Puede superar esos límites
y aplicar sus propias invitaciones sin el PIN de otra persona. Por defecto, el personal puede aplicar
invitaciones dentro de los límites; supervisores, encargados y administradores pueden autorizarlas.

En **Cancelaciones y descuentos**, dentro de **Configuración del local**, indica **0** cuando cada invitación necesite
autorización. Los motivos nuevos empiezan en 0; cambia el importe o bórralo para permitir invitaciones sin límite.
**Queja**, **Invitación** y **Descuento** empiezan en 0; **Comida de
personal** permite hasta un 50% de descuento por artículo antes de pedir autorización.

Si una invitación deja la cuenta a cero, Waitron la cierra y emite la factura en el momento. Entrega esa factura al cliente.

Si cambias los extras de un plato con invitación o descuento, o su variante en un pedido aparcado,
la invitación o el descuento se quita de ese plato.

## Repartir una cuenta del mostrador {#counter-part-payments}

Pulsa **Cobrar** para cobrar toda o parte de una cuenta del mostrador. Empiezas con **Toda la cuenta**
seleccionada. Puedes indicar una cantidad, dividir a partes iguales o elegir artículos. Comprueba
**A pagar** y responde a las preguntas sobre el ticket. Pulsa **Cobrar** para iniciar el pago en el
lector conectado o **Efectivo** para indicar cuánto te han entregado. Después de un pago parcial,
comprueba **Queda por pagar** antes de cobrar el siguiente.

Añade un artículo antes de cobrar o enviar un pedido.

Si **Enviar** desaparece tras un cambio en los ajustes de cobro de tu zona de
servicio, pulsa **Cobrar** para continuar.

Si se rechaza el cobro en efectivo de un pedido aparcado que has editado, los cambios siguen en
la cesta. Corrige el importe y vuelve a intentarlo, o aparca el pedido para guardar los cambios sin cobrar.

## Registrar una entrada o salida de efectivo {#drawer-cash-entry}

Si repones cambio o retiras efectivo, abre **Más** y elige **Entrada o salida de efectivo** en una
caja asignada al cajón. Elige **Entrada** o **Salida**, indica el importe y el motivo, y pulsa
**Añadir** o **Retirar** con el importe. Waitron registra el movimiento y abre el cajón. Si sigue
cerrado, usa la llave.

## Cerrar un cajón de efectivo {#close-drawer}

En una caja asignada al cajón, abre **Más** y elige **Cerrar cajón**. Si no se abre, usa la
llave. Cuenta el efectivo y elige **Guardar recuento**. Después verás la diferencia, si la hay,
y podrás elegir **Volver a contar** una vez. Si sales después de guardar el recuento, elige
**Cerrar cajón** en cualquier caja asignada al mismo cajón para continuar.

Si Waitron te pide que vuelvas a contar tras un movimiento de efectivo, elige **Volver a contar**
e indica cuánto hay ahora en el cajón.

Introduce el efectivo que quieres dejar y comprueba el importe **Para el banco** antes de retirar
el resto. Elige **Finalizar cierre**. Puedes reimprimir el justificante en
[Ventas](sales.md#drawer-close-history).

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

En **Comprobar pagos con tarjeta**, en **Ventas e impuestos**, abre **Comparación de SumUp** para consultar un día natural
en la zona horaria del local. Una coincidencia vincula una anotación de la misma cuenta con un
cargo de SumUp del mismo importe, incluida la propina, con un margen de 30 minutos. Comprueba
los cargos ambiguos o sin coincidencia en SumUp antes de corregir nada. La comparación no envía
devoluciones. Si la comparación está incompleta, vuelve a intentarlo tras la última comprobación,
prevista para la 01:00 UTC después de que termine el día.

En **Datáfonos vinculados**, empieza por **Por comprobar**. Usa el datáfono y la cuenta o la mesa
para identificar qué pago comprobar en SumUp. Elige **Todos los estados** para ver todos los pagos.
Usa **Personalizar columnas** para ocultar o mostrar **Cuenta** y **Datáfono**.

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

Después del último pago, elige **Ticket** o **Factura completa**. Un cambio que deja
la cuenta pagada ofrece la misma elección. Para imprimir, espera a que **Imprimir en {printer}**
nombre el destino y púlsalo. Una factura completa conserva el cliente registrado.

Si no está claro si se imprimió una factura en A4, comprueba la impresora que aparece en la
ventana. Si aún la necesitas, pulsa **Volver a imprimir**. Para enviarla a otra impresora, elige
**Impresora de facturas**. La ventana muestra cómo avanza la impresión o el envío por correo.

Cuando se ofrece **Enviar por correo electrónico**, puedes enviar un ticket o una factura completa en PDF.
Introduce el correo del cliente y pulsa **Enviar**. Imprimir y enviar por correo son acciones
independientes. Si la caja dice **Compruébalo antes de intentarlo de nuevo**, puede que el documento
ya se haya entregado: pregunta al cliente o mira la impresora antes. Si falla el envío, o el cliente
no lo tiene, pulsa **Volver a enviar el correo** para repetirlo a la misma dirección o elige otra
dirección.

Pulsa **Listo** o cierra la ventana para continuar. Salvo que lo hayas enviado por correo
electrónico, el ticket se imprime al cerrar. Si la impresora está desactivada o no funciona, se
imprime por sí solo cuando vuelva a funcionar; si al día siguiente no se ha impreso, imprímelo desde la
venta. Si el dispositivo no tiene impresora de tickets, elige una o envía el
correo antes de cerrar; si no, se imprime si el dispositivo pasa a tener una en el plazo de un día. Cierras la mesa por separado.
Después de imprimir una cuenta con **Imprimir la cuenta**, la ventana que aparece tras el último
pago ofrece una copia en lugar del original, que se imprimió con la cuenta; imprímela solo si el
cliente pide otro ticket.
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

Abre **Factura completa** desde la zona de cobro, debajo del pedido, o desde **⋮** junto al selector
de cuentas. Ambas opciones abren el mismo formulario para la cuenta en pantalla hasta que cobres
la cuenta entera o se emita su factura. Convertir una cuenta pagada en factura completa sería
corregir una factura ya emitida, y Waitron todavía no ofrece esa corrección. Cuando ya has elegido
un cliente, su nombre y su identificador aparecen debajo de **Factura completa**, en la zona de
cobro. Al juntar cuentas, o al mover todos los platos a otra cuenta, la caja pregunta antes de
cambiar el cliente de una factura completa.

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

Para una dirección española, escribe en **Calle y número del cliente**. Si aparecen sugerencias,
elige una y revisa la dirección rellenada antes de guardar. También puedes introducir toda la
dirección a mano. Cuando las sugerencias están activadas, Waitron Cloud envía a Google Maps el
texto que busca y la sugerencia que elijas, si eliges alguna.

Cada factura completa muestra el domicilio fiscal de tu negocio. Si es incorrecto o está
incompleto, corrígelo en **Ajustes del local → Datos del local**: elige **Cambiar domicilio
fiscal** en la tarjeta **Negocio**. Si usas **Igual que la dirección del local**, corrige antes la dirección del
local. Las facturas que se emitan después
muestran el nuevo domicilio; las ya emitidas conservan el que tenían al emitirse.

En cualquiera de los dos formularios, empieza a escribir la calle y el número en **Dirección**.
Si aparecen sugerencias, elige una, revisa la dirección y guárdala. Cuando las sugerencias están
activadas, Waitron Cloud envía a Google Maps el texto que busca y la sugerencia que elijas, si
eliges alguna.

Para las cuentas cerradas como [pago aplazado](table-service.md#deferred-payment), indica tu cuenta bancaria con
**Cambiar cuenta bancaria** en la misma tarjeta **Negocio**: introduce el **IBAN** y, si quieres,
el banco. Si [añades tu propio servidor de correo](email.md#set-up), Waitron envía un correo a cada
administrador con correo electrónico por cada cambio; si
recibes uno por un cambio que nadie de tu personal ha hecho, revisa la cuenta enseguida.

## Buscar cuenta {#find-a-bill}

**Buscar cuenta** muestra las ventas terminadas, de la más reciente a la más antigua. Busca por
número, mesa, nombre, últimas cifras de una tarjeta o un importe, como 80,52. Se abre con las ventas
de hoy: para una anterior, elige los días en el botón debajo de la búsqueda, como **Cualquier fecha** o
**Desde / Hasta**. Encima de las ventas,
**Cuentas sin pagar** muestra las cuentas de clientes que se fueron sin pagar, y **Pedidos de
mostrador**, los pedidos de mostrador aún sin terminar: elige uno para abrirlo.

## Elegir un documento y una impresora {#invoice-printer}

Abre una venta en **Buscar cuenta** para revisar su ticket con el formato de papel de 80 mm.
El ticket se muestra en el idioma en que se emitió. Para una copia en papel, elige **Imprimir/Reimprimir**. Para una factura completa, elige
**Ticket** para la versión compacta o **Factura** para el formato de factura. Una factura
simplificada muestra directamente sus impresoras de tickets. Ambas versiones de una factura
completa conservan los datos del cliente registrados.

Si una factura completa ligada a una cuenta puede haberse impreso, ábrela en **Buscar cuenta** y
revisa primero la impresora de oficina indicada. Si no se ha impreso, pulsa
**Volver a imprimir**. La ventana te muestra el resultado. Para enviarla a otra impresora, elige **Impresora de facturas**.

En una caja con permiso para imprimir tickets, comprueba **Última dirección de correo** antes de
reenviar una factura completa.

Elige una impresora de la lista de tu dispositivo. Elige **Heredar** para seguir el perfil. Cualquier
otra elección se guarda en **Equipo de este dispositivo**. Si otro
dispositivo lleva la impresora de tickets, Waitron pregunta antes de que te la quedes.

Espera a que **Imprimir en {printer}** o **Imprimir una copia en {printer}** nombre tu destino y
púlsalo. Elegir un documento o una impresora, actualizar la lista y volver atrás no imprime nada.
La copia sigue preguntando el idioma cuando hay más de uno; cancelar no imprime nada. Si la
elección no se ha guardado, pulsa **Reintentar**; usa **Actualizar** si no se pudieron cargar las impresoras.

Para una factura completa antigua sin cuenta, ábrela en **Buscar cuenta** y elige **Factura**.
Usa **Ticket** para una copia compacta cuando se haya completado un original. Si falla la impresión,
comprueba el destino de **Reintentar original** o elige la impresora de tickets indicada en su lugar.

Si la caja indica que la impresora de oficina se ha quedado sin papel, añade papel y espera la
factura. El aviso puede seguir en la pantalla de inicio de sesión si la caja se bloquea. Si puede que
la factura se haya impreso, revisa la impresora antes de volver a enviarla.

## Imprimir desde Pedidos del panel {#dashboard-documents}

En un aviso de entrega de factura, elige **Ir a Pedidos** para abrir esa factura.

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
identifica una impresora de oficina. Antes de recoger una factura completa, comprueba la impresora de
destino en el aviso inferior. Este navegador recuerda por separado la última impresora que aceptó un
envío para Ticket y Factura. Si ya no está disponible, vuelve a elegir. Al abrir la lista,
si solo hay una impresora disponible, aparece seleccionada. Usa **Actualizar impresoras** si no
aparece ninguna,
o **Cancelar** para salir sin imprimir.

## Justificantes de pago {#reader-slips}

Si quien paga quiere justificante, elige **Imprimir justificante de pago** después de cobrar en
efectivo, con **Otro datáfono** o con lector de tarjetas. Si es un pago parcial, usa el botón en
**Cobrar** cuando aparezca el pago recibido. Tras el último pago, usa **Documento para el cliente**.
El botón aparece cuando tu dispositivo tiene impresora de justificantes. Si el lector imprime su
propio justificante, el lector se encarga de ese pago. El justificante muestra el
pago y cómo se hizo. Con **Otro datáfono**, incluye el datáfono y el número de operación que indicaste.

Si falla tu solicitud de impresión, puedes pulsar **Imprimir justificante de pago** de nuevo.
Para sustituir un justificante que ya se imprimió, usa
**Reimprimir** en la [Cola de impresión](printers.md#print-queue).

Si un lector de tarjetas imprime su propio justificante de pago, abre **Lectores de tarjetas** en **Hardware**, edita ese lector y activa **Imprime su propio justificante automáticamente**. Después elige
**Guardar**. Waitron deja los justificantes de ese lector en manos del propio lector. Este ajuste
describe el lector; no cambia la configuración de su impresora. Empieza desactivado en un lector nuevo.

Si añades de nuevo un lector reconocido, conserva tu elección. Consulta [Lectores de tarjetas](printers.md#card-readers)
para eliminar un lector o añadirlo de nuevo. La exportación de configuración incluye la política
de pagos, pero no los lectores ni este ajuste.

## Confía en el servidor antes de abrir la caja {#certificate-trust}

La página de la caja **Conecta este dispositivo de forma segura** y la guía del certificado del
servidor usan el idioma que prefiera tu navegador entre español e inglés. Si no reconoce ninguno,
Waitron usa el inglés. Elige **Ver cómo hacerlo** para abrir la guía, sigue sus pasos para instalar
el certificado y vuelve a abrir la caja.

Si ya has abierto la caja y cambia el certificado del servidor, puede aparecer **No se puede
conectar con el servidor** en lugar del aviso del navegador o de la página del certificado de la
caja. En la red WiFi del local, elige **Ver cómo hacerlo** para abrir los pasos en otra pestaña.
El enlace necesita la página local del certificado, que no está disponible en un servidor de
reserva, si el acceso HTTP está desactivado o si el local usa su propio certificado TLS.
Antes de eliminar un certificado, compara su nombre y su huella con los que muestra este servidor.

En un dispositivo que nunca ha confiado en el servidor, el navegador puede avisar de la conexión
antes de que la caja pueda abrirse. Abre en su lugar `http://` seguido de la dirección IP del
servidor y `/setup/trust`, por ejemplo `http://192.168.1.20/setup/trust`, para llegar a la página
que instala su certificado. Si el servidor está conectado por cable, quien puede gestionar el
sistema encuentra su dirección junto a **Cable** en **Red** dentro de
[Estado del servidor](box-status.md#network). `http://waitron.local/setup/trust` también funciona
si el dispositivo encuentra ese nombre, pero una VPN activada en el dispositivo puede impedir
abrirlo, así que desactívala; [Servidores](servers.md) lo explica.

## Devolver un pago entero o una parte {#refund-payment}

Cuando tengas que devolver un pago de una cuenta, empieza por ese pago para comprobar cuánto queda
disponible para devolver.

En la ventana de pagos de la cuenta, elige **Devolver** junto al pago. La ventana **Devolver un
pago** te pide cuánto se devuelve y por qué. Para **Una parte**, escribe el **Importe a devolver**.
Elige el **Motivo** de la lista. Un motivo que necesita una nota te pide que la escribas, y la nota queda registrada como motivo.

Mientras la cuenta no tenga factura, o cuando su factura ya ha descontado ese pago, **Devolver**
junto a un pago que tiene su propio ticket abre [Devolución desde un ticket](table-service.md#give-money-back)
en ese ticket.

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
Después de facturar, puedes abrir la devolución en **Buscar cuenta**.
Elige **Imprimir** para la primera copia. Puedes reimprimirla desde la **Cola de impresión** del panel durante siete días.

## Cancela un plato de una cuenta guardada del mostrador {#counter-cancel-item}

Usa × para quitar un plato que aún no has enviado. En un plato enviado, × y **Cancelar** abren
**Cancelar plato**. Elige cuántos cancelar. Si la preparación ha empezado, elige si conservas o
quitas el cobro y selecciona un motivo. Quitar ese cobro puede requerir el PIN de un supervisor.

**Atrás** deja el plato como está. Tras confirmar, la cesta se actualiza desde la cuenta guardada.
Si eliges **Descartar** en un pedido aparcado con platos enviados, la caja abre primero ese
pedido. Cancela sus platos enviados antes de descartarlo. Si conservas el cobro de un plato
cancelado, cobra la cuenta.

## Pasar un pedido aparcado a una mesa {#move-parked-order}

En **Mostrador**, abre el menú de acciones junto al pedido aparcado, elige **Pasar a mesa** y selecciona una mesa. Si un pedido sin enviar de
esa mesa bloquea el traslado, elige **Tomar el pedido** en cada cuenta indicada. Cierra el aviso
y vuelve a elegir la mesa.

Si das un nombre al pedido al aparcarlo, usa hasta 40 caracteres. Tras moverlo, busca el mismo
nombre cuando lo abras en su nueva mesa o mostrador.

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

Un plato por invitación puede volver con el último plato pagado de la cuenta: la ventana de ese
plato lo muestra entonces y el importe lo incluye. Cancelado solo, un plato por invitación no
devuelve dinero.

La marca solo aparece cuando este dispositivo puede devolver el pago. Si el cliente pagó de una
forma que este dispositivo no acepta, la ventana dice **Devuélvelo en una caja: elige Devolución en
el ticket.** Después de **Cancelar y devolver**, la ventana **Devolución** del ticket se abre ya
rellenada, como se explica en [Devolución desde un ticket](table-service.md#give-money-back).

## Cerrar una mesa pagada con platos aún por llegar {#finish-paid-table}

Cuando eliges **Cerrar mesa** y una cuenta pagada aún tiene platos sin servir, una ventana con un
título como **2 platos sin servir** los muestra, y puedes cancelarlos todos o, si alguno tiene comanda de estación, pasar
la comida al mostrador. Puedes elegir la devolución plato por plato. El ticket de anulación
sigue el [ajuste de agrupación de la estación](kitchen-service.md#identical-dishes).

Para un plato que ha pasado a la estación pero no está marcado como empezado, responde a **En
preparación**. Para los demás, la ventana muestra la respuesta. Marca **Devolución** junto a cada
plato cuyo dinero se devuelve; un plato empieza marcado cuando la preparación no ha empezado. Un
solo **Motivo** sirve para todos los platos, y empieza en **No servido** si tu local conserva
ese motivo. Un plato con **Por invitación** no tiene marca propia: su dinero vuelve con los platos
pagados de la cuenta cuando los marcas todos.

Elige **Cancelar y devolver** con el total de los platos marcados, o **Cancelar** si no hay ninguno
marcado. **Atrás** deja la mesa abierta. Si marcas **Devolución** y no puedes hacer devoluciones,
alguien que pueda introduce su PIN. Si un pago se cobró de una forma que este dispositivo no
acepta, la ventana dice **Devuélvelo en una caja: elige Devolución en el ticket.**

Cuando la mesa se cierra, una ventana **Devolución** muestra cada ticket con platos marcados. Elige
uno para abrir su ventana **Devolución**, ya rellenada. Si solo hay un ticket, se abre
directamente.

Si los clientes van a esperar y recoger la comida en el mostrador, elige **Lo recogerán en el
mostrador**. Aparece cuando al menos uno de los platos tiene comanda de estación. No se cancela ni se
devuelve nada. Los platos en espera pasan ahora a la estación, cada cuenta cuyos platos por llegar
tienen comanda de estación pasa a ser un pedido pagado que espera en el mostrador, y la mesa se
cierra. Abre el primer mostrador activo del departamento de la venta.
Busca **Mostrador** en el pase y el pedido en **Mostrador**. Elige **Entregado** en el pedido
marcado **Pagado, sin entregar** cuando lo recojan. Desde la caja de la mesa, puedes encontrar su
ticket en **Buscar cuenta**. Si el departamento no tiene mostrador activo, elige **Entregar** en
el pedido en **Estaciones**.

Si mueves manualmente al mostrador una cuenta que ya has presentado, cobra en la zona de la mesa.
Una vez cobrada, abre el primer mostrador activo según el orden de
las zonas, aunque hayas usado una caja en otro mostrador.

## Devolución desde un ticket {#give-money-back}

En un ticket anterior, elige **Devolución**. **¿Por qué se devuelve?** ofrece:

- **Un plato**: algo que pidieron no llegó o no estaba bien. Marca la casilla de cada plato
  que quieras devolver en **¿Qué platos?**. **Dinero a devolver** empieza en lo que cuestan.
  Cámbialo para devolver menos o más.
- **Cortesía o queja**: escribe el **Dinero a devolver** que elijas, hasta el importe que muestra
  la ventana.
- **Lo pagado de más**: aparece cuando el cliente pagó más que la cuenta. Devuelve una parte o todo
  eso, y nada más. En el ticket figura como Propina.

Con **Un plato** o **Cortesía o queja**, si el pago elegido también tiene algo pagado de más, activa
**Devolver también lo pagado de más** para devolverlo a la vez.

Elige un **Motivo**. Un motivo que necesita una nota, como **Otro motivo**, te pide que la escribas.

En **Cómo se devuelve**, elige efectivo o una tarjeta; cada uno muestra cuánto admite. La ventana
dice entonces qué pasa: en efectivo se abre el cajón y entregas el dinero al cliente, y a una
tarjeta se devuelve por el lector de tarjetas. Si el pago elegido no admite todo, la ventana dice
cuánto queda en curso para los demás pagos.

Elige **Devolver** con el importe. Si tú no puedes devolver dinero, un responsable o encargado lo
aprueba con un solo PIN.

En una tarjeta tecleada en un datáfono aparte, la ventana te pide que la devuelvas antes en ese
datáfono. Hazlo, marca **He devuelto … en el datáfono aparte** y elige **Registrar la
devolución**; un responsable o encargado aprueba registrarla con su PIN. Consulta
[Devolver una tarjeta en un datáfono aparte](table-service.md#separate-terminal).

Después de **Cancelar y devolver**, o de **Cerrar mesa** con platos marcados, la ventana se abre en
**Un plato**, rellenada con los platos cancelados, su importe y el motivo de la cancelación. En un
ticket, la aprobación de la cancelación cubre ese dinero, así que no se pide otro PIN salvo que
devuelvas más. En una factura completa a nombre de un cliente, la aprobación de la cancelación no
cubre el dinero que va en una factura rectificativa: salvo que tengas
**Devolver pagos** y también **Emitir tickets y facturas rectificativos**, un responsable o
encargado lo aprueba con su PIN.
Mantén la ventana abierta para aprovecharla: una que abras después desde el ticket no viene
rellenada.

Cuando una devolución a tarjeta espera a la compañía de la tarjeta, elige **Comprobar de nuevo**
para preguntarle por esa devolución, y **Devolver el resto** cuando la ventana lo ofrezca. Si no
puedes devolver dinero, un responsable o encargado aprueba la consulta con su PIN. Si la ventana dice
que el servidor no respondió, elige **Enviar de nuevo**. **Comprobar de nuevo** y **Enviar de nuevo**
nunca devuelven el mismo dinero dos veces. Una factura rectificativa sale sola cuando se emite: por
correo a la dirección a la que fue la factura del cliente, si el servidor puede enviar correo; si no,
se imprime en esta caja. Entrega al cliente lo que se imprima. Un ticket rectificativo o una factura
rectificativa que no se imprime solo se puede imprimir desde **Buscar cuenta**.

Si cierras la ventana antes de que vuelva todo el dinero, busca el ticket en **Buscar cuenta**, en
**Devoluciones en curso**. Si no está, la devolución espera en esta caja: vuelve a abrir
**Devolución** en el ticket para continuar. Si está, elígelo en **Buscar cuenta** para continuar:

- **Devolver … en efectivo** o **Devolver … a la tarjeta** devuelve lo que queda de esa forma.
- **Terminar** registra lo devuelto. Si el ticket o la factura no lo admite, la ventana lo indica: si sigue ofreciendo **Terminar**, este acaba la devolución y lo devuelto queda devuelto; si no, sigue lo que indica y elige **Comprobar de nuevo**. Hasta que **Comprobar de nuevo** lo resuelva, no se puede devolver más dinero.
- **Parar aquí**, que aparece en su lugar mientras queda dinero, se queda con lo ya devuelto y
  no devuelve más.
- **Anular esta devolución** termina una que no ha devuelto nada.

## Devolver una tarjeta en un datáfono aparte {#separate-terminal}

Si la caja indica que el servidor no tiene espacio en disco, espera a que un encargado resuelva el bloqueo
antes de devolver el dinero en el datáfono: Waitron no puede registrar la devolución mientras dure.

Para un pago con tarjeta registrado desde un datáfono aparte, devuélvelo en ese datáfono solo
cuando la ventana te lo pida, y completa allí la devolución antes de confirmarlo en la ventana.
Después, un responsable o encargado aprueba su registro en Waitron con su PIN, salvo que devuelva
como mucho lo que la cuenta se pagó de más.

Si una devolución no recibe respuesta, revisa los pagos de la cuenta antes de intentarla otra vez.
La primera petición puede haberse completado.

## Marcar un paso de servicio como hecho {#service-steps}

Un paso de servicio te recuerda volver a una mesa en el momento adecuado, como **Tomar nota** un par
de minutos después de marcar **Montar mesa** como hecho, o **¿Postre?** cinco minutos después de servir
los Platos principales. Un local nuevo empieza con **Montar mesa**, **Tomar nota**, **¿Postre?** y
**¿Café o la cuenta?**, que vence cinco minutos después de servir los Postres. Si falta cualquiera
de esos órdenes de plato iniciales, un departamento nuevo empieza con los dos primeros pasos.
Añade tus propias visitas ligadas a un orden de plato en **Mesas**. Cada paso empieza en un momento
así y vence unos minutos después. Configúralos en **Pasos de servicio**, en la pestaña **Mesas** del
departamento, en el panel. Allí puedes ver los momentos fijos, los pasos y el orden de los platos
desde que el grupo se sienta hasta que se va. En cada fila de orden de plato, elige **Marchar ya**
o **Dejar para después**. Si eliges dejarlo para después, puedes fijar su tiempo de aviso, con
**Al momento** y **Deshabilitado**. Pulsa **Guardar** para conservar estas opciones con los demás
ajustes del departamento. Usa **Orden de platos** para cambiar los nombres y el orden compartidos.

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
platos del mismo orden del plato. Un paso que se repite cada pocos minutos desde el último pedido vuelve con cada
repetición: **Hecho** quita la que se ve, y otro pedido vuelve a empezar la cuenta.

## Cada plato es su propia línea {#portions}

Cuando tomas un pedido de 2 × Hamburguesa con queso, en una mesa o en el mostrador, la cuenta tiene
dos hamburguesas, cada una con su queso, en lugar de una línea de dos. Así puedes cancelar una hamburguesa, o en una mesa servirla o moverla, y su queso
va con ella, y la cuenta y la estación saben siempre qué hamburguesa es cuál.

Mientras los platos son iguales sigues viendo una sola fila en la cuenta y
entre los platos enviados, arriba del pedido. La fila se separa en cuanto un plato cambia, por
ejemplo cuando a una hamburguesa se le aplica un descuento. Entre los platos enviados, una
hamburguesa servida sigue en su fila, que entonces dice **1 de 2 servidos**. Al tocar una fila
enviada se marca entera como servida; **Marcar
servido** en los detalles de la fila pregunta cuántos. Para cancelar o hacer un descuento a la
hamburguesa ya servida, elige **Cancelar servido…** o **Descuento servido…** en el menú **Más** de
la fila; **Cancelar…** y **Descuento…** solo toman las hamburguesas aún no servidas. [**Mover platos**](table-service.md#move-dishes) te deja
elegir cuántos platos de una fila pasan a otra cuenta, cada uno con sus extras. **Descuento** y
**Cancelar** actúan sobre la fila y te dejan elegir cuántos de sus platos. **Cambiar plato**, en los
detalles de la fila, cambia todos los platos de la fila y permite aumentar la cantidad.
Para reducirla, usa **Cancelar…**. Elige **Marchar ya** en los detalles de una fila en espera
para enviar todos sus platos con sus extras.

Los alérgenos y las etiquetas dietéticas vienen de la carta publicada. Los detalles de un plato
enviado conservan, en la caja, los que tenía al enviarlo; las pantallas de cocina y la comprobación
de alergias de la mesa muestran cualquier corrección publicada desde entonces. **Corregir la carta
publicada** también imprime un aviso de corrección cuando la corrección añade o quita un alérgeno
en un plato enviado y aún no servido, marcado para un comensal con esa alergia; una publicación
normal no imprime ninguno.

Para consultar los alérgenos y las etiquetas dietéticas de un plato enviado, abre sus detalles y
lee **Registrado al enviar**. Un plato en espera muestra lo que está publicado ahora hasta que lo
liberas.

Cada plato al peso va en su propia línea y pasa entero a otra cuenta. Para una medida como un
zumo vendido por ml, toca el plato, escribe la cantidad en su campo o usa el teclado de la caja
y elige **Añadir**. Por ejemplo, 250 ml van en una sola línea. Antes de enviar, toca la cantidad
en el mostrador para editarla, o en una mesa toca su fila y elige **Opciones**. **Marcar servido**
marca toda la cantidad como servida.

En una mesa o en el mostrador puedes añadir hasta 99 porciones de un mismo plato cada vez.

En una mesa, toca un plato de **Nuevo pedido** para abrirlo en su sitio, con su descripción, sus
alérgenos y sus etiquetas dietéticas: − y + cambian cuántos,
**Opciones** abre sus detalles y **Nota** los abre en su nota. Con 1, − es una papelera que quita el
plato. Vuelve a tocarlo para cerrarlo. Un plato al peso, o de un menú, no tiene − ni +: usa
**Opciones**. Para quitar platos, marca sus
casillas y toca **Quitar** en la barra bajo el pedido.

En el mostrador, un pedido que aparcas y vuelves a abrir muestra sus 2 × Hamburguesa como una sola
fila mientras no se haya pagado nada de él.

## Volver a tus mesas con platos sin enviar {#unsent-tables}

En un turno con mucho trabajo es fácil empezar un pedido en una mesa, que te llamen desde otra y
olvidar los platos que no llegaste a enviar. Por eso, en un móvil o una tableta, la barra de arriba
muestra un botón como **✎ M4**, con el nombre corto de la mesa, por cada mesa
donde tienes platos sin enviar; aunque varias cuentas tuyas tengan platos sin enviar allí, la mesa
tiene un solo botón. Toca un botón para volver a esa mesa. La mesa en la que estás aparece
resaltada. Cuando ya no queda nada tuyo sin enviar en ella, por ejemplo después de enviarlo todo, su
botón sigue resaltado sin el ✎ hasta que sales, y entonces desaparece, mientras que una mesa de la
que sales con platos aún sin enviar conserva su botón con ✎. Si
otra persona se queda con tu cuenta, deja de contar como tuya: al momento en la mesa en la que
estás, y en cualquier otra mesa cuando Sala vuelva a actualizar sus mesas. Cuando hay más botones
de los que caben, deslízalos hacia un lado. Un borde difuminado indica dónde hay más. En un
móvil o una tableta con la sala en pantalla ancha, **Sala** aparece primero. Con un teclado, usa las flechas
izquierda y derecha para pasar de **Sala** a tus mesas. Inicio abre **Sala** y Fin abre la última
mesa. En una pantalla estrecha, usa Tab para llegar al botón de una mesa y Enter para abrirla.

Elige **Sala** después de una mesa para abrir su zona, si este dispositivo la muestra. En una
pantalla estrecha, toca el nombre de la zona abajo y busca la marca junto a tu zona actual. Toca
otra zona para cambiar, o usa las flechas arriba y abajo y pulsa Enter. Abre **Más** (☰) en la misma barra para fichar, cambiar el plano de hoy,
buscar cuentas, gestionar el efectivo, consultar tu jornada, pedir ayuda o abrir los ajustes. La hora de entrada aparece debajo de tu nombre,
junto a **Fichar salida**. En un móvil o una tableta con la sala en pantalla ancha, abre **Más** arriba para encontrar **Equipo**, **Idioma** y **Tema** en **Ajustes**.

## Abrir el plano cuando el servidor tarda {#floor-first-read}

Si ves **Esperando al servidor…** en el plano, espera un momento a que se carguen las mesas.
Si ves **No se puede conectar con el servidor**, comprueba la conexión de la caja o que el móvil
esté en el WiFi del local. Después, pulsa **Reintentar**.

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

En un móvil o una tableta, para mover un plato de **Nuevo pedido**, mantén pulsada su fila
hasta que aparezca el contorno. Sin levantar el dedo, arrástralo al título del grupo que quieras y
suéltalo.

Usa el campo **Carta** junto a **Buscar** para cambiar entre las cartas disponibles. Desplázate
más allá del primer bloque para encontrar **Accesos directos** o **Carta completa**, según cuál
venga después. La misma carta empieza en el mismo orden en la caja y el dispositivo de mano.
Toca un botón con una carpeta para abrir esa sección. Un intervalo de precios indica cuánto
cuestan las variantes. Toca el producto para elegir una y ver su precio.

## Menús {#set-menus}

Añade los platos que piden los clientes, desde cualquier carpeta. Cuando envías los platos de una mesa,
la cuenta los agrupa en los menús más baratos que encuentra. Cobra a la carta los platos que quedan
fuera. La carpeta de un menú muestra qué platos incluye y cuáles tienen suplemento: ábrela
desde la cuadrícula o escribe su nombre en **Buscar** y pulsa el resultado.

En una mesa, un plato sin agrupar muestra su propio precio con los extras de pago hasta que lo
envías. El total del pedido puede bajar si el plato pasa a formar parte de un menú.

Abre el resumen de menús en **Pedido** para ver qué platos lleva cada menú y qué sitios quedan
libres. Para invitar o hacer un descuento en un menú, pulsa **Descuento…** en él dentro del
resumen. Un plato al que invitas o haces un descuento sale de su menú y se cobra a la carta, menos
lo que le descuentas. Un menú no se puede anular: anula o mueve sus platos.

Una invitación o un descuento en un menú cubre su precio y sus suplementos, no los extras de pago.
Si se anulan, se mueven o se pagan aparte algunos de sus platos, el descuento se quita; si mueves o
pagas todos, se va con ellos.

Para pasar un menú a otra cuenta, abre **Mover platos** y selecciona el menú. Sus platos se
mueven con él.

En el **Mostrador**, elige **Para llevar** y añade platos desde cualquier carpeta. La cesta
muestra el precio a la carta de cada plato nuevo y los extras de pago. Abre **Cobrar** para comprobar
el total una vez agrupados los platos en menús. Para añadir platos después, toca el pedido
aparcado en **Pedidos abiertos**.

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

Es habitual que los clientes paguen por separado: dos parejas en una misma mesa, o alguien que paga
sus propias bebidas. Cada uno tiene entonces su propia cuenta en la mesa. El selector de cuentas,
arriba en la pantalla de la mesa, muestra la cuenta abierta y su importe. Si hay varias cuentas,
a la derecha ves la posición de la cuenta abierta en la lista. **2 de 3** indica que estás en la
segunda cuenta.

Toca el selector para ver las cuentas de la mesa por orden de número. En una pantalla estrecha,
la lista se abre desde abajo. La marca verde azulada indica qué cuenta tienes abierta. Cada fila muestra el número y
el nombre de la cuenta, lo que queda por pagar, lo que se pagó de más, por ejemplo **5,00 € de
más**, o **Pagada ✓** (**Pago aplazado** si se cerró como pago aplazado), y una línea como **Ana tiene un
pedido sin enviar: 3 artículos** por cada persona con platos sin enviar en esa cuenta. Cuando otra
cuenta tiene platos tuyos sin enviar, el selector lo indica, como **✎ Cuenta 2 sin enviar**, y la
lista marca esa cuenta con **✎ Sin enviar**. Elige una fila para poner esa cuenta en pantalla. Una cuenta pagada también se abre, para que puedas ponerle
nombre o, si tiene ticket, imprimir una copia, pero no admite platos nuevos. **+ Cuenta nueva** está
siempre al final de la lista: abre una cuenta nueva y vacía en la mesa y la pone en pantalla.

Con el teclado, pulsa Intro para abrir el selector, usa las flechas arriba y abajo para llegar
a una cuenta y pulsa Intro para mostrarla. Inicio y Fin llevan a la primera y la última opción.
Escape cierra la lista.

Toca el nombre de la mesa para ver las acciones que afectan a todo el grupo. Puedes consultar
**Alergias**, cambiar **Comensales** o **Poner nombre a los clientes**, y activar o desactivar
**Cuenta pedida**. Usa **Mover a otra mesa**, **Unir mesas** o **Separar la mesa** para cambiar
dónde se sienta el grupo. **Cerrar mesa** está al final. En una pantalla baja, desplázate por el
panel hasta encontrarlo.

**Alergias**, **Comensales** y **Poner nombre a los clientes** abren un editor. Pulsa el nombre
de la mesa en la parte superior para volver a la misma cuenta. Usa **Atrás** en la parte superior
de **Mover a otra mesa**, **Unir mesas** o **Separar la mesa** para volver al paso anterior. Si
cambiaste algún campo, puedes seguir editando o descartar los cambios.

Pulsa **⋮** junto al selector para abrir el panel de acciones de la cuenta que tienes en pantalla.
Comprueba el nombre y el saldo de la cuenta en la parte superior. Si necesitas introducir los datos
de la factura, elige **Factura completa** antes de **Imprimir la cuenta**. **Juntar cuentas**
y **Mover esta cuenta** ocupan toda la pantalla en un móvil y se abren sobre el pedido en
pantalla ancha. Pulsa **Atrás** arriba para volver.

Unir una mesa, o mover clientes a otra, conserva todas las cuentas: las que llegan toman los
siguientes números del grupo que las recibe. Para juntar dos cuentas, abre la cuenta que debe
recibir la otra y elige **Juntar cuentas**. La cuenta que recibe puede tener un pago parcial;
la que añades no puede tener pagos. Si la cuenta que añades tiene factura completa a nombre de un
cliente que no figura en la cuenta que recibe, la caja pregunta antes: elige a qué cliente se
factura la cuenta juntada, o **No juntar**. Si mueves la última cuenta de la mesa, la caja sigue en
la mesa con una cuenta nueva y vacía.

Si hay pedidos sin enviar que impiden **Unir mesas**, **Mover a otra mesa**, **Mover esta cuenta**
o **Juntar cuentas**, elige **Tomar el pedido** en las cuentas indicadas y vuelve a intentarlo.

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
en pantalla y la imprime, o muestra los platos aún sin servir. Una cuenta pagada por encima de lo que
suma también impide **Cerrar mesa**: la caja indica qué cuenta es y cuánto sobra, e **Ir a la**
cuenta la pone en pantalla para devolver lo que sobra o dejarlo de propina.

Si un cliente se va sin pagar, selecciona su cuenta, abre **⋮** y elige **Registrar salida sin
pagar** bajo esa cuenta. Comprueba el importe e indica el motivo. Si hace falta autorización,
elige un responsable o encargado y pídele que introduzca su PIN.

Solo se detiene la comida pendiente de servir de esa cuenta, con tickets de cancelación para la
estación. Las demás cuentas conservan su comida, así que puedes servir el postre de quien ya ha
pagado. Se registra como pendiente lo que aún se debe de la cuenta; lo ya pagado se conserva. Cuando
el cliente vuelva a pagar, abre la cuenta en **Cuentas sin pagar**, en **Buscar cuenta**, y cobra allí lo que falta. La
mesa sigue abierta mientras quede otra cuenta por cerrar o comida pagada por servir. Sirve lo que
queda y elige **Cerrar mesa** cuando todos hayan terminado.

Una cuenta que sigue abierta al terminar el día de trabajo recibe entonces su ticket, sin
imprimirlo. Cóbrala con **Cobrar** o registra una salida sin pagar. Una cuenta con platos en espera
o sin enviar sigue abierta. Una cuenta con una devolución en curso de un pago que tiene su propio
ticket sigue abierta hasta que esa devolución se termine o se anule.

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
del cobro con [Devolución desde un ticket](table-service.md#give-money-back). En una factura completa a nombre
de un cliente, esa devolución emite una factura rectificativa, así que en esas cuentas quita antes de
imprimir los platos que puedan no llegar.

Una cuenta impresa no admite más platos. Si los clientes piden algo más, ponlo en **+ Cuenta
nueva**.

Si después los clientes quieren pagar por separado, abre **⋮** y elige **Reabrir cuenta**. Esto
anula el ticket y reabre la cuenta, lista para [**Mover platos**](table-service.md#move-dishes).
Lo ya pagado cuenta para ella.
Si **Reabrir cuenta** muestra platos sin servir, elige **Marcar como servidos** para los que
llegaron. Cuando algo de la cuenta ya se ha servido y no se ha pagado nada, **Parar estos platos y
reabrir** para cada plato que siga en la lista y lo deja fuera de la cuenta reabierta, salvo uno que
la cocina había empezado o terminado, que se queda en ella y se cobra. Para quitar ese cobro, abre
los detalles del plato desde los platos enviados, arriba del pedido, y elige **Descuento…** en el
menú **Más**.

Si los clientes se van antes de que se sirva nada, abre **⋮** y elige **No se sirvió nada**. Se
ofrece en una cuenta impresa que no ha recibido ningún pago y no lleva el nombre de un cliente.
Recupera el ticket en papel, indica el motivo y confirma. Waitron anula el ticket y avisa a cocina
para que pare los platos de la cuenta. Necesitas **Anular ventas**; si no lo tienes, elige a alguien
que lo tenga y pídele que introduzca su PIN. Si algo de la cuenta se ha servido, la caja muestra esos
platos: cobra la cuenta o, si se ofrece, usa **Reabrir cuenta**.

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

Si se devolvió parte de un pago antes de registrar su factura, no vuelvas a cobrar.
En **Comprobar pagos con tarjeta**, en **Ventas e impuestos**, comprueba los importes cobrados, devueltos y aún retenidos. Elige
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

## Mover platos a otra cuenta {#move-dishes}

Cuando un cliente decide pagar sus propias bebidas, pasa esos platos a una cuenta suya. Abre el menú
**⋮** y elige **Mover platos**. Está disponible en una cuenta de mesa que sigue abierta, aunque
parte de ella ya esté pagada.

El panel, con la cuenta como título, por ejemplo **Mover platos de Cuenta 1**, muestra los platos
de la cuenta, cada uno con sus extras bajo el nombre, y un plato al peso con su peso, por ejemplo
**Jamón ibérico ×0,32**. Marca un plato para moverlo; sus extras van con él. Los platos iguales comparten una
fila, por ejemplo **Caña** con un **4** al lado: al marcar la fila se toman todos, o tantos como permitan los pagos de la cuenta, y **−** y **+**
fijan después cuántos, como **2 de 4**, con el importe de los que se mueven. Un plato al peso solo tiene la casilla, porque pasa entero.

Algunas casillas salen en gris, con el motivo debajo del plato:

- **Los pagos retienen 40,00 € en esta cuenta: mueve menos platos**: elige menos platos para que
  la cuenta conserve lo necesario para sus pagos, incluidos los que siguen en curso. Los demás
  platos sí pueden pasar.

En **Mover a**, elige adónde van los platos: otra de las cuentas abiertas de la mesa, o **+ Cuenta
nueva**. Una cuenta que ya ha recibido un pago simplemente debe más después. **Mover** sigue apagado hasta que marques un plato y elijas adónde va.
Después de moverlos, una cuenta nueva se pone en pantalla; si los pasas a otra cuenta, esta sigue en
pantalla. Cada plato conserva su orden del plato y sigue enviado, marchado o servido como estaba. Si mueves
platos de una cuenta pagada en parte hasta que sus pagos cubren lo que queda, la cuenta queda
pagada del todo y se emite su factura.

Si una cuenta está a nombre de un cliente para factura completa y mueves todos sus platos a una
cuenta que no nombra al mismo cliente, la caja pregunta antes: elige el cliente al que se facturan
los platos, o **No mover**.

Si el cambio dejara la cuenta por debajo de lo que ya se ha pagado, la caja dice cuánto
y ofrece un botón **Devolver** por ese importe. Si se rechaza el cambio porque la cuenta que
elegiste tiene un cobro o una devolución con tarjeta en curso, o porque entretanto se ha presentado
o pagado, la caja nombra esa cuenta antes del motivo, por ejemplo **Cuenta 2: Esta cuenta ya está
cerrada**. Si otra persona tiene platos sin enviar en alguna de las dos cuentas, elige
**Tomar el pedido** en el aviso. Elige **Revisar** para comprobar los platos y la cuenta de
destino y vuelve a elegir **Mover**.

## Separar la mesa {#split-table}

Cuando parte de un grupo pasa a una mesa propia, toca el nombre de la mesa, elige **Separar la
mesa** y toca la mesa que se separa. Marca lo que se lleva: cuentas enteras o platos sueltos de cualquier cuenta.
Indica los comensales de cada mesa y confirma con el botón que lleva el nombre de la mesa que se separa.

## Mover una cuenta o separar una mesa con platos en espera {#held-dishes-move}

Una cuenta con platos en espera puede pasar a otra mesa con **Mover esta cuenta** o **Separar la
mesa**. Allí los platos siguen en espera. Después cada mesa marcha su propio grupo: marchar uno no envía
ningún plato de la otra mesa.

## Traspasar una cuenta de Mostrador a otro departamento {#department-transfers}

Abre una cuenta guardada en **Mostrador** y elige **Traspasos** en la barra superior de la caja, o en
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
elige **Guardar**. Vacía el campo para quitar el nombre. Para poner nombre a todo el grupo, toca
el nombre de la mesa y elige **Poner nombre a los clientes**. Si otra persona tiene platos sin enviar en
esa cuenta, elige **Tomar el pedido** antes de ponerle nombre.

Para cambiar el nombre que ve la estación, usa **Poner nombre a los clientes**. Si queda trabajo
pendiente en la estación, sus impresoras reciben un [ticket de cambio de nombre](kitchen-service.md#party-names).

Una cuenta conserva su número mientras sigue con esos clientes. Juntar una cuenta con otra deja un
hueco: junta la Cuenta 2 con la Cuenta 1 y quedan las Cuentas 1 y 3. Una cuenta que llega de otra
mesa o del mostrador toma el siguiente número de los clientes, y también las cuentas de una mesa que
unes. Una mesa que separas con cuentas vuelve a empezar por la Cuenta 1, igual que una mesa que
se vuelve a ocupar cuando sus clientes terminan. Una cuenta conserva su nombre cuando se mueve,
también al mostrador, donde no tiene número. Solo puedes poner nombre a una cuenta en una mesa. El
nombre no se imprime en las comandas de estación ni en los tickets.

## Ver qué mesas tienen comida lista {#ready-bar}

En una pantalla estrecha, consulta cuántos platos están listos en cada mesa. Si el aviso encima
de la barra indica que hay comida lista en otra zona, tócalo para ir allí. También puedes ver el
aviso de cada zona en la lista de zonas.

Cuando la estación tiene platos listos, quieres saber a qué mesas llevarlos sin tener que ir a mirar.
En un móvil o una tableta con la sala en pantalla ancha, una barra al pie de **Sala** muestra cada mesa con comida lista y cuántos
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

## Configurar las mesas del bar y la recogida {#bar-seating}

Si atiendes a clientes sentados en el bar y también entregas pedidos para recoger, crea dos
zonas en **Departamentos y zonas**. Elige **Servicio de mesa** para las mesas y **Servicio en
mostrador** para la recogida. Dibuja las mesas en **Planos de sala**. En la caja, elige la zona
de mesas en **Sala** cuando atiendas a clientes sentados y la zona de recogida en
**Mostrador** cuando entregues pedidos.

## Ver una zona como mapa o lista {#floor-view}

Toca **Lista** o **Mapa** para cambiar la vista. En una pantalla estrecha, el botón está abajo. El dispositivo guarda tu elección para cada zona, así
que la zona se abre igual la próxima vez, y cambiar una zona no cambia las demás. Una zona que no
has cambiado se abre como mapa cuando tiene mesas colocadas en su plano, y como lista cuando no
tiene ninguna. Si las mesas están demasiado juntas para tocarlas en el mapa, cambia esa zona a
**Lista**. Cuando el mapa muestre **Arrastra para ver más**, arrástralo para ver las demás.

## Atiende una zona cerrada {#closed-zone}

Cuando el TPV pregunte por una zona cerrada, confirma para seguir con esa acción o elige
**Cancelar** para abandonarla. Si el aviso también indica que ha terminado un periodo, consulta con
la estación antes de confirmar. Para cambiar el horario de la zona ese día, usa **Calendario** en
el panel.

## Unir y separar mesas {#join-tables}

Una mesa unida guardada empieza como sus mesas reales juntas en un grupo con nombre. Para añadir una mesa, abre sus detalles en el mapa y elige **Unir con…**. Para separar mesas, abre el grupo, elige **Separar mesas…**, marca las mesas que quieres sacar y confirma **Separar**. Usa **Unir con…** para volver a añadir una mesa al grupo.

Cuando unes mesas para sentar a clientes, **Unir con…** deja fuera cualquier mesa que esté por recoger o por mover hasta que la marques como recogida o movida.

Si un pedido sin enviar impide unir mesas desde el mapa, elige **Tomar el pedido** en cada cuenta
indicada. Cierra el aviso y vuelve a arrastrar la mesa o a elegir **Unir con…**.

## Restablecer una zona al plano de hoy {#zone-reset}

Para deshacer los cambios de hoy en una zona, abre su menú ⋮, elige **Volver al plano …** con el nombre del plano que aparece y confirma **Restablecer**.

Después de restablecer la zona, coloca las mesas libres como aparecen en el mapa.

Deja las mesas con comida en camino donde están hasta que entregues el pedido. Antes de que el
restablecimiento pueda unir mesas separadas, termina los pedidos abiertos para esas mesas.
Cuando una mesa indique **Por mover**, muévela y elige **Marcar movida**.

## Elegir el equipo de este dispositivo {#equipment}

En una caja, elige **Más**, **Ajustes** y **Equipo**. En un dispositivo de mano, elige **Más**
y **Equipo**. En cada lista disponible, elige el equipo que quieres usar en este dispositivo,
o **Heredar** para seguir la elección de su perfil.

Si el lector del perfil indica **Disponible para elegir**, selecciona **Heredar**
en el dispositivo con el que vas a cobrar. Si otro dispositivo tiene el lector, en **Equipo**
verás cuál es.

Cuando aparezca **Escanear** para una impresora de tickets, una impresora de justificantes de pago
o un lector de tarjetas, usa su etiqueta de Waitron en lugar de la lista. Comprueba qué equipo
estás escaneando porque tu dispositivo empieza a usarlo sin pedirte confirmación. Si escaneas un
lector de tarjetas, comprueba su nombre en el mensaje de confirmación. Si eliges de la lista un
equipo que lleva otro dispositivo, confirma **Quitárselo**.

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
pantalla estrecha, toca el nombre de la zona abajo y elige **Elegir zonas para este móvil…**.
En las demás pantallas, abre **Más** (☰) y elige **Zonas en este dispositivo** en **Ajustes**.
Marca **Mostrar** en cada zona que quieras, elige la que **Abre primero** y toca **Guardar**.

Si la caja abre en una zona de mostrador, empiezas en **Mostrador**. Desde una sala en una
pantalla estrecha, toca el botón de zona y elige el mostrador por su nombre. Toca **Entregado**
junto a un pedido listo o **Nuevo pedido** para empezar una cesta. En **Pedidos abiertos**, toca
un pedido aparcado para recuperarlo. Toca un pedido enviado para ver sus platos y acciones.
Para ver los pedidos de otro mostrador, elígelo por su nombre. Toca **Volver al mostrador** desde
la cesta o **Sala** para volver a las mesas.
Un móvil o una tableta no tiene Mostrador, así que su Sala muestra
todas las zonas que has elegido. Hasta que guardas una elección, un móvil o una tableta se abre donde siempre.
Después se abre en tu zona de **Abre primero**. Tras abrir una mesa, mira
[Volver a tus mesas con platos sin enviar](table-service.md#unsent-tables).

En la caja, si abres **Ajustes** mientras tomas un pedido, toca fuera de la ventana para volver
al pedido.

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
primero los artículos sin enviar. **A pagar** muestra el importe en la parte superior de Cobrar.
Para una factura completa, [prepara la cuenta antes de cobrar](table-service.md#full-invoice).

**Elige qué paga este comensal.** Elige **Toda la cuenta** para cobrar todo lo que
queda. Elige **Dividir a partes iguales** para cobrar una parte igual, **Artículos** para platos
concretos o **Una cantidad** para aportar un importe. Para una parte igual en una mesa, indica el
número de comensales con − y + y pulsa **Empezar** para la parte del siguiente comensal. En
Mostrador, indica cuántas personas quedan
por pagar, incluida esta. Para artículos, elige los platos y ajusta la cantidad
si solo se pagan algunos. Si eliges todos los platos, se cobra toda la cuenta. Si la tarjeta se
rechaza o pulsas **Cancelar cobro**, comprueba si los platos están en esta cuenta antes de volver a
cobrar. Si están en otra cuenta, cóbrala desde el selector de cuentas de la mesa. Mientras su
tarjeta sigue en curso, la caja que la cobró muestra **Se está cobrando en la**
y el número de su cuenta; no vuelvas a cobrar esos platos. En una cuenta impresa, **Artículos**
anula el ticket y reabre la cuenta. En un pedido de mostrador ya enviado a cocina y aún sin
ticket, **Artículos** pasa los platos elegidos a una cuenta propia, que **Mostrador**
muestra con el número del pedido entre paréntesis. Si ese pedido se pasa después a una mesa, se cobra con **Una cantidad**,
**Dividir a partes iguales** o **Toda la cuenta**, no por artículos; cuando su cuenta está
presentada para su cobro, elige **Cobrar por partes** para ver esas opciones.

Comprueba **A pagar** y responde a las preguntas sobre el ticket. Pulsa **Cobrar** para iniciar el
pago en el lector conectado o **Efectivo** para indicar cuánto te ha entregado el cliente.
Pulsa **Otro datáfono** para introducir los datos de un pago realizado aparte. Si la ventana
pide una forma de pago, elígela, pulsa **Continuar** y comprueba el importe en la confirmación.

**Una cuenta pagada de más.** Una cuenta puede recibir más de lo que suma, por ejemplo una
aportación seguida de platos cobrados en una cuenta propia. Entonces indica cuánto de más y no
ofrece **Cobrar**. Elige **Devolver 5,00 €** para devolver lo que sobra; para ese importe no hace
falta el PIN de un encargado. Si el local acepta propinas, **Dejar 5,00 € de propina** lo guarda
como propina.

Si la cuenta suma 0,00 €, pulsa **Cerrar** cuando veas la confirmación de la devolución. En la
cuenta, elige **Efectivo** o **Tarjeta** y pulsa **Confirmar cobro** por 0,00 € para cerrarla.

**Un ticket propio.** Cuando un cliente paga una parte de una cuenta que aún no tiene factura y que
va con ticket, pregúntale si quiere su propio ticket por ese importe. En la primera pantalla de
**Cobrar**, responde antes de elegir **Cobrar** o **Efectivo**. Si la pregunta aparece en la
confirmación, responde antes de cobrar. **Sí** imprime un ticket separado para ese pago.
**No** lo incluye en el ticket final de la cuenta.
Para ver qué ticket de la mesa descontó un pago parcial, abre su ticket en **Buscar cuenta**.

**Efectivo y cambio.** Elige **Efectivo** e introduce el **Efectivo entregado** real. La
confirmación muestra cuánto se descuenta de la cuenta y el **Cambio a devolver**. Si el local
acepta propinas, elige entre devolver todo el cambio, dejarlo todo como propina o dejar una
cantidad. Revisa el cambio después de elegir la propina, pulsa **Cobrar** y devuelve ese cambio.

**Tarjeta y lector.** En un dispositivo de mano, usa el icono sin contacto para abrir
**Lector e impresora**. Pulsa **Cambiar** o escanea la etiqueta de Waitron si tienes otro lector.
Si el icono sin contacto de la caja abre una lista de lectores, elige el que necesitas. Revisa el
importe del botón **Cobrar** antes de pulsarlo. Para usar otra máquina, sigue
[Usar otro datáfono](table-service.md#outside-card).

Si el local acepta propinas y Waitron controla el lector, pulsa **Introducir propina** en Cobrar.
Para retirar la propina antes de iniciar el pago, pulsa **Editar propina** y luego **Quitar propina**.
Con otro datáfono, introduce la propina con los demás datos del pago. Su confirmación separa
**Se descuenta de la cuenta**, **Propina** y **Se cobra en la tarjeta**.
Una cantidad superior a lo que queda se convierte en propina: confirma con el cliente el cargo
completo antes de enviarlo. Por ejemplo, aportar 50 € con tarjeta cuando quedan 40 € descuenta
40 € de la cuenta y añade 10 € de propina. Si el local no acepta propinas, usa el importe que el
mensaje indica que se puede cobrar.

En un teléfono, el panel de espera muestra el importe, el lector y el tiempo transcurrido. Completa el paso de la
tarjeta en ese lector y espera el resultado. Que el teléfono siga esperando no demuestra que el
cobro haya fallado.

Si el cliente cambia de idea mientras el lector SumUp espera la tarjeta, pulsa **Cancelar cobro**
en esta ventana, en Mostrador o al cobrar una cuenta presentada. Espera a que la caja confirme
que no se ha cobrado nada antes de volver a cobrar. Si ya se ha cobrado la tarjeta, la caja
muestra el cobro como realizado.

**Sigue con el siguiente comensal.** Tras un pago parcial, comprueba **Queda por pagar**. En un
teléfono, pulsa **Cobrar al siguiente** para continuar; un reparto igual también indica qué parte
va a cobrarse. Si cambia el grupo, cambia el número de comensales: en una mesa, vuelve a elegir **Dividir a partes
iguales**; en Mostrador, cambia cuántas personas quedan por pagar. Tras el último pago, elige el
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

El ticket y la factura piden al cliente que pague por transferencia bancaria, con el número de
factura como referencia, e imprimen tu cuenta bancaria. Sin cuenta bancaria en **Ajustes del local →
Datos del local** ([cómo indicarla](table-service.md#full-invoice)), dicen solo **Pago aplazado**.

En **Ventas y recaudación** del panel, selecciona las jornadas que quieras y elige **Descargar
para tu gestor (XLSX)**. La hoja de pagos aplazados recoge las cuentas cerradas en esas jornadas.

## Practicar con distintos dispositivos en Demostración {#demo-devices}

En un navegador sin emparejar, abre la caja para elegir un dispositivo. Si ya está
emparejado, sigue usando ese dispositivo; pulsa **Elegir otro dispositivo** en la
pantalla de acceso para cambiarlo. Una pantalla de cocina ofrece la misma opción junto al idioma.

Elige dispositivos distintos en cada pestaña para iniciar y cerrar sesión por separado. Las
pestañas que eligen el mismo dispositivo comparten su sesión. Usa **Emparejar otro dispositivo**
si necesitas añadir uno.
