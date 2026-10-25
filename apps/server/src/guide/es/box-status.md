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
venta, o hasta que algo confirma que la hora del equipo es correcta, como explica esta sección más
abajo. Tomar pedidos, la cocina y los fichajes siguen funcionando, aunque se rechazan un cambio o un
envío a cocina que terminaría de pagar una cuenta pagada en parte, y anular un pedido que ya tiene
factura. La [guía de avisos del terminal](till-notices.md#notices) explica qué puede y qué no puede
hacer el personal mientras tanto.

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
- **Confirmar la hora del equipo**, cuando la hora del equipo es correcta y fue la última venta la
  que se registró con una hora equivocada, posterior a la real, por ejemplo mientras el reloj iba
  adelantado. Normalmente el equipo lo hace solo, como explican los párrafos que siguen a esta
  lista.
- **Esperar.** En cuanto el reloj del equipo llega a un minuto antes de la hora de la última venta,
  el equipo vuelve a cobrar.

Un equipo no puede saber por sí solo si su reloj está bien, así que durante una parada busca otro
reloj que coincida con el suyo. Cualquiera de estos confirma la hora, y entonces los cobros se
reanudan. Las dos primeras no necesitan que nadie pulse nada:

- **La hora de Hacienda.** Durante una parada, un equipo que envía registros a Hacienda le pide su
  hora más o menos una vez por minuto. Una respuesta a menos de un minuto del reloj del equipo la
  confirma. La fila **Reloj** lo muestra como **Hacienda: coincide (comprobado 2026-10-23 21:40)**.
- **Dos cajas o terminales** con direcciones de red distintas, cuya hora está a menos de un minuto
  de la del equipo y de la del otro. La fila lo muestra como **Dispositivos: 2 marcan 2026-10-23
  21:40**. La [sección siguiente](box-status.md#clock-witnesses) explica qué dispositivos cuentan.
- **El propio móvil u ordenador de un administrador**, como explican los párrafos siguientes.

Solo cuenta una hora tomada cuando el reloj del equipo ya marcaba más de un minuto por detrás de la
última venta, y solo durante cinco minutos. Tampoco cuenta una hora tomada antes de un cambio en el
reloj del equipo. No hay límite de cuánto puede ir el reloj del equipo por detrás de la última
venta.

Mientras el equipo espera, la fila **Reloj** dice **Esperando una prueba de que la hora es correcta:
la de Hacienda (si el equipo le envía registros), o la de dos cajas o terminales.** Cuando llega la
prueba, dice **Hay prueba: los cobros se reanudan en unos segundos.**, y el equipo vuelve a cobrar
en unos 15 segundos.

A veces los otros relojes dicen lo contrario: dos o más cajas o terminales coinciden entre sí en que
el reloj del equipo va desviado más de un minuto, o la hora de Hacienda no coincide con él durante
la parada. Entonces la fila muestra cada reloj que no coincide, por ejemplo **Hacienda: no coincide
(comprobado 2026-10-23 21:12)** o **Barra: no coincide (marcó 2026-10-23 21:13)**, y dice **Otros
relojes dicen que la hora del equipo está mal.** Un reloj que ha respondido de las dos formas
aparece una sola vez, con su última respuesta. Nada puede confirmar la hora, ni siquiera un
administrador. La respuesta de Hacienda cuenta primero: cuando
coincide con el equipo, los dispositivos que no coinciden no paran los cobros. El equipo solo guarda
el desacuerdo de Hacienda en su memoria, así que lo olvida si el propio equipo se reinicia durante
la parada; mientras Hacienda siga sin coincidir, vuelve con la siguiente respuesta.

Cuando no llega ninguna prueba, por ejemplo porque el equipo no tiene internet y hay menos de dos
cajas en uso, un administrador puede confirmar la hora desde esta página en su propio móvil u
ordenador. Durante una parada, la fila **Reloj** muestra a los administradores un botón
**Comprobar con la hora de este dispositivo**. Abre un diálogo que muestra las dos horas: **El reloj
del equipo marca … Este dispositivo marca …**

- Cuando las dos están a menos de un minuto, contando la mitad del tiempo que tardó el equipo en
  responder, el diálogo pregunta **Coinciden. ¿Confirmas que la hora del equipo es correcta?** Pulsa
  **Confirmar** y los cobros se reanudan.
- Si no, dice **El equipo no ha podido comprobar que su hora está a menos de un minuto de la de tu
  dispositivo. Comprueba que tu dispositivo tiene la hora bien; si la tiene, conecta el equipo a
  internet para que corrija la hora.** y solo ofrece **Cerrar**. Por el tiempo que tarda la
  respuesta, dos horas separadas por algo menos de un minuto también pueden recibir este mensaje.

Al pulsar **Confirmar**, el equipo vuelve a leer su hora y vuelve a comparar las dos. Si no puede
comprobar que coinciden, el diálogo muestra las horas nuevas con el mismo mensaje y solo **Cerrar**.
Si para entonces los cobros no están parados y no hay ninguna comprobación pendiente, por ejemplo
porque otra cosa confirmó la hora o porque otros relojes dijeron que está mal, dice **No queda nada
que confirmar. Mira la fila Reloj.** y solo ofrece **Cerrar**.

El equipo da por buena la hora de tu dispositivo, así que comprueba antes que tu móvil u ordenador
tiene la hora bien. Por la misma razón, nunca funciona desde la pantalla del propio equipo: ahí la
hora del dispositivo es la del equipo, y el equipo lo rechaza con **Esta pantalla es el propio
equipo, así que su hora es la del equipo. Confírmalo desde tu móvil o desde otro ordenador.**

Cuando se confirma la hora, el equipo vuelve a cobrar en ese momento. No cambia ninguna venta ya
registrada. La siguiente venta lleva la hora del reloj del equipo, así que se registra con una hora
anterior a la de la última venta. La fila **Reloj** se pone en ámbar y dice qué confirmó la hora,
por ejemplo **Cobros reanudados el 2026-10-23 21:42, confirmado por dos cajas o terminales.** La
campana guarda un aviso con las dos horas y lo que confirmó la hora, y el equipo envía un
[correo](box-status.md#emails) a las personas que gestionan el sistema.

Una confirmación cubre un paso atrás. Si el reloj del equipo vuelve a retroceder, de modo que marca
más de un minuto más atrás que cuando se confirmó, o más de un minuto antes que una venta hecha
desde entonces, los cobros se vuelven a parar hasta que la hora se confirme otra vez, de cualquiera
de las mismas formas. Pasa igual aunque el reloj retroceda poco a poco.

Una parada así suele significar que el reloj del equipo iba adelantado desde hacía un tiempo, así que
algunas ventas se registraron con una hora posterior a la real. Quedan como se registraron: una
venta registrada para Hacienda no se puede cambiar. Cuando se confirma la hora, el equipo calcula
cuáles son: las ventas registradas antes de la parada con una hora de más de un minuto después del
momento en que el equipo notó la parada. Las muestra en esta página en **Ventas con fecha
incorrecta**, con la **Factura** y la **Hora registrada** de cada una, y dice **Descarga cada lista para tu asesor, revísala con él y después marca el aviso como resuelto
aquí con una nota de lo que se hizo.** [Ventas con fecha
incorrecta](box-status.md#sales-dated-wrongly) explica la descarga y la nota. La campana tiene un aviso con cuántas ventas son y
la primera y la última hora, y el equipo envía un correo a las personas que gestionan el sistema. Si
el propio equipo se reinició durante la parada, no puede estar seguro de cuándo empezó, así que puede
faltar alguna venta en la lista, y el aviso lo dice. Cuando ninguna venta tiene la fecha mal, no hay
lista ni aviso.

La parada también puede terminar sola, porque se puso bien la hora o el reloj llegó a la hora de la
última venta. El equipo sigue necesitando una confirmación para saber qué ventas tienen la fecha
mal, así que hasta que la tiene, la fila **Reloj** sigue en ámbar, su línea dice **Sin confirmar desde
la parada de cobros**, y dice **La parada de cobros que empezó el 2026-10-23 21:10 ha terminado,
pero nada ha confirmado aún la hora del equipo. El equipo pregunta la hora a Hacienda cada minuto
cuando le envía registros; también pueden confirmarla dos cajas o terminales, o el dispositivo de un
administrador.** Mientras tanto se sigue cobrando. Un equipo que envía registros a Hacienda le
sigue pidiendo su hora más o menos una vez por minuto, y los administradores ven **Comprobar con la
hora de este dispositivo** bajo la fila. En cuanto Hacienda, dos cajas o terminales, o el
dispositivo de un administrador confirman la hora, el equipo muestra las ventas con fecha incorrecta
como se explica arriba.

Si en cambio Hacienda o dos cajas o terminales dicen que la hora del equipo está mal, o los cobros se
vuelven a parar por la hora después de registrarse más ventas, el equipo no puede saber qué ventas
tienen la fecha mal. La campana, un correo y la sección **Ventas con fecha incorrecta** lo dicen
entonces: **La parada de cobros que empezó el 2026-10-23 21:10 terminó sola, pero nada confirmó
la hora del equipo, así que el equipo no puede saber qué ventas tienen la fecha mal. Comprueba la
hora del equipo y revisa con tu asesor las ventas desde entonces.**

Si el equipo descubre más tarde que una hora que confirmó durante una parada estaba mal, porque la
hora de Hacienda no coincide con ella o el reloj salta hacia delante más de un minuto, y se hicieron
ventas después de la confirmación, la campana lo dice: **Las ventas registradas entre 2026-10-23
21:42 y 2026-10-23 22:15 se fecharon con un reloj que resultó estar mal. Quedan como se registraron;
consúltalo con tu asesor.** Las horas de ese aviso se fijan cuando aparece, así que las ventas
hechas después no se añaden a él.

No hace falta reiniciar el equipo ni los terminales. Cada cobro se comprueba en el momento de
hacerlo, así que en cuanto el reloj marca como mucho un minuto antes que la última venta, o se
confirma la hora, el siguiente cobro ya no se rechaza por la hora. El aviso de los terminales y las
filas en rojo de esta página desaparecen en unos 15 segundos. La campana, y el aviso de la campana
que aparece bajo la fila **Reloj**, desaparecen en un minuto, más o menos.

Una tarjeta cobrada desde las opciones de pago de una cuenta justo cuando se paran los cobros puede
aparecer en la campana como un pago con tarjeta que Waitron no ha podido registrar. El equipo
registra ese pago por sí solo cuando se puede volver a cobrar, pero el aviso sigue en la campana
hasta que un encargado pulsa **Marcar como resuelto** en él.

Si el reloj marca una fecha anterior al 28 de octubre de 2024, los terminales muestran en su lugar
**No se pueden registrar ventas: la hora del equipo es incorrecta**, y la campana también lo dice,
con la fecha que marca el reloj del equipo. Entonces nada puede confirmar la hora, y la página no
ofrece **Comprobar con la hora de este dispositivo**. La salida es poner la hora bien.

## Ventas con fecha incorrecta {#sales-dated-wrongly}

Una venta registrada con la hora mal se queda como se registró, así que lo que importa después es
qué opina tu asesor fiscal y dejar constancia de lo que se decidió. La sección **Ventas con fecha
incorrecta** de esta página ayuda con las dos cosas: cada lista se puede descargar en un archivo para
tu asesor, y cada lista guarda una nota de lo que se hizo cuando la marcas como resuelta.

Debajo de cada lista, **Descargar para tu asesor** guarda un archivo de hoja de cálculo (CSV) con el
nombre del día de la hora registrada de la primera venta, por ejemplo
`misdated-sales-2026-10-23.csv`. Una entrada en la que el equipo no puede saber qué ventas tienen la
fecha mal no tiene lista, así que tampoco tiene descarga. El archivo está en el idioma del local,
español o inglés, no en el idioma que elegiste para el panel de gestión.

Su primera línea dice qué pasó, por ejemplo: **Bar Sol: se registraron 3 ventas con una hora
posterior a la real, de 23/10/2026 21:12 a 23/10/2026 21:40. Cada una se hizo antes del 23/10/2026
21:11. La hora del equipo se confirmó con dos cajas o terminales el 23/10/2026 21:42.** La hora de
"antes del" es cuándo empezó la parada de cobros según la hora confirmada, más el minuto de margen
que admite una confirmación, redondeada al minuto entero siguiente. Si el equipo se reinició durante
la parada, la línea termina con **El equipo se reinició durante la parada, así que puede faltar
alguna.**

Después viene una fila por venta, con estas columnas:

- **Serie** y **Número**: la factura que muestra la columna **Factura** de la sección, separada en
  dos.
- **Fecha de factura**: la fecha de la factura, tal como se registró.
- **Hora registrada**: la hora con la que se registró la venta. El archivo escribe sus horas en la
  zona horaria que el equipo registró con las ventas, como hacen las listas de la sección y el correo
  del equipo, así que la hora de una venta aquí es la misma que muestra su lista, y la primera y la
  última coinciden con el correo.
- **Hora real**: **Desconocida** en todas las filas. El equipo no sabe cuándo se hizo de verdad cada
  venta, solo que se hizo antes de la hora de la primera línea.
- **Importe (EUR)**: el total de la factura tal como se registró, con dos decimales, la coma decimal
  en un archivo en español y sin símbolo de moneda. Una anulación muestra **Anulación** en su lugar.
- **Otro día**: **Sí** cuando, según la hora confirmada, la venta se hizo un día anterior a la fecha
  de su factura, así que quizá en otro periodo de IVA; consulta estas con tu asesor fiscal. **No se
  sabe** para cualquier otra venta, porque puede que aun así se hiciera en la fecha de su factura.
  **No aplicable** para una anulación, cuya fecha de factura es la de la factura que anula. La
  columna nunca dice "No", porque el equipo no sabe la hora real de cada venta.

Cuando hayas revisado una lista con tu asesor, pulsa **Marcar como resuelto** debajo de ella. Un
diálogo pide una **Nota**, por ejemplo lo que dijo tu asesor o lo que se hizo. La nota es opcional y
puede tener hasta 500 caracteres; **Marcar como resuelto** funciona con ella o sin ella. Una entrada
en la que el equipo no puede saber qué ventas tienen la fecha mal también tiene **Marcar como
resuelto**. La campana y la página **Avisos** también ofrecen **Marcar como resuelto** en el aviso,
pero no admiten nota.

Una lista resuelta deja las listas abiertas y pasa a **Listas resueltas**, un desplegable al final
de la sección cuyo título las cuenta, por ejemplo **Listas resueltas (2)**. Ábrelo para ver todas
las listas resueltas, de la más reciente a la más antigua. Cada una muestra sus ventas y su
descarga, salvo si el equipo no pudo saber qué ventas eran, y dice quién la resolvió y cuándo, por
ejemplo **Marcada como resuelta por Ana el 2026-10-24 10:05.**, y su nota, como **Nota: …**. La hora
en que se marcó como resuelta se muestra en la zona horaria de tu propio dispositivo, mientras que
las horas de las ventas son las horas con las que se registraron. Cuando una comprobación posterior
tampoco puede saber qué ventas tienen la fecha mal, y su parada de cobros empezó antes que la de una
entrada abierta de "no puede saber", la nueva entrada cubre las ventas por las que preguntaba la
antigua, así que el equipo marca la antigua como resuelta por sí solo. Esa entrada dice **Marcada
como resuelta por el equipo el …**

Una lista resuelta sin nota, la resolviera quien la resolviera, ofrece **Añadir nota**, para añadir
la única nota que admite. Su diálogo, **Añadir una nota**, necesita una nota para que **Guardar**
funcione. Cuando una lista tiene nota, no se puede cambiar ni sustituir. Si otra persona marcó una
lista como resuelta mientras escribías una nota para ella, **Marcar como resuelto** dice **Este
aviso ya estaba marcado como resuelto, así que la nota no se ha guardado. Añádela desde Listas
resueltas en Estado del equipo.**

## Dispositivos como testigos de la hora {#clock-witnesses}

Un equipo no puede saber por sí solo que su reloj está mal, así que lo compara con otros relojes.
Las cajas registradoras y los terminales de camarero envían su propia hora al equipo cada 15
segundos, más o menos, mientras hay alguien con la sesión iniciada en ellos. Las pantallas de cocina
no envían la suya. Una caja o un terminal que funciona en el propio equipo no cuenta, y los
dispositivos con una misma dirección de red cuentan como uno.

Cuando dos o más dispositivos coinciden entre sí en que el reloj del equipo va desviado más de un
minuto, la campana avisa a las personas que pueden gestionar el sistema, estén parados o no los
cobros: **2 dispositivos coinciden en que marcan 2026-10-23 21:40, pero el equipo marca 2026-10-23
21:10. Comprueba la fecha y la hora del equipo en Estado del equipo.** El personal de los terminales
no ve nada de esto.

Esas mismas lecturas son la prueba de los dispositivos que confirma la hora del equipo durante una
parada, como explica [Cuando se paran los cobros por la hora](box-status.md#clock-behind).

## Correos sobre el equipo {#emails}

El equipo envía un correo a todas las personas que pueden gestionar el sistema y tienen dirección de
correo cuando:

- a su disco le quedan unos 2 GB libres o menos;
- su disco está lleno, así que no se puede guardar nada;
- su reloj marca una fecha anterior al 28 de octubre de 2024, así que no se puede registrar ninguna
  venta;
- su reloj marca una hora anterior a la de su última venta, así que se han parado los cobros;
- se confirmó su hora durante una de esas paradas, y los cobros se reanudaron;
- encontró ventas con fecha incorrecta tras una de esas paradas, o vio que no puede saber cuáles son.

Cada persona recibe un correo por problema, en su propio idioma, o en el del local si no ha elegido
ninguno. Si no se puede enviar, porque el equipo no tiene internet o el servidor de correo lo
rechaza (por ejemplo, porque los ajustes del servidor de correo tienen una contraseña equivocada),
el equipo lo vuelve a intentar cada minuto mientras dura el problema, hasta que el servidor de
correo lo acepta. Así, el correo llega en cuanto se arregla la conexión o los ajustes. Si el
problema termina antes, por ejemplo porque se puso bien la hora, el equipo deja de intentarlo y no
envía nada. En los dos últimos casos, el equipo lo sigue intentando mientras su aviso esté abierto
en la campana. Un disco lleno al que solo se le libera parte del espacio sigue casi sin espacio, así
que quien no recibió el correo de disco lleno recibe en su lugar el de poco espacio. Un reinicio mientras dura el problema puede enviar el mismo correo
otra vez. Mientras no haya ningún servidor de correo configurado, no se envía nada.

Un equipo cuyo reloj marca una fecha anterior al 28 de octubre de 2024 normalmente no puede enviar
su correo: con una fecha tan temprana no puede comprobar el certificado del servidor de correo.
