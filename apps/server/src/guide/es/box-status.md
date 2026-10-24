# Estado del equipo

**Estado del equipo** muestra en una sola página si cada parte del equipo funciona: las ventas,
Hacienda, la copia en el bucket, las impresoras, los lectores de tarjetas, el reloj y el espacio en
disco. También es donde se libera espacio cuando el disco del equipo se llena. Para leer el
registro del equipo, usa **Diagnóstico**.

## Abre la página {#open}

Abre **Ajustes → Estado del equipo**, justo encima de **Diagnóstico**. Solo la ven las personas
que pueden gestionar el sistema.

La página vuelve a leer el equipo más o menos cada 15 segundos, así que puedes dejarla abierta.
Estas lecturas automáticas no cuentan como actividad, así que tener la página abierta no mantiene
tu sesión iniciada.

En un equipo que solo guarda una copia de solo lectura de otro equipo, el botón **Liberar** no se puede
pulsar, y la página explica por qué bajo **Espacio en disco**.

## Lee las filas {#rows}

Cada parte tiene una fila con un punto de color:

- **Verde** significa que la parte está bien.
- **Ámbar** significa que necesita atención, pero todo sigue funcionando.
- **Rojo** significa que algo no se puede guardar: el disco está lleno, la hora del equipo es tan
  incorrecta que no se puede registrar una venta, o no se puede cobrar porque la hora del equipo es
  anterior a la última venta. Cualquiera de ellos pone también en rojo **Ventas**.

Cada fila muestra los mismos avisos que la campana para esa parte, con las mismas palabras. Las
filas **Copia en el bucket**, **Impresoras** y **Lectores de tarjetas** tienen un botón **Ir a …**,
como **Ir a Copias de seguridad**, que abre su propia página cuando puedes abrirla, y un aviso que
tiene su propia página añade un botón para esa página. Los avisos que no corresponden a ninguna fila
se cuentan bajo las filas, junto a **Ver todos los avisos**.

Cuando no pasa nada, cada fila dice:

- **Ventas**: **Se registran con normalidad**, y cuándo fue la última venta.
- **Hacienda**: **Se envían con normalidad**, y cuándo aceptó Hacienda registros del equipo por
  última vez (la hora, según el reloj del equipo, en que el equipo empezó esa ronda de envío). Un
  equipo que no envía registros a Hacienda lo dice.
- **Copia en el bucket**: **Al día**, y cuándo se confirmó el último envío. Dice **No
  configurada** cuando no hay ninguna copia configurada, y cuántos minutos de retraso lleva
  cuando se retrasa.
- **Impresoras**: **Sin problemas**, y los nombres de las impresoras configuradas.
- **Lectores de tarjetas**: **Sin problemas**, y los nombres de los lectores configurados. Un
  lector que su proveedor de tarjetas da como sin conexión aparece aquí, como **«Barra» está sin
  conexión.** Mientras la campana o esta página están abiertas, el equipo pregunta al proveedor como
  mucho cada cinco minutos, así que puede aparecer con unos minutos de retraso. Esta fila no aparece
  cuando los pagos con tarjeta están desactivados.
- **Reloj**: **Correcto**, y cuándo comparó el equipo su hora con la de Hacienda por última vez.
  Cuando no tiene una comparación válida, por ejemplo justo después de arrancar el equipo, dice
  **Aún no se ha comparado con Hacienda**.
- **Espacio en disco**: cuánto espacio queda libre del total, y cuánto ocupan la base de datos,
  las copias guardadas en el equipo, los registros de actividad y el resto del disco.

Después de que falle un envío a Hacienda, la fila **Hacienda** dice cuántos registros esperan, y si
el equipo los reintenta solo o el encargado tiene que resolver alguno.

Si no se han podido leer los avisos, la página sigue mostrando todas las filas y avisa de que una
parte puede parecer bien aunque no lo esté. Si algunas comprobaciones no se han podido hacer, la
página avisa de que puede no mostrar todos los problemas.

## Vuelve a intentar los registros que esperan {#retry-now}

En un equipo que envía registros a Hacienda, la fila **Hacienda** tiene un botón **Reintentar
ahora**. Después de un envío fallido, el equipo hace una pausa antes de volver a intentar los
registros que esperan. **Reintentar ahora** los vuelve a intentar sin esperar a que acabe esa
pausa. Solo se puede pulsar mientras la fila dice que hay registros sin enviar.

Después de pulsarlo, la fila dice cuántos registros se volverán a intentar. Puede que no salgan
enseguida: Hacienda pide una espera entre dos envíos, y los registros se intentan cuando permite el
siguiente envío, salvo que un lote completo de 1.000 registros puede salir enseguida. Si el equipo
sigue sin poder conectar con Hacienda, vuelven a esperar.

Mientras el equipo no tenga el certificado de la AEAT, no se envía nada, así que **Reintentar
ahora** no se puede pulsar y la fila explica por qué. Instala el certificado en **Ajustes del
local**. El equipo lo vuelve a intentar en cinco minutos como mucho, y después el botón se puede
pulsar mientras sigan quedando registros sin enviar.

Los registros parados después de que Hacienda rechazara varios seguidos por el mismo motivo no se
liberan con **Reintentar ahora**. El equipo sigue intentando el primero de ellos cada hora, y el
aviso de la campana explica por qué se pararon.

## Libera espacio en el equipo {#free-space}

El botón **Liberar** de la fila **Espacio en disco** muestra cuánto puede liberar antes de que lo
pulses, por ejemplo **Liberar 120 MB**. Cuando no hay casi nada que liberar, dice **Nada que
liberar** y no se puede pulsar.

**Liberar** solo borra archivos que el equipo ya no necesita:

- informes de fallos de hace más de una semana
- registros de actividad anteriores a los dos más recientes
- lo que dejó una copia de seguridad que se interrumpió a medias

Nunca toca las ventas, los ajustes ni tus copias de seguridad. Cuando termina, la página dice
cuánto ha liberado.

Mientras se está haciendo una copia de seguridad, **Liberar** no toca la carpeta de trabajo de las
copias, ni siquiera lo que dejó en ella una copia interrumpida, y la página dice que esos archivos
no se cuentan.

Al final, la página siempre explica cómo ganar más espacio: guardar menos copias en el equipo, en la
página **Copias de seguridad**, o pedir a quien instaló el equipo que borre versiones anteriores
de Waitron o ponga un disco mayor. Los tamaños bajo **Espacio en disco** muestran qué está
llenando el disco.

## Cuando el equipo no tiene espacio {#out-of-space}

Cuando el disco está lleno, no se puede guardar nada: los terminales no pueden guardar pedidos,
pagos ni otros cambios, y muestran **No se puede guardar nada: el equipo no tiene espacio**. En
esta página, **Ventas** y **Espacio en disco** se ponen en rojo.

Pulsa **Liberar** para liberar espacio. En cuanto hay espacio suficiente, los terminales vuelven a
poder guardar por sí solos; no hace falta reiniciar nada.

Después de pulsar **Liberar**, esta página y la campana de avisos del mismo panel vuelven a leer
el equipo en ese momento. Una campana abierta en otro ordenador se pone al día en un minuto, más o
menos.

Si **Liberar** no libera bastante, sigue la línea del final de la página sobre cómo ganar más
espacio.

## Cuando se paran los cobros por la hora {#clock-behind}

Cuando el reloj del equipo marca más de un minuto antes que la última venta registrada en el equipo,
el equipo deja de cobrar y de devolver dinero. Una venta registrada en ese momento llevaría una hora
anterior a esa última. La parada dura hasta que el reloj marca como mucho un minuto antes que esa
venta, o hasta que alguien reanuda los cobros, como explica esta sección más abajo. Tomar pedidos,
la cocina y los fichajes siguen funcionando, aunque se rechazan un cambio o un envío a cocina que
terminaría de pagar una cuenta pagada en parte, y anular un pedido que ya tiene factura. La [guía de
avisos del terminal](till-notices.md#notices) explica qué puede y qué no puede hacer el personal
mientras tanto.

Los terminales muestran **No se puede cobrar: la hora del equipo es anterior a la última venta**. La
campana de avisos también lo dice, con las dos horas: la del reloj del equipo y la de la última
venta. En esta página, **Ventas** y **Reloj** se ponen en rojo con las mismas palabras que los
terminales, y la fila **Reloj** añade qué hacer: **Conecta el equipo a internet para que corrija la
hora, o llama a quien lo instaló.** Cuando el equipo puede saberlo, la fila dice también si **Se
pone en hora por internet**.

Hay tres salidas:

- **Poner la hora bien.** En un equipo que se pone en hora por internet, conectarlo a internet le
  permite corregir la hora por sí solo. Si no, llama a quien instaló el equipo: el equipo no tiene
  ninguna página para cambiar su hora. Esto termina la parada salvo que la última venta lleve una
  hora equivocada, posterior a la real.
- **Reanudar los cobros**, cuando la hora del equipo es correcta y fue la última venta la que se
  registró con una hora equivocada, posterior a la real, por ejemplo mientras el reloj iba
  adelantado. Los párrafos que siguen a esta lista explican cuándo lo ofrece la página.
- **Esperar.** En cuanto el reloj del equipo llega a un minuto antes de la hora de la última venta,
  el equipo vuelve a cobrar.

Cuando la página tiene una prueba reciente de que la hora del equipo es correcta, la fila **Reloj**
muestra esa prueba y un botón **Reanudar los cobros**. La prueba es una de estas:

- **Hacienda: coincide (comprobado 2026-10-23 21:40)**: durante una parada, un equipo que envía
  registros a Hacienda le pide su hora cada minuto, y su respuesta estaba a menos de un minuto del
  reloj del equipo.
- **Dispositivos: 2 marcan 2026-10-23 21:40**: dos o más cajas registradoras o terminales de
  camarero enviaron una hora a menos de un minuto de la del equipo. La [sección
  siguiente](box-status.md#clock-witnesses) explica qué dispositivos envían su hora.

Solo cuenta una prueba tomada mientras el reloj del equipo marcaba más de un minuto por detrás de la
última venta, y solo durante cinco minutos. Tampoco cuenta una prueba tomada antes de un cambio en el
reloj del equipo.

La página no ofrece reanudar, y explica por qué bajo la fila **Reloj**, cuando:

- no hay ninguna prueba reciente: **No hay ninguna prueba reciente de que la hora del equipo sea
  correcta.**
- dos o más dispositivos coinciden entre sí en que el reloj del equipo va desviado más de un minuto,
  o Hacienda no ha coincidido con él mientras el reloj del equipo marcaba más de un minuto por
  detrás de la última venta. El equipo solo guarda ese desacuerdo en su memoria, así que lo olvida si el propio equipo se
  reinicia durante la parada; mientras Hacienda siga sin coincidir, el bloqueo vuelve con su
  siguiente respuesta, que un equipo que envía registros a Hacienda pide más o menos una vez por
  minuto durante una parada: **Otros relojes dicen que la hora del equipo está mal.**
- el reloj del equipo va más de 24 horas por detrás de la última venta: **La hora del equipo está
  más de 24 horas por detrás de la última venta.**

Solo las personas que pueden gestionar el sistema pueden reanudar los cobros. Al pulsar **Reanudar
los cobros** se abre un diálogo que muestra la hora del reloj del equipo, la de la última venta y la
prueba. Pulsa **Reanudar los cobros** en el diálogo para confirmarlo. Si dos personas confirman casi
a la vez, solo se reanuda una vez, y la segunda persona ve la primera reanudación.

Después de reanudar, el equipo vuelve a cobrar en ese momento. No cambia ninguna venta ya
registrada. La siguiente venta lleva la hora del reloj del equipo, así que se registra con una hora
anterior a la de la última venta. La fila **Reloj** se pone en ámbar y dice quién reanudó los cobros
y cuándo, por ejemplo **Cobros reanudados por Ana el 2026-10-23 21:42**, y la campana guarda un
aviso con el nombre de esa persona, las dos horas y la prueba.

Una reanudación admite un solo paso atrás. Si el reloj del equipo vuelve a retroceder, de modo que
marca más de un minuto más atrás que cuando se reanudó, o más de un minuto antes que una venta hecha
desde la reanudación, los cobros se vuelven a parar. Pasa igual aunque el reloj retroceda poco a
poco. La página ya no ofrece otra reanudación. En su lugar, la fila **Reloj** dice **Ya se
reanudaron los cobros y la hora del equipo ha retrocedido desde entonces. Haz que revisen la
hora.**

Si el equipo descubre más tarde que el reloj en el que se confió al reanudar estaba mal, porque la
hora de Hacienda no coincide con él o el reloj salta hacia delante más de un minuto, y se hicieron
ventas con esa reanudación, la campana lo dice: **Las ventas registradas entre 2026-10-23 21:42 y
2026-10-23 22:15 se fecharon con un reloj que resultó estar mal. Quedan como se registraron;
consúltalo con tu asesor.** Las horas de ese aviso se fijan cuando aparece, así que las ventas
hechas después no se añaden a él.

No hace falta reiniciar el equipo ni los terminales. Cada cobro se comprueba en el momento de
hacerlo, así que en cuanto el reloj marca como mucho un minuto antes que la última venta, el
siguiente cobro ya no se rechaza por la hora. El aviso de los terminales y las filas en rojo de esta
página desaparecen en unos 15 segundos. La campana, y el aviso de la campana que aparece bajo la
fila **Reloj**, desaparecen en un minuto, más o menos.

Una tarjeta cobrada desde las opciones de pago de una cuenta justo cuando se paran los cobros puede
aparecer en la campana como un pago con tarjeta que Waitron no ha podido registrar. El equipo
registra ese pago por sí solo cuando se puede volver a cobrar, pero el aviso sigue en la campana
hasta que un encargado pulsa **Marcar como resuelto** en él.

Si el reloj marca una fecha anterior al 28 de octubre de 2024, los terminales muestran en su lugar
**No se pueden registrar ventas: la hora del equipo es incorrecta**, y la campana también lo dice,
con la fecha que marca el reloj del equipo. Entonces la página no ofrece **Reanudar los cobros**. La
salida es poner la hora bien.

## Dispositivos como testigos de la hora {#clock-witnesses}

Un equipo no puede saber por sí solo que su reloj está mal, así que lo compara con otros relojes.
Las cajas registradoras y los terminales de camarero envían su propia hora al equipo cada 15
segundos, más o menos, mientras hay alguien con la sesión iniciada en ellos. Las pantallas de cocina
no envían la suya.

Cuando dos o más dispositivos coinciden entre sí en que el reloj del equipo va desviado más de un
minuto, la campana avisa a las personas que pueden gestionar el sistema, estén parados o no los
cobros: **2 dispositivos coinciden en que marcan 2026-10-23 21:40, pero el equipo marca 2026-10-23
21:10. Comprueba la fecha y la hora del equipo en Estado del equipo.** El personal de los terminales
no ve nada de esto.

Esas mismas lecturas son la prueba de los dispositivos que la página necesita antes de ofrecer
**Reanudar los cobros**, como explica [Cuando se paran los cobros por la
hora](box-status.md#clock-behind).

## Correos sobre el equipo {#emails}

El equipo envía un correo a todas las personas que pueden gestionar el sistema y tienen dirección de
correo cuando:

- a su disco le quedan unos 2 GB libres o menos;
- su disco está lleno, así que no se puede guardar nada;
- su reloj marca una fecha anterior al 28 de octubre de 2024, así que no se puede registrar ninguna
  venta;
- su reloj marca una hora anterior a la de su última venta, así que se han parado los cobros.

Cada persona recibe un correo por problema, en su propio idioma, o en el del local si no ha elegido
ninguno. Si no se puede enviar, porque el equipo no tiene internet o el servidor de correo lo
rechaza (por ejemplo, porque los ajustes del servidor de correo tienen una contraseña equivocada),
el equipo lo vuelve a intentar cada minuto mientras dura el problema, hasta que el servidor de
correo lo acepta. Así, el correo llega en cuanto se arregla la conexión o los ajustes. Si el
problema termina antes, por ejemplo porque se puso bien la hora, el equipo deja de intentarlo y no
envía nada. Un disco lleno al que solo se le libera parte del espacio sigue casi sin espacio, así
que quien no recibió el correo de disco lleno recibe en su lugar el de poco espacio. Un reinicio mientras dura el problema puede enviar el mismo correo
otra vez. Mientras no haya ningún servidor de correo configurado, no se envía nada.

Un equipo cuyo reloj marca una fecha anterior al 28 de octubre de 2024 normalmente no puede enviar
su correo: con una fecha tan temprana no puede comprobar el certificado del servidor de correo.
