# Avisos del terminal

Algunos problemas del equipo impiden trabajar al personal, y quien está en el terminal suele ser
el primero en notarlo. Por eso, cuando alguien ha iniciado sesión, cada caja registradora y cada
terminal de camarero muestran una línea bajo su barra superior si el equipo necesita atención. La
línea no aparece en las pantallas de inicio de sesión, de fichaje ni de preguntas de asistencia.
Dice qué ocurre y qué hacer. Nunca tapa tu trabajo y nunca tienes que cerrarla.

## Lee la línea de avisos {#notice-line}

La línea muestra primero el aviso más grave, con su texto principal y, tras " · ", su indicación.
Por ejemplo, **No se puede guardar nada: el equipo no tiene espacio · Avisa al encargado**. Una
línea roja significa que algo no se puede guardar, una ámbar que algo necesita atención pero el trabajo se sigue guardando y una
azul que es información.

Cuando hay más de un aviso, la línea termina con un número como **+1**. Toca la línea para abrir
la lista de todos los avisos, del más grave al menos grave. La lista aparece bajo la línea y
desplaza la pantalla hacia abajo, así que nunca tapa el pedido. Vuelve a tocar la línea para
cerrarla.

No hay botón para cerrar un aviso. El aviso desaparece solo cuando el equipo deja de tener el
problema. Una pantalla de cocina no muestra la línea de avisos.

## Qué significa cada aviso {#notices}

**No se puede guardar nada: el equipo no tiene espacio · Avisa al encargado** es rojo. El equipo
no tiene espacio en disco, así que no se pueden guardar pedidos, pagos ni otros cambios. El
encargado tiene que liberar espacio en el equipo, en la
[página Estado del equipo](box-status.md#free-space). Si el equipo tuvo que usar su espacio de
reserva para arrancar, el aviso sigue, también tras reiniciar, hasta que vuelven a quedar libres
unos 24 MB.

**No se pueden registrar ventas: la hora del equipo es incorrecta · Avisa al encargado** es rojo.
La hora del equipo está tan atrasada que no se puede registrar una venta para Hacienda. Hasta que
se corrija, el equipo también rechaza los cobros y las devoluciones. Un administrador puede poner
la hora desde su propio móvil u ordenador, en la [página Estado del
equipo](box-status.md#clock-behind). Justo después de que el equipo arranque, la indicación puede
decir **Comprobar la hora** en su lugar, como se explica más abajo.

**No se puede cobrar: la hora del equipo es anterior a la última venta · Avisa al encargado** es
rojo. El reloj del equipo marca más de un minuto antes que la última venta que registró. Hasta que
marque como mucho un minuto antes, o hasta que se confirme la hora del equipo, el equipo rechaza
los cobros, las devoluciones y todo lo que registraría una venta o movería dinero: cobros en
efectivo o con tarjeta, en la barra o en una mesa, devoluciones y reintentos de devoluciones, una
mesa que se va sin pagar, anular un pedido que ya tiene factura, y un cambio o un envío a cocina que
terminaría de pagar una cuenta ya pagada en parte. En el panel, los encargados tampoco pueden
resolver cobros ni devoluciones atascados o retenidos.

El resto del trabajo sigue. Por ejemplo, puedes sentar mesas, tomar pedidos, enviarlos a cocina,
fichar la entrada y la salida, reimprimir un recibo e imprimir una factura que ya estaba hecha. Un
cobro rechazado deja el pedido abierto.

Cuando se rechaza un cobro, el terminal muestra la hora del equipo y la de la última venta. Si ya
has cobrado al cliente en otro datáfono, no vuelvas a cobrar: registra el pago cuando se pueda
volver a cobrar.

Si el terminal dice que se ha cobrado con tarjeta pero la venta no se ha registrado, no vuelvas a
cobrar. Puede pasar cuando un lector de tarjetas cobra una tarjeta justo cuando se paran los cobros.
Lo que hay que hacer después depende de cómo se cobró la tarjeta:

- **En la barra, o la cuenta de una mesa cobrada de una vez desde la cuenta presentada:** cuando se
  pueda volver a cobrar, cobra ese pedido otra vez de la misma forma. El pago se registra sin cobrar
  la tarjeta otra vez.
- **Desde las opciones de pago de la cuenta (Toda la cuenta, Pagar artículos, Aportar una cantidad o
  Dividir a partes iguales):** el pago queda pendiente, y el equipo lo registra por sí solo cuando
  se puede volver a cobrar.

Con internet, el equipo normalmente corrige su reloj por sí solo. Si no, un
administrador pone o confirma la hora en la [página Estado del equipo](box-status.md#clock-behind)
con su propio móvil u ordenador, nunca desde la pantalla del propio equipo. Justo después de que el
equipo arranque, cualquier empleado puede hacerlo desde una caja con **Comprobar la hora**, como se
explica más abajo. Si la hora del equipo es correcta y fue la última venta la que llevaba una hora
equivocada, dos cajas o terminales que coinciden con el equipo también reanudan los cobros, salvo
que la parada dure desde que arrancó el equipo. Nunca ponen la hora.

**Comprobar la hora** al final de una línea roja de la hora, en lugar de **Avisa al encargado**,
significa que el equipo acaba de arrancar con su hora en duda y no ha podido obtener la hora de
Hacienda. Termina cualquiera de las dos líneas rojas de la hora de arriba. Un cobro rechazado dice
entonces que uses **Comprobar la hora** arriba de la pantalla. Pulsa **Comprobar la hora** para
abrir su diálogo; si se muestra primero otro aviso, abre la lista y púlsalo ahí. Puede usarlo
cualquiera con la sesión iniciada en la caja.

El diálogo muestra la hora del equipo y la de esta caja. Nadie escribe una hora: lo que se envía es
la hora de la propia caja, así que si la hora de la caja también está mal, corrígela primero en los
ajustes de la caja y vuelve a comprobarlo.

- Cuando las dos horas están a más de un minuto, pregunta **¿Usar la hora de este dispositivo?**
  Pulsa **Usar la hora de este dispositivo** para poner el reloj del equipo a la hora de la caja; se
  puede volver a cobrar. Pulsa **Ahora no** para dejarlo.
- Cuando coinciden, te pide que confirmes que la hora del equipo es correcta. Pulsa **La hora es
  correcta** si lo es; se puede volver a cobrar con el reloj del equipo. Pulsa **Ahora no** para
  dejarlo.

En los dos casos, se avisa a todos los encargados de quién confirmó la hora y desde qué caja. Si el
equipo se niega, el diálogo dice por qué encima de sus botones y, cuando volver a intentarlo puede
servir, ofrece **Comprobar otra vez**. Si el [arranque](box-status.md#clock-at-start) del equipo termina con el
diálogo abierto, un empleado ya no puede poner el reloj en hora desde una caja: el diálogo lo dice y
ofrece **Acceso de administrador**, para que un administrador inicie sesión ahí con su PIN y ponga
la hora desde la misma caja.

**Queda poco espacio en el equipo · Avisa al encargado** es ámbar. El trabajo se sigue guardando,
pero se está acabando el espacio. El encargado debería liberar espacio antes de que se acabe, en
la [página Estado del equipo](box-status.md#free-space).

**12 ventas sin enviar a Hacienda · Se reintenta solo** es azul. El envío de ventas a Hacienda ha
fallado y el equipo sigue intentándolo por sí solo. Las ventas están registradas en el equipo, así
que puedes seguir vendiendo. Una venta que necesita que una persona la resuelva no se reintenta,
así que mientras alguna de las ventas pendientes lo necesite, la indicación dice **Avisa al
encargado**.

**Impresora «Cocina» no imprime · desde 21:16** es ámbar. Una comanda enviada a esa impresora a
las 21:16 lleva dos minutos o más sin imprimirse, o el equipo ha dejado de intentar enviarla. El
aviso de una impresora de cocina aparece en todas las cajas registradoras y todos los terminales de
camarero; el de cualquier otra impresora, solo en los que imprimen en ella sus recibos, sus
justificantes de pago o sus facturas completas. Revisa el papel, la corriente y el cable de la
impresora. El aviso desaparece cuando la impresora imprime algo que se le envió después de esa
comanda; puede que haya que reimprimir la comanda desde la mesa o reenviarla desde **Impresoras**.

**El equipo necesita atención · Avisa al encargado** es un aviso para el que este terminal no tiene
texto, quizá de una versión más reciente del equipo. Avisa al encargado para que revise el equipo.
