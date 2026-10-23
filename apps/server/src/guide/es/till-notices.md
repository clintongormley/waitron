# Avisos del terminal

Algunos problemas del equipo impiden trabajar al personal, y quien está en el terminal suele ser
el primero en notarlo. Por eso, cuando alguien ha iniciado sesión, cada caja registradora y cada
terminal de camarero muestran una línea bajo su barra superior si el equipo necesita atención. La
línea no aparece en las pantallas de inicio de sesión, de fichaje ni de preguntas de asistencia.
Dice qué ocurre y qué hacer. Nunca tapa tu trabajo y nunca tienes que cerrarla.

## Lee la línea de avisos {#notice-line}

La línea muestra primero el aviso más grave, con su texto principal y, tras " · ", su indicación.
Por ejemplo, **No se puede guardar nada: el equipo no tiene espacio · Avisa al encargado**. Una
línea roja significa que algo no se puede guardar, una ámbar que se acerca un problema y una
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
[página Estado del equipo](box-status.md#free-space).

**No se pueden registrar ventas: la hora del equipo es incorrecta · Avisa al encargado** es rojo.
La hora del equipo está tan atrasada que no se puede registrar una venta para Hacienda. El
encargado tiene que corregir la hora.

**No se puede cobrar: la hora del equipo es anterior a la última venta · Avisa al encargado** es
rojo. El reloj del equipo marca más de un minuto antes que la última venta que registró, y una
venta registrada ahora llevaría una hora anterior a esa. Por eso, hasta que la hora sea correcta, el
equipo rechaza todo lo que cobra o devuelve dinero: cobros en efectivo o con tarjeta, en la barra o
en una mesa, devoluciones y reintentos de devoluciones, una mesa que se va sin pagar, anular un
pedido que ya tiene factura, y un cambio o un envío a cocina que terminaría de pagar una cuenta ya
pagada en parte.

Todo lo demás sigue funcionando. Puedes sentar mesas, tomar pedidos, enviarlos a cocina, fichar la
entrada y la salida, reimprimir un recibo e imprimir una factura que ya estaba hecha. Un cobro
rechazado deja el pedido abierto.

Cuando se rechaza un cobro, el terminal muestra la hora del equipo y la de la última venta. Si ya
has cobrado al cliente en otro datáfono, no vuelvas a cobrar: registra el pago cuando se arregle la
hora. Si un lector de tarjetas cobró la tarjeta justo cuando se pararon los cobros, el terminal dice
que se ha cobrado pero la venta no se ha registrado. No vuelvas a cobrar. Cuando la hora sea
correcta, pulsa **Cobrar** en ese pedido: el pago se registra sin cobrar la tarjeta otra vez.

El encargado lo resuelve en la [página Estado del equipo](box-status.md#clock-behind).

**Queda poco espacio en el equipo · Avisa al encargado** es ámbar. El trabajo se sigue guardando,
pero se está acabando el espacio. El encargado debería liberar espacio antes de que se acabe, en
la [página Estado del equipo](box-status.md#free-space).

**12 ventas sin enviar a Hacienda · Se reintenta solo** es azul. El envío de ventas a Hacienda ha
fallado y el equipo sigue intentándolo por sí solo. Las ventas están registradas en el equipo, así
que puedes seguir vendiendo. Una venta que necesita que una persona la resuelva no se reintenta,
así que mientras alguna de las ventas pendientes lo necesite, la indicación dice **Avisa al
encargado**.

**El equipo necesita atención · Avisa al encargado** es un aviso para el que este terminal no tiene
texto, quizá de una versión más reciente del equipo. Avisa al encargado para que revise el equipo.
