# Servicio en mesa

En Demostración o Preparación, los controles de cobro del mostrador y la ventana de pago de
cuentas ofrecen **Aprobar**, **Rechazar** o **Sin respuesta** antes de pulsar **Tarjeta**. No se cobra ninguna tarjeta real. **Sin respuesta**
mantiene el pago bloqueado para que puedas practicar su recuperación. En **Pagos** del panel,
un encargado elige **Consultar con el proveedor de pagos** para un pago del pedido completo,
o **Consultar al proveedor** para un pago parcial de una cuenta, y confirma. Así termina el intento
de práctica sin registrar un cobro.

## Repartir una cuenta del mostrador {#counter-part-payments}

Pulsa **Cobrar** para cobrar toda o parte de una cuenta del mostrador. Empiezas con **Toda la cuenta**
seleccionada; también puedes indicar una cantidad, dividir a partes iguales o elegir artículos.
Elige **Efectivo** o **Tarjeta** en cada pago. Después de un pago parcial, comprueba **Queda por pagar**
antes de cobrar el siguiente.

Añade un artículo antes de cobrar o enviar un pedido.

## Elegir documentos después de cobrar {#settlement-document}

Después del último pago, elige **Recibo**, **Factura completa** o **Ninguno**. Un cambio que deja
la cuenta pagada ofrece la misma elección. Para imprimir, espera a que **Imprimir en {printer}**
nombre el destino y púlsalo. Una factura completa conserva el cliente registrado.

Cuando se ofrece **Enviar por correo electrónico**, puedes enviar un recibo o una factura completa en PDF.
Introduce el correo del cliente y pulsa **Enviar**. Imprimir y enviar por correo son acciones
independientes; cuando una entrega el original, la siguiente entrega es una copia. Si falla el
envío, pulsa **Volver a enviar el correo** para repetirlo a la misma dirección o elige otra dirección.

Elige **Ninguno** o cierra la ventana para continuar sin imprimir. Cierras la mesa por separado.
Si necesitas un documento más tarde, abre la venta y elige **Imprimir/Reimprimir**.

## Comprobar un pago con tarjeta antes de cancelar {#cancel-pending-card}

Si al cancelar un pedido se indica que hay un pago con tarjeta pendiente, espera a que termine el
datáfono y después pulsa **Cobrar** para comprobar ese pago antes de volver a cancelar. Si ya se
cobró la tarjeta, no pidas al cliente que pague otra vez.

## Emitir una factura completa {#full-invoice}

Cuando un cliente de una mesa necesita una factura a su nombre, elige **Factura completa** para
la cuenta e introduce su identificador, su razón social y su dirección completa antes del último
pago. La elección guardada permite superar el límite de factura simplificada. Al cobrar toda
la cuenta se emite la factura; al registrar que se han ido sin pagar también se emite y queda
pendiente de pago.

**Factura completa** está en la zona de cobro de la cuenta, debajo del pedido, y en el menú **⋮**,
bajo el nombre de la cuenta; las dos abren el mismo formulario para la cuenta en pantalla. Ninguna
aparece cuando la cuenta ya está pagada o ya se ha emitido su factura. Convertir una cuenta pagada
en factura completa sería corregir una factura ya emitida, y Waitron todavía no ofrece esa
corrección. Cuando ya has elegido un cliente, su nombre y su identificador aparecen debajo de
**Factura completa**, en la zona de cobro. Al juntar cuentas, la caja pregunta antes de cambiar
el cliente de una factura completa.

El cobro de mostrador todavía no puede emitir una factura completa. Mantén el pedido del cliente
en una cuenta de mesa y usa los pagos de esa cuenta. Tramitar un pedido de mostrador por sí solo
no emite una factura.

Elige **NIF español** para un NIF, NIE o CIF. Para un pasaporte u otro documento aceptado,
elige su **Tipo de identificador**, **País emisor** y **Número de documento**. Introduce el número
tal como aparece. Puedes usar un pasaporte con una dirección española: el país emisor pertenece
al documento, independientemente de dónde viva el cliente. Una factura completa necesita un
identificador. **Cancelar** vuelve sin guardar.

Elige el país de la dirección e introduce la calle y el número y la localidad. Una dirección
española también necesita un código postal válido de cinco cifras y la provincia; ambos son
opcionales en otros países. Por ejemplo, una dirección francesa puede ser **2 Main Street**,
**París**, **Francia**, sin código postal ni provincia. No añadas el país a la calle. La factura
impresa y el ticket en la pantalla de caja muestran el país en el idioma del ticket. El detalle
del pedido lo muestra en el idioma de tu pantalla.

## Elegir un documento y una impresora {#invoice-printer}

En el ticket de una venta, elige **Imprimir/Reimprimir**. Para una factura completa, elige
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

## Evitar justificantes de tarjeta duplicados {#reader-slips}

Activa **Imprimir justificante de tarjeta** antes de cobrar si el cliente lo quiere. Empieza desactivado para cada pago e imprime cuando se confirma la tarjeta. Si la respuesta del lector no está clara o el servidor se reinicia antes de imprimir, usa una copia.

Para imprimir un pago con tarjeta antes de completar la cuenta, vuelve a **Cobrar** y elige **Imprimir una copia** junto al pago recibido en **Pagos de esta cuenta**. La copia muestra lo que quedaba pendiente cuando se cobró esa tarjeta.

Si un lector de tarjetas imprime su propio justificante de pago, abre **Pagos con tarjeta** en el
panel, edita ese lector y activa **Imprime su propio justificante automáticamente**. Después elige
**Guardar**. Waitron deja los justificantes de ese lector en manos del propio lector. Este ajuste
describe el lector; no cambia la configuración de su impresora. Empieza desactivado en un lector nuevo.

Si añades de nuevo un lector reconocido, conserva tu elección. Consulta [Lectores de tarjetas](printers.md#card-readers)
para eliminar un lector o añadirlo de nuevo. La exportación de configuración incluye la política
de pagos, pero no los lectores ni este ajuste.

Cuando Waitron imprime el justificante de tarjeta de una venta, sus palabras, fecha e importes siguen el idioma de ticket guardado con esa venta. Cambiar el idioma de tu pantalla o el idioma de ticket actual del local conserva el idioma original del justificante de la venta anterior.

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

El justificante de devolución usa por defecto el idioma de ticket de la venta original, aunque tu pantalla use otro idioma.

## Cancela un plato de una cuenta guardada del mostrador {#counter-cancel-item}

Usa × para quitar un plato que aún no has enviado. En un plato enviado, × y **Cancelar** abren
**Cancelar plato**. Elige cuántos cancelar. Si la preparación ha empezado, elige si conservas o
quitas el cobro y selecciona un motivo. Quitar ese cobro puede requerir el PIN de un supervisor.

**Atrás** deja el plato como está. Tras confirmar, la cesta se actualiza desde la cuenta guardada.
Si eliges **Descartar** en un pedido aparcado con platos enviados, el terminal abre primero ese
pedido. Cancela sus platos enviados antes de descartarlo. Si conservas el cobro de un plato
cancelado, cobra la cuenta.

## Cancelar un plato de una cuenta pagada {#cancel-paid-dish}

Cuando una mesa ha pagado un plato que no va a llegar, cancélalo para que la cocina deje de
prepararlo y el cliente pueda recuperar el dinero. Entre los platos enviados de la mesa, elige
**Cancelar…** en el menú **Más** del plato. En una cuenta pagada solo se ofrece para lo que aún no se ha servido.

La ventana **Cancelar plato** indica **Esta cuenta está pagada**. Elige **Cuántos**, hasta los que
aún no se han servido. Si el plato ha pasado a cocina pero nadie lo ha marcado como empezado,
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
título como **2 platos sin servir** los muestra, y puedes cancelarlos todos o, si alguno tiene ticket de cocina, pasar
la comida al mostrador.

Para un plato que ha pasado a cocina pero no está marcado como empezado, responde a **En
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
mostrador**. Aparece cuando al menos uno de los platos tiene ticket de cocina. No se cancela ni se
devuelve nada. Los platos en espera pasan ahora a cocina, cada cuenta cuyos platos por llegar
tienen ticket de cocina pasa a ser un pedido pagado que espera en el mostrador, y la mesa se
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

Si alguien introdujo su PIN para la cancelación, ese PIN sirve también para esta devolución, una
vez por recibo, así que nadie tiene que volver a escribirlo. Vale mientras no devuelvas más del
total de los platos ni propina. Si subes el importe o añades propina, se vuelve a pedir el PIN, y
las entradas de esos platos en el informe no muestran la devolución. Si cierras la ventana sin
devolver, el PIN también se pide la próxima vez. Una tarjeta registrada desde un datáfono aparte
siempre pide el PIN, porque allí confirma que la devolución en el datáfono se ha hecho.

Cuando el pago elegido tiene menos que el total de los platos, el importe es lo que tiene, y una
línea como **Quedan 2,00 € por devolver de otro pago** indica lo que falta. Cuenta desde el
importe de la ventana, así que también aparece, o sube, si bajas el importe. Para devolver el
resto, elige otra vez **Devolver un pago** y escoge un pago. Esa ventana no viene rellenada: escribe tú el
importe y el motivo. Si no puedes hacer devoluciones, pide el PIN, y las entradas de esos platos en
el informe no muestran esa parte. Si ese pago no se puede devolver en este dispositivo, la ventana te indica que lo
devuelvas en una caja.

Si el proveedor de pagos aún no puede hacer la devolución, este intento no ha devuelto dinero.
Puedes cerrar la ventana e iniciar una nueva devolución más tarde.

## Devolver una tarjeta en un datáfono aparte {#separate-terminal}

Para un pago con tarjeta registrado desde un datáfono aparte, Waitron te pide que lo devuelvas
primero en ese datáfono. Completa la devolución allí antes de elegir **Devuelto en el datáfono**.
Después, un supervisor o encargado aprueba su registro en Waitron con su PIN.

Si una devolución no recibe respuesta, revisa los pagos de la cuenta antes de intentarla otra vez.
La primera petición puede haberse completado.

## Marcar un paso de servicio como hecho {#service-steps}

Un paso de servicio te recuerda volver a una mesa en el momento adecuado, como **Tomar nota** un par
de minutos después de marcar **Montar mesa** como hecho, o **¿Algo más?** cuando ya se han servido
todos los platos. Cada paso empieza en un momento así y vence unos minutos después. Tu local los
configura en **Pasos de servicio**, en la pestaña **Servicio** del departamento, en el panel.

Cuando vence un paso, la tarjeta de la mesa muestra su nombre, con un botón **Hecho** si puedes
tomar pedidos. En el plano, si no hay nada más urgente, la mesa se vuelve azul con una campana y el
nombre del paso, y los detalles de la mesa muestran el paso, con **Hecho** si puedes tomar pedidos.
Una mesa muestra un paso cada vez: el último que ha vencido.

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
va con ella, y la cuenta y la cocina saben siempre qué hamburguesa es cuál.

Mientras los platos son iguales sigues viendo una sola fila, **2 × Hamburguesa**, en la cuenta y en
**Enviado**. La fila se separa en cuanto un plato cambia, por ejemplo cuando se sirve una hamburguesa
o se le aplica un descuento. Al tocar una fila en **Enviado** se marca entera como servida; **Marcar
servido** en los detalles de la fila pregunta cuántos. [**Mover platos…**](table-service.md#move-dishes) te deja
elegir cuántos platos de una fila pasan a otra cuenta, cada uno con sus extras. **Descuento** y
**Cancelar** actúan sobre la fila y te dejan elegir cuántos de sus platos. **Cambiar plato**, en los
detalles de la fila, cambia todos los platos de la fila y permite aumentar la cantidad.
Para reducirla, usa **Cancelar…**.

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
permite tu perfil; **Zonas en este dispositivo**, **Equipo**, **Idioma** y **Tema** bajo el
título **Ajustes**; **Acerca de Waitron**; **Salir**; y, mientras el local tiene un logotipo,
**Con la tecnología de Waitron** debajo.

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

## Dar a una mesa un nombre corto {#short-names}

Un móvil o una tableta muestra el nombre corto de una mesa en los botones de mesa de la barra y en
la barra Listo, donde hay poco espacio, y las tarjetas de la [pantalla de
cocina](kitchen-service.md#kitchen-screen) y del [pase](kitchen-service.md#pass-screen) nombran su
mesa por él. En el **Plano de sala** del panel, cada mesa tiene un **Nombre corto** debajo de su
**Nombre**, que se rellena a partir del nombre: «T1» para «Terraza 1», «Ven» para «Ventana», y un
nombre de cuatro caracteres o menos tal cual. Sigue al nombre hasta que escribes uno propio, de
hasta cinco caracteres, que no puede llevar «+» porque la caja lo usa para las mesas unidas. Dos
mesas del local no pueden compartir un nombre corto, aunque cambien las mayúsculas: si Guardar dice
«Terraza 1 ya usa T1», escribe otro, como «Tb1». **Añadir mesas** muestra los nombres cortos que
dará, y deja escribirlos cuando eliges nombres personalizados; **Añadir mesa unida** pide uno.

## Cambiar de cuenta {#bill-switcher}

Si se devolvió parte de un pago antes de registrar su factura, no vuelvas a cobrar.
El pedido sigue bloqueado. Comprueba el pago y sus devoluciones en el panel de SumUp antes
de decidir cuánto queda por cobrar al cliente.
Comprobarlo en SumUp no desbloquea el pedido. Waitron aún no permite liberar este bloqueo.

Es habitual que los clientes paguen por separado: dos parejas en una misma mesa, o alguien que paga
sus propias bebidas. Cada uno tiene entonces su propia cuenta en la mesa. El selector de cuentas,
arriba en la pantalla de la mesa, indica qué cuenta está en pantalla, como **Cuenta 1 · 38,50 €**, o
**Cuenta 2 · 3 cuentas · Clint · 54,00 €** cuando la mesa tiene tres. Aparece aunque la mesa tenga una sola
cuenta, así que una segunda cuenta está siempre a un toque.

En el mostrador, usa **Pedidos aparcados** para recuperar o descartar la cuenta de una mesa.
Descartar su última cuenta deja la mesa ocupada con una cuenta nueva y vacía. Para liberar la mesa,
usa **Cerrar mesa**.

Toca el selector para ver las cuentas de la mesa por orden de número. Cada fila muestra el número y
el nombre de la cuenta, lo que queda por pagar o **Pagada ✓**, y una línea como **Ana tiene un
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
**Mover esta cuenta**, **Descuento en la cuenta**, **Factura completa**, **Copia del ticket** y
**Cancelar y abonar**, cada una cuando corresponde a la cuenta.
La segunda, **Toda la mesa**, actúa sobre todos los de la mesa: **Alergias**, **Poner nombre a los
clientes**, **Comensales**, **Marcar cuenta pedida para …** con el nombre del grupo (una vez pedida,
**Anular la petición de cuenta de …**), **Separar una mesa** (cuando el grupo ocupa más de una
mesa), **Unir una mesa**, **Mover clientes** y **Cerrar mesa**. Una acción que necesita una
elección, como con qué cuenta juntar, se abre junto al pedido, y **Atrás** la cierra.

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
ticket aparecen a su lado cuando se ofrecen. Una cuenta cobrada en parte también muestra cuánto
se ha recibido y cuánto queda. El pie no tiene **Aparcar**: la cuenta ya espera en su mesa. En un
terminal de camarero, si se cobra una cuenta con factura simplificada y quedan otras,
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
una cuenta sin pagar para que la cobres, y **Registrar salida sin pagar** registra que los clientes
se fueron sin pagar.

**Registrar salida sin pagar** cancela automáticamente los platos pendientes de la cocina y envía
los tiques de cancelación. No tienes que cancelarlos uno a uno. La cuenta sigue pendiente de pago
por el importe completo.

Si un cobro consta como no cobrado, puedes volver a cobrarlo. Si su resultado no se ha confirmado,
elige **Comprobar de nuevo** para continuar ese mismo cobro antes de cobrar otro. Si no estaba
registrado, puede cobrar la tarjeta o registrar el efectivo.
Si un pago sigue pendiente, o la tarjeta ya se ha cobrado pero el pago no se ha registrado, elige
**Pagos con tarjeta / acceder**. No vuelvas a cobrar una tarjeta ya cobrada. Inicia sesión para
consultar o registrar el resultado confirmado por el proveedor. Vuelve a abrir el cobro de la
cuenta cuando esté registrado para ver el resultado. Si Pagos con tarjeta indica **Pago registrado.
Queda parte de la cuenta por cobrar.**, vuelve a abrir la cuenta y cobra solo su saldo pendiente.

Si el lector ha cobrado otro importe, compara en el aviso lo que se pidió y lo que se cobró.
Comprueba el saldo de la cuenta antes de cobrar otro pago, para cobrar solo lo que quede pendiente.

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

- **Pagado**: el plato ya está pagado, así que se queda en esta cuenta. Para moverlo, devuelve antes
  su pago.
- **Ya se han pagado 40,00 € en esta cuenta: mueve menos platos**: mover este plato, o uno más de la fila, dejaría la
  cuenta por debajo de lo que ya se ha pagado en ella. Los demás platos sí pueden pasar.

En **Mover a**, elige adónde van los platos: otra de las cuentas abiertas de la mesa, o **+ Cuenta
nueva**. Una cuenta que ya ha recibido un pago simplemente debe más después. **Mover** sigue apagado hasta que marques un plato y elijas adónde va.
Después de moverlos, una cuenta nueva se pone en pantalla; si los pasas a otra cuenta, esta sigue en
pantalla. Cada plato conserva su curso y sigue enviado, marchado o servido como estaba. Si mueves
los últimos platos sin pagar de una cuenta pagada en parte, la cuenta queda pagada del todo y se
emite su factura.

Si alguien paga un plato en otra caja mientras el panel está abierto, su fila pasa a **Pagado**
cuando la caja vuelve a leer la cuenta, y ese plato deja de estar entre los que elegiste. Si tocas
**Mover** antes, la caja rechaza el cambio con el motivo, por ejemplo **Este artículo ya está
pagado, así que no se puede cambiar, mover ni cobrar otra vez. Devuelve antes su pago**, y no se
mueve nada. Si el cambio dejara la cuenta por debajo de lo que ya se ha pagado, la caja dice cuánto
y ofrece un botón **Devolver** por ese importe. Si se rechaza el cambio porque la cuenta que
elegiste tiene un cobro o una devolución con tarjeta en curso, o porque entretanto se ha presentado
o pagado, la caja nombra esa cuenta antes del motivo, por ejemplo **Cuenta 2: Esta cuenta ya está
pagada**. Si otra persona tiene platos sin enviar en alguna de las dos cuentas, toma antes su
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
entrante. Revisa **Productos pedidos** y **Trabajo pendiente en cocina** antes de elegir **Aceptar
traspaso**. Elige la **Zona de destino** y, si hace falta, una **Mesa de destino**, y pulsa
**Guardar**. Para rechazarla, elige **Rechazar traspaso**, introduce el **Motivo del rechazo**
y pulsa **Guardar**.

## Poner nombre a una cuenta {#bill-names}

Las cuentas de unos clientes van numeradas, y la caja muestra cada una con su número y el nombre que
le pongas, como **Cuenta 2 · Clint**, y en algunos sitios con el nombre de los clientes delante,
como **4 · Cuenta 2 · Clint**. Para poner nombre a la cuenta en pantalla, por ejemplo el del cliente
que la paga, abre el menú **⋮**, elige **Poner nombre a esta cuenta**, escribe hasta 40 caracteres y
elige **Guardar**. Vacía el campo para quitar el nombre. **Poner nombre a los clientes**, en **Toda
la mesa** del mismo menú, pone nombre a todo el grupo. Si otra persona tiene platos sin enviar en la
cuenta, toma primero su pedido.

Para cambiar el nombre que ve cocina, usa **Poner nombre a los clientes**. Si queda trabajo
pendiente en cocina, sus impresoras reciben un [ticket de cambio de nombre](kitchen-service.md#party-names).

Una cuenta conserva su número mientras sigue con esos clientes. Juntar una cuenta con otra deja un
hueco: junta la Cuenta 2 con la Cuenta 1 y quedan las Cuentas 1 y 3. Una cuenta que llega de otra
mesa o del mostrador toma el siguiente número de los clientes, y también las cuentas de una mesa que
unes. Una mesa que separas con cuentas vuelve a empezar por la Cuenta 1, igual que una mesa que
se vuelve a ocupar cuando sus clientes terminan. Una cuenta conserva su nombre cuando se mueve,
también al mostrador, donde no tiene número. Solo puedes poner nombre a una cuenta en una mesa. El
nombre no se imprime en los tickets de cocina ni en los recibos.

## Ver qué mesas tienen comida lista {#ready-bar}

Cuando la cocina tiene platos listos, quieres saber a qué mesas llevarlos sin tener que ir a mirar.
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
Toca una mesa para abrirla, o toca **Abrir ›** para abrir la primera de la lista.

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

## Restablecer una zona al plano de hoy {#zone-reset}

Para deshacer los cambios de hoy en una zona, abre su menú ⋮, elige **Volver al plano …** con el nombre del plano que aparece y confirma **Restablecer**.

Después de restablecer la zona, coloca las mesas libres como aparecen en el mapa.

## Elegir el equipo de este dispositivo {#equipment}

En un TPV, elige **Más**, **Ajustes** y **Equipo**. En un dispositivo de mano, elige **Más**
y **Equipo**. En cada lista disponible, elige el equipo que quieres usar en este dispositivo,
o **Usar el predeterminado** para seguir la elección de su perfil.

Cuando aparezca **Escanear** para una impresora de tickets, una impresora de justificantes de pago
o un lector de tarjetas, usa su etiqueta de Waitron en lugar de la lista. Si eliges de la lista un
equipo que lleva otro dispositivo, confirma **Quitárselo**; al escanear lo tomas sin confirmación,
así que comprueba qué equipo estás escaneando.

## Cambiar el perfil de este dispositivo {#device-profile}

Cuando este dispositivo está aprobado para más de un perfil, **Más** (☰) ofrece **Perfil**.
Elige otro **Perfil de dispositivo** y toca **Cambiar**. Solo puedes cambiar a un perfil que
tengas permiso para usar.

Antes de cambiar, aparca o vacía el pedido en curso y espera a que termine cualquier cobro en curso.
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
el mismo perfil conserva la suya, y al cambiar de perfil vuelve la elección de ese perfil. Nunca da a
este dispositivo una zona que su perfil no permite. Si un móvil o una tableta no puede consultar su
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

Abre **Cobrar** en la cuenta de la mesa. Elige **Una cantidad**, **Dividir a partes iguales**,
**Artículos** o **Toda la cuenta**, seleccionada a la derecha. Para **Dividir a partes iguales**,
indica cuántas personas quedan por pagar. Elige efectivo o tarjeta, comprueba el importe y confirma
el cobro. Tras un pago parcial, comprueba cuánto queda y cobra al siguiente comensal. En un teléfono,
usa **Cobrar al siguiente** para continuar.

Una cuenta ya presentada para su cobro solo permite cobrar el importe completo. Cerrar la mesa es
una acción aparte, después del cobro.
