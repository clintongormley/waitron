# Avisos del terminal

Algunos problemas del servidor impiden trabajar al personal, y quien está en el terminal suele ser
el primero en notarlo. Por eso, cuando alguien ha iniciado sesión, cada caja registradora y cada
terminal de camarero muestran una línea bajo su barra superior si el servidor necesita atención. La
pantalla de inicio de sesión solo muestra la línea de que los cobros esperan a la hora del servidor;
las de fichaje y de preguntas de asistencia, ninguna. La línea dice qué ocurre y qué hacer. Nunca
tapa tu trabajo y nunca tienes que cerrarla.

Si Waitron no puede verificar este dispositivo para una acción, recarga o vuelve a abrir Waitron en este dispositivo y vuelve a intentarlo.

## Lee la línea de avisos {#notice-line}

La línea muestra primero el aviso más grave, con su texto principal y, tras " · ", su indicación.
Por ejemplo, **No se puede guardar nada: el servidor no tiene espacio · Avisa al encargado**. Una
línea roja significa que algo no se puede guardar, una ámbar que algo necesita atención pero el trabajo se sigue guardando y una
azul que es información.

Cuando hay más de un aviso, la línea termina con un número como **+1**. Toca ese número para abrir
la lista de todos los avisos, del más grave al menos grave. La lista aparece bajo la línea y
desplaza la pantalla hacia abajo, así que nunca tapa el pedido. Vuelve a tocar el número para
cerrarla.

No hay botón para cerrar un aviso. Una pantalla de cocina no muestra la línea de avisos.

## Qué significa cada aviso {#notices}

**El cajón no se abrió** significa que la solicitud caducó antes de poder enviarse. Comprueba la
alimentación y la conexión de la impresora y pulsa **Abrir cajón** si aún necesitas abrirlo. Si
se te pide, elige a alguien que pueda autorizar la apertura e introduce su PIN.

**No se puede guardar nada: el servidor no tiene espacio · Avisa al encargado** es rojo. El servidor
no tiene espacio en disco, así que no se pueden guardar pedidos, pagos ni otros cambios. El
encargado tiene que liberar espacio en el servidor, en la
[página Estado del servidor](box-status.md#free-space). Si el servidor tuvo que usar su espacio de
reserva para arrancar, el aviso sigue, también tras reiniciar, hasta que vuelven a quedar libres
unos 24 MB.

**No se pueden registrar ventas: la hora del servidor es incorrecta · Avisa al encargado** es rojo.
La hora del servidor está tan atrasada que no se puede registrar una venta para Hacienda. Hasta que
se corrija, el servidor también rechaza los cobros y las devoluciones. Un administrador puede poner
la hora desde su propio móvil u ordenador, en la [página Estado del
servidor](box-status.md#clock-behind). Justo después de que el servidor arranque, la indicación
puede decir **Comprobar la hora** en su lugar, como se explica más abajo.

**No se puede cobrar: la hora del servidor es anterior a la última venta · Avisa al encargado** es
rojo. El reloj del servidor marca más de un minuto antes que la última venta que registró. Hasta que
marque como mucho un minuto antes, o hasta que se confirme la hora del servidor, el servidor rechaza
los cobros, las devoluciones y todo lo que registraría una venta o movería dinero: cobros en
efectivo o con tarjeta, en el mostrador o en una mesa, devoluciones y reintentos de devoluciones,
registrar una cuenta sin pagar, anular un pedido que ya tiene factura, y un cambio o un envío a cocina que
terminaría de pagar una cuenta ya pagada en parte. En el panel, los encargados tampoco pueden
resolver cobros ni devoluciones atascados o retenidos.

El resto del trabajo sigue. Por ejemplo, puedes sentar mesas, tomar pedidos, enviarlos a cocina,
fichar la entrada y la salida, reimprimir un recibo e imprimir una factura que ya estaba hecha. Un
cobro rechazado deja el pedido abierto.

Cuando se rechaza un cobro, el terminal muestra la hora del servidor y la de la última venta. Si ya
has cobrado al cliente en otro datáfono, no vuelvas a cobrar: registra el pago cuando se pueda
volver a cobrar.

Abre **Pagos con tarjeta → Comparación del datáfono de reserva** para comparar los pagos anotados
de la misma cuenta con los cargos de SumUp. Comprueba en SumUp los pagos sin una coincidencia
única. Conserva el número de operación y el datáfono al anotar cada pago; esta comparación no
envía devoluciones.

Si el terminal dice que se ha cobrado con tarjeta pero el pago no se ha registrado, no vuelvas a
cobrar. Puede pasar si la hora cambia mientras el lector está cobrando la tarjeta.
Lo que hay que hacer después depende de cómo se cobró la tarjeta:

- **En el mostrador, o la cuenta de una mesa cobrada de una vez desde la cuenta presentada:** cuando se
  pueda volver a cobrar, cobra ese pedido otra vez de la misma forma. El pago se registra sin cobrar
  la tarjeta otra vez.
- **Desde la ventana Cobrar de la cuenta:** el pago queda pendiente, y el servidor lo registra por sí solo cuando
  se puede volver a cobrar.

Con internet, el servidor normalmente corrige su reloj por sí solo. Si no, un
administrador pone o confirma la hora en la [página Estado del servidor](box-status.md#clock-behind)
con su propio móvil u ordenador, nunca desde la pantalla del propio servidor. Justo después de que el
servidor arranque, cualquier empleado puede hacerlo desde una caja con **Comprobar la hora**, como se
explica más abajo. Si la hora del servidor es correcta y fue la última venta la que llevaba una hora
equivocada, dos cajas o terminales que coinciden con el servidor también reanudan los cobros, salvo
que la parada dure desde que arrancó el servidor. Nunca ponen la hora.

**Los cobros esperan: el servidor espera a que se conecten dispositivos y coincidan con su hora (0
de 2 por ahora) · Comprobar la hora** es rojo. Cuando el servidor arranca sin la hora de internet,
los cobros esperan. Vuelven a funcionar solos en cuanto dos cajas o terminales están encendidos y
conectados, aunque estén en la pantalla de inicio de sesión, y coinciden con la hora del servidor.
Si no, usa **Comprobar la hora**: mantén la hora del servidor si es correcta, o usa la de este
dispositivo si lo es esa. La pantalla de inicio de sesión muestra las mismas palabras, sin
**Comprobar la hora**: inicia sesión para usarlo.

**Comprobar la hora** al final de una línea roja de la hora, en lugar de **Avisa al encargado**,
significa que el servidor arrancó con su hora en duda y no ha podido confirmarla por sí
mismo. Termina cualquiera de las tres líneas rojas de la hora de arriba. Un cobro rechazado dice
entonces que uses **Comprobar la hora** arriba de la pantalla. Pulsa **Comprobar la hora** para
abrir su diálogo; si se muestra primero otro aviso, abre la lista y púlsalo ahí. Puede usarlo
cualquiera con la sesión iniciada en la caja.

El diálogo muestra la hora del servidor y la de esta caja. Nadie escribe una hora: lo que se envía es
la hora de la propia caja.

- Cuando las dos horas están a más de un minuto, pregunta cuál es la correcta. Pulsa **Este
  dispositivo** si la hora de la caja es la buena: el reloj del servidor se pone a esa hora y se
  puede volver a cobrar. Si la hora de la caja es más de un minuto anterior a la última venta del
  servidor, los cobros pueden pararse: si la línea roja de la hora termina entonces con **Comprobar
  la hora**, vuelve a abrirlo y pulsa **Sí**. Pulsa **El servidor** si la hora del servidor es la
  buena: cuando **Los cobros esperan** es la única línea roja de la hora, el servidor mantiene su
  hora y se puede volver a cobrar; si no, el diálogo te pide que corrijas la hora de la caja, como
  con **Las dos horas están mal**. Pulsa **Las dos horas están mal** si ninguna lo es.
- Cuando coinciden, pregunta si la hora es correcta. Pulsa **Sí** si lo es; se puede volver a
  cobrar. Pulsa **No** si no lo es.

Si el diálogo te pide que corrijas la hora de la caja, corrígela en los ajustes de la propia caja y
vuelve a abrir **Comprobar la hora**: el diálogo lee de nuevo la hora de la caja cada vez que se abre.

Se avisa a quienes gestionan el sistema cuando el reloj del servidor se pone en hora desde una
caja. Si el
servidor se niega, el diálogo dice por qué encima de sus botones y, cuando volver a intentarlo puede
servir, ofrece **Comprobar otra vez**. Si el [arranque](box-status.md#clock-at-start) del servidor termina con el
diálogo abierto, y internet ha confirmado la hora del servidor, un empleado ya no puede poner el reloj en hora desde una caja: el diálogo lo dice y
ofrece **Acceso de administrador**, para que un administrador inicie sesión ahí con su PIN y ponga
la hora desde la misma caja.

**Queda poco espacio en el servidor · Avisa al encargado** es ámbar. El trabajo se sigue guardando,
pero se está acabando el espacio. El encargado debería liberar espacio antes de que se acabe, en
la [página Estado del servidor](box-status.md#free-space).

**12 ventas sin enviar a Hacienda · Se reintenta solo** es azul. El envío de ventas a Hacienda ha
fallado y el servidor sigue intentándolo por sí solo. Las ventas están registradas en el servidor, así
que puedes seguir vendiendo. Una venta que necesita que una persona la resuelva no se reintenta,
así que mientras alguna de las ventas pendientes lo necesite, la indicación dice **Avisa al
encargado**.

**Impresora «Cocina» no imprime · desde 21:16** es ámbar. Una comanda enviada a esa impresora a
las 21:16 lleva dos minutos o más sin imprimirse, o el servidor ha dejado de intentar enviarla. El
aviso de una impresora de cocina aparece en todas las cajas registradoras y todos los terminales de
camarero; el de cualquier otra impresora, solo en los que imprimen en ella sus recibos, sus
justificantes de pago o sus facturas completas. Revisa el papel, la corriente y el cable de la
impresora. El aviso desaparece cuando la impresora imprime algo que se le envió después de esa
comanda. Si esa comanda nunca llegó a imprimirse, las cajas muestran entonces **Impresora «Cocina»:
no pudo imprimir un ticket · Vuelve a imprimirlo** en ámbar hasta que se reimprima desde la mesa o
se reenvíe desde **Impresoras**.

**El servidor necesita atención · Avisa al encargado** es un aviso para el que este terminal no tiene
texto, quizá de una versión más reciente del servidor. Avisa al encargado para que revise el servidor.

## Cuando se detiene la facturación por un conflicto de identidad {#invoice-conflict}

Elige **Abrir recuperación** junto al rechazo para abrir la recuperación de este servidor en otra
pestaña. Conserva la ventana de pago. Si indica que la tarjeta ya se ha cobrado, no vuelvas a
cobrar. Usa la clave del servidor actual y sigue
[Recuperar una identidad de facturación](box-status.md#invoice-conflict).
Puedes cerrar la ventana de pago sin iniciar una recuperación. El cambio de identidad conserva
los resultados de envío y las incidencias existentes.

## Cuando este servidor ya no es el servidor principal {#not-main-server}

Cuando la caja diga **Este servidor ya no es el servidor principal**, espera a que pase al
servidor principal y vuelve a intentarlo. Si ya has cobrado con tarjeta en el datáfono, devuelve
antes el importe ahí.
