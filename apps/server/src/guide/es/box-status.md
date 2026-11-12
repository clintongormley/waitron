# Estado del servidor

**Estado del servidor** muestra en una sola página si cada parte del servidor funciona: las ventas,
Hacienda, la copia en el bucket, las impresoras, los lectores de tarjetas, el reloj y el espacio en
disco. También es donde se libera espacio cuando el disco del servidor se llena, y donde un gerente o administrador
reinicia Waitron en el servidor cuando una alerta lo indica. Para leer el
registro del servidor, usa **Diagnóstico**.

## Abre la página {#open}

Para guardar un archivo sobre un problema del panel, elige **Informar de un problema** en la barra
superior. También puedes hacerlo antes de iniciar sesión. Abre el panel por HTTPS si no aparece
el botón.
Durante la configuración, elige **Informar de un problema** en la cabecera de la página. Puedes
guardar un informe aunque el servidor no responda o esta página ya abierta pierda la conexión.
Describe qué ha pasado, revisa la vista previa y elige **Descargar informe**. El archivo
incluye la actividad reciente de este navegador, en lugar del registro del servidor. No se envía
nada ni se guarda en el servidor. No incluyas contraseñas, datos de pago ni información personal
en tu descripción.

En un móvil, usa el botón con un bocadillo de diálogo y una exclamación.

Abre **Ajustes → Estado del servidor**, justo encima de **Diagnóstico**. Solo la ven las personas
que pueden gestionar el sistema.

La página vuelve a leer el servidor más o menos cada 15 segundos, así que puedes dejarla abierta.
Estas lecturas automáticas no cuentan como actividad, así que tener la página abierta no mantiene
tu sesión iniciada.

En un servidor que solo guarda una copia de solo lectura de otro servidor, el botón **Liberar** no se puede
pulsar, y la página explica por qué bajo **Espacio en disco**.

## Lee las filas {#rows}

Cada parte tiene una fila con un punto de color:

- **Verde** significa que la parte está bien.
- **Ámbar** significa que necesita atención, pero todo sigue funcionando.
- **Rojo** significa que algo no se puede guardar: el disco está lleno, o la hora del servidor es tan
  incorrecta que no se puede registrar una venta. Cualquiera de ellos pone también en rojo **Ventas**.

Cada fila muestra los mismos avisos que la campana para esa parte, con las mismas palabras. Las
filas **Copia en el bucket**, **Impresoras** y **Lectores de tarjetas** tienen un botón **Ir a …**,
como **Ir a Copias de seguridad**, que abre su propia página cuando puedes abrirla, y un aviso que
tiene su propia página añade un botón para esa página. Los avisos que no corresponden a ninguna fila
se cuentan bajo las filas, junto a **Ver todos los avisos**.

Cuando no pasa nada, cada fila dice:

- **Ventas**: **Se registran con normalidad**, y cuándo fue la última venta.
- **Hacienda**: **Se envían con normalidad**, y cuándo aceptó Hacienda registros del servidor por
  última vez (la hora, según el reloj del servidor, en que el servidor empezó esa ronda de envío). Un
  servidor que no envía registros a Hacienda lo dice.
- **Copia en el bucket**: **Al día**, y cuándo se confirmó el último envío. Dice **No
  configurada** cuando no hay ninguna copia configurada, y cuántos minutos de retraso lleva
  cuando se retrasa.
- **Impresoras**: **Sin problemas**, y los nombres de las impresoras configuradas.
- **Lectores de tarjetas**: **Sin problemas**, y los nombres de los lectores configurados. Un
  lector que su proveedor de tarjetas da como sin conexión aparece aquí, como **«Barra» está sin
  conexión.** Mientras la campana o esta página están abiertas, el servidor pregunta al proveedor como
  mucho cada cinco minutos, así que puede aparecer con unos minutos de retraso. Esta fila no aparece
  cuando los pagos con tarjeta están desactivados.
- **Reloj**: **Correcto**, y cuándo comparó el servidor su hora con la de Hacienda por última vez.
  Cuando no tiene una comparación válida, por ejemplo justo después de arrancar el servidor, dice
  **Aún no se ha comparado con Hacienda**.
- **Espacio en disco**: cuánto espacio queda libre del total, y cuánto ocupan la base de datos,
  las copias guardadas en el servidor, los registros de actividad y el resto del disco. El resto del
  disco incluye unos 8 MB que el servidor guarda en reserva para poder arrancar y quitar, con el disco
  lleno, lo que ya no necesita. Tras un arranque que usó ese espacio, los terminales siguen parados
  hasta que quedan libres unos 24 MB y el servidor ha vuelto a apartar los 8 MB.

Después de que falle un envío a Hacienda, la fila **Hacienda** dice cuántos registros esperan, y si
el servidor los reintenta solo o el encargado tiene que resolver alguno.

Si no se han podido leer los avisos, la página sigue mostrando todas las filas y avisa de que una
parte puede parecer bien aunque no lo esté. Si algunas comprobaciones no se han podido hacer, la
página avisa de que puede no mostrar todos los problemas.

## Consultar la red {#network}

Cuando tu servidor puede informar de su red, **Red** muestra la conexión por cable y su dirección,
el nombre de la Wi-Fi actual y el de la Wi-Fi guardada. Úsala para comprobar qué red
utiliza el servidor. La tarjeta se actualiza aproximadamente cada minuto; no puedes cambiar
la red desde aquí. Si falla la lectura, espera al siguiente intento automático. Si falta la tarjeta, vuelve a abrir
**Estado del servidor** para consultar de nuevo al servidor.

## Vuelve a intentar los registros que esperan {#retry-now}

En un servidor que envía registros a Hacienda, la fila **Hacienda** tiene un botón **Reintentar
ahora**. Después de un envío fallido, el servidor hace una pausa antes de volver a intentar los
registros que esperan. **Reintentar ahora** los vuelve a intentar sin esperar a que acabe esa
pausa. Solo se puede pulsar mientras la fila dice que hay registros sin enviar.

Después de pulsarlo, la fila dice cuántos registros se volverán a intentar. Puede que no salgan
enseguida: Hacienda pide una espera entre dos envíos, y los registros se intentan cuando permite el
siguiente envío, salvo que un lote completo de 1.000 registros puede salir enseguida. Si el servidor
sigue sin poder conectar con Hacienda, vuelven a esperar.

Mientras el servidor no tenga el certificado de la AEAT, no se envía nada, así que **Reintentar
ahora** no se puede pulsar y la fila explica por qué. Instala el certificado en **Ajustes del
local**. El servidor lo vuelve a intentar en cinco minutos como mucho, y después el botón se puede
pulsar mientras sigan quedando registros sin enviar.

Los registros parados después de que Hacienda rechazara varios seguidos por el mismo motivo no se
liberan con **Reintentar ahora**. El servidor sigue intentando el primero de ellos cada hora, y el
aviso de la campana explica por qué se pararon.

## Recupera una identidad de facturación en conflicto {#invoice-conflict}

Si este servidor deja de emitir facturas porque su identidad entra en conflicto con una respuesta
de envío o una consulta a Hacienda, mantén desconectado cualquier servidor antiguo o copiado. Una identidad nueva no impide
que otra máquina siga vendiendo.

Abre `/manage/recovery/fiscal-conflict` en este servidor mediante HTTPS. Necesitas la clave del
servidor actual; iniciar sesión en el panel no sustituye esa clave. Escríbela y elige
**Consultar conflicto** para ver la factura y la identidad afectadas. Confirma que has desconectado
el servidor antiguo o copiado y que nadie más lo está recuperando, y elige **Comparar relojes**.

Si no hay un minuto disponible, espera la cuenta atrás. La página vuelve a comprobarlo cada cinco
segundos. Cuando termine la espera, compara los relojes otra vez. Comprueba la identidad elegida y
pulsa **Cambiar identidad**. La cuenta atrás nunca la cambia por ti. Se conservan tus pedidos,
pagos e historial. Los resultados de envío y las incidencias existentes no cambian. Una factura
encontrada al consultar Hacienda puede no estar en el historial de este servidor.

Si se pierde la respuesta, la página consulta el resultado del mismo intento. Un resultado sin
confirmar no significa que la identidad haya cambiado. Usa **Consultar conflicto** para volver a
comprobarlo con la clave actual. Elige **Iniciar otro intento** solo cuando la página lo ofrezca;
escribe la clave otra vez y repite la comparación de relojes. **Detener** borra la clave y tus
confirmaciones y detiene las comprobaciones de esta página. No puede deshacer un cambio ya
confirmado en el servidor: si detuviste la página mientras lo enviaba, ábrela otra vez para consultar
el resultado.

## Libera espacio en el servidor {#free-space}

El botón **Liberar** de la fila **Espacio en disco** muestra cuánto puede liberar antes de que lo
pulses, por ejemplo **Liberar 120 MB**. Cuando no hay casi nada que liberar, dice **Nada que
liberar** y no se puede pulsar.

**Liberar** solo borra archivos que el servidor ya no necesita:

- informes de fallos de hace más de una semana
- registros de actividad anteriores a los dos más recientes
- lo que dejó una copia de seguridad que se interrumpió a medias

Nunca toca las ventas, los ajustes ni tus copias de seguridad. Cuando termina, la página dice
cuánto ha liberado.

Mientras se está haciendo una copia de seguridad, **Liberar** no toca la carpeta de trabajo de las
copias, ni siquiera lo que dejó en ella una copia interrumpida, y la página dice que esos archivos
no se cuentan.

Los tamaños bajo **Espacio en disco** muestran qué está llenando el disco. En **Copias de
seguridad**, puedes elegir cuántas copias conservar. Sal sin cambiar los ajustes para parar.
Conserva la base de datos, las claves de recuperación y las copias guardadas.

Antes de cada copia de seguridad, si falta espacio en el disco, el servidor puede borrar sus copias
más antiguas de ese disco para hacer sitio. Nunca borra la copia más reciente de una carpeta, una
copia anterior a la última restauración o puesta en marcha desde cero del servidor, ni una copia de un
bucket. Si aun así no basta, la copia no se hace y la campana dice cuánto espacio necesita. Mientras
las copias están activadas, el servidor también borra sus copias más antiguas de ese disco, con los mismos
límites, cuando al disco le quedan menos de unos 2 GB libres, hasta tener unos 2,5 GB libres. Si
el servidor arranca con el disco lleno, puede borrarlas de la misma forma para tener sitio para
arrancar y, una vez en marcha, te avisa en la campana y por [correo](box-status.md#emails), igual
que en los demás casos.

La fecha de una copia de seguridad sale del reloj del servidor cuando se hizo. Por eso, durante un
tiempo después de que el servidor [ponga su propio reloj en hora](box-status.md#clock-own-device), cuando
el servidor borra copias antiguas conserva las más recientes de las copias hechas antes del cambio,
tantas como conserva de las demás, además de las que conserva como siempre; y cuando hace sitio,
borra las últimas las copias hechas antes del cambio. Esto dura tantos días como se
conservan las copias, y solo cubre los cambios que hizo el propio servidor, no uno que hiciera su
servicio de hora. El arranque con el disco lleno aún no lo hace: sigue borrando por las fechas que
llevan las copias en su nombre.

Esta página no puede borrar otros archivos ni trasladar tus datos a un disco mayor.

Si la campana dice **Copia no hecha**, abre **Estado del servidor** y revisa **Espacio en disco**.
Pulsa **Liberar** si está disponible, o sal sin pulsarlo para no hacer la limpieza. Liberar espacio
no inicia una copia. Si no basta, **Liberar** no puede borrar otros archivos por ti; conserva la
base de datos, las claves de recuperación y las copias guardadas.

## Cuando el servidor no tiene espacio {#out-of-space}

Cuando el disco está lleno, no se puede guardar nada: los terminales no pueden guardar pedidos,
pagos ni otros cambios, y muestran **No se puede guardar nada: el servidor no tiene espacio**. En
esta página, **Ventas** y **Espacio en disco** se ponen en rojo.

Mientras el disco está lleno, una barra roja arriba de cada página del panel empieza por **Disco
lleno: las cajas no pueden guardar nada (ventas, pedidos, fichajes).** A los encargados y
administradores también les nombra las copias de seguridad del aviso de la campana sobre copias
borradas, mientras ese aviso tenga menos de un día y no se haya marcado como resuelto. Ellos pulsan **Abrir Estado del servidor** en ella; cualquier otra persona pulsa **Iniciar
sesión como encargado**, que antes cierra su sesión. La barra desaparece en medio minuto, más o
menos, después de que los terminales vuelvan a guardar.

Pulsa **Liberar** para liberar espacio. En cuanto hay espacio suficiente, los terminales vuelven a
poder guardar por sí solos; no hace falta reiniciar nada.

Después de pulsar **Liberar**, esta página y la campana de avisos del mismo panel vuelven a leer
el servidor en ese momento. Una campana abierta en otro ordenador se pone al día en un minuto, más o
menos.

Si **Liberar** no libera bastante, sigue la línea del final de la página sobre cómo ganar más
espacio.

## Reinicia el servidor {#restart}

**Reiniciar el servidor** reinicia Waitron en el servidor sin apagarlo. Ninguna caja
puede vender hasta que Waitron vuelva a arrancar, así que la página lo pregunta antes: elige
**Reiniciar** para seguir o **Parar** para dejarlo. Úsalo cuando una alerta lo indique. La página
se pone al día sola cuando vuelve el servidor.

Los gerentes y administradores pueden reiniciar el servidor.

## Pon la hora desde tu propio dispositivo {#clock-own-device}

El permiso de administración del servidor, que tiene Admin de forma predeterminada, te permite poner la hora desde tu propio dispositivo o aprobarla en una caja. El personal puede seguir confirmándola desde una caja mientras el arranque espera.

Si el reloj marca una fecha anterior al 28 de octubre de 2024, los terminales muestran
**No se pueden registrar ventas: la hora del servidor es incorrecta**, y la campana también lo dice,
con la fecha que marca el reloj del servidor. Entonces nada puede confirmar la hora.
La salida es poner la hora bien: en un servidor que se pone en hora por internet, conectándolo a
internet; si no, un administrador la pone con **Comprobar con la hora de este dispositivo** o,
durante el [arranque](box-status.md#clock-at-start), un empleado desde una caja.

La fila **Reloj** muestra entonces a los administradores un botón
**Comprobar con la hora de este dispositivo**. Cualquier otra persona que pueda abrir esta página ve
**Solo un administrador puede comprobar la hora del servidor con la de este dispositivo. Iniciar
sesión como administrador cierra primero tu sesión aquí.** y un botón **Iniciar sesión como
administrador**. El botón abre un diálogo que muestra las dos horas: **El reloj del servidor marca …
Este dispositivo marca …**

- Cuando están más separadas y el servidor puede poner su reloj en hora, el diálogo pregunta **El
  reloj del servidor marca … Tu dispositivo marca … ¿Usar la hora de tu dispositivo?** Pulsa **Usar
  esta hora**, y el servidor pone su reloj a la hora de tu dispositivo y los cobros se reanudan. El
  diálogo dice **El servidor ya está en hora.** El servidor solo puede poner su reloj en hora mientras
  no se pone en hora por internet.
- Si no, dice **El servidor no ha podido comprobar que su hora está a menos de un minuto de la de tu
  dispositivo. Comprueba que tu dispositivo tiene la hora bien; si la tiene, conecta el servidor a
  internet para que corrija la hora.** y solo ofrece **Cerrar**. Por el tiempo que tarda la
  respuesta, dos horas separadas por algo menos de un minuto también pueden recibir este mensaje.

Poner la hora puede cerrar tu sesión en el panel de gestión. Cuando el reloj se mueve más de media
hora, en cualquier sentido, termina toda sesión del panel que se estaba usando justo antes, así que
el diálogo añade **Vuelve a iniciar sesión para seguir.** Un paso menor hacia delante acorta, en lo
que mide el paso, el tiempo que una sesión del panel puede quedarse sin usar antes de terminar; un
paso menor hacia atrás no termina ninguna sesión. Las cajas y los terminales siguen con su sesión
iniciada.

Si el servidor se niega a poner su reloj en hora, el diálogo dice por qué encima de sus botones. Por
ejemplo, cuando la parte del servidor que pone su reloj en hora no responde, dice **Este servidor no
puede poner su propio reloj en hora: la parte del servidor que lo hace no responde. Si el servidor
tiene conexión a internet, puede que su servicio de hora aún corrija el reloj por sí solo. Cierra
esto y vuelve a comprobarlo dentro de unos minutos.** Cuando
el reloj del servidor ha cambiado mientras lo comprobabas, o el servidor no había terminado de
guardar su último cambio de hora, cierra el diálogo y vuelve a comprobarlo.

El servidor da por buena la hora de tu dispositivo, así que comprueba antes que tu móvil u ordenador
tiene la hora bien. Por la misma razón, nunca funciona desde la pantalla del propio servidor: ahí la
hora del dispositivo es la del servidor, y el servidor lo rechaza con **Esta pantalla es el propio
servidor, así que su hora es la del servidor. Usa tu móvil u otro ordenador.**

Cada vez que el servidor pone su reloj en hora, sea quien sea o lo que sea que lo puso, la campana
tiene un aviso que lo dice, con la hora de antes y la de después y cuánto se movió el reloj, por
ejemplo **El reloj del servidor se puso con la hora del dispositivo de Ana: adelantado 2 días y 3
horas, de 2026-10-21 18:40 a 2026-10-23 21:40.**, y el servidor envía un
[correo](box-status.md#emails) a las personas que gestionan el sistema. Cuando el servidor puso su
reloj pero no pudo confirmar que el cambio se aplicara, el aviso lo dice y te pide que compruebes
la hora del servidor en esta página. Si el servidor no puede anotar el cambio en ese momento (por ejemplo, con el disco lleno) y se
reinicia antes de poder hacerlo, ese cambio no tiene aviso ni correo.

## Justo después de un arranque {#clock-at-start}

Cuando el servidor arranca con su hora en duda y no puede confirmarla por sí mismo,
un empleado puede poner o confirmar la hora desde una caja, para que el local no tenga que esperar
a un administrador. Un reinicio del servidor cuenta como arranque, sea tras un corte de luz, una
actualización, **Reiniciar el servidor** o a mano.

Aquí se llama arranque al tiempo que va desde que el servidor arranca hasta que el reloj deja de
parar los cobros. En el medio minuto siguiente al arranque, más o menos, cuando el servidor ha
visto que no puede confirmar su hora por sí mismo, cada caja y terminal con alguien con la sesión iniciada termina su línea roja de
la hora con **Comprobar la hora** en lugar de **Avisa al encargado**. En un servidor cuyo reloj marca
una fecha anterior al 28 de octubre de 2024, o en uno que no envía registros a Hacienda, lo hace en
la siguiente consulta de la caja, en unos 15 segundos. Cualquier empleado con la sesión iniciada en la caja puede pulsarlo; no necesita ningún
permiso. La [guía de avisos del terminal](till-notices.md#notices) explica qué muestra el diálogo
de la caja y qué hace cada botón.

La caja envía su propia hora. Cuando está a más de un minuto de la del servidor, **Este dispositivo**
pone el reloj del servidor a esa hora, y **El servidor** mantiene el reloj del servidor sea cual sea la
hora de la caja mientras el servidor espera a que se confirme su hora tras un arranque y los cobros no
están parados además porque el reloj marca una fecha
anterior al 28 de octubre de 2024; si no, **El servidor** pide a la persona que corrija la hora de
la caja. Cuando está a menos de un minuto, **Sí** mantiene el reloj del servidor. Cada uno de ellos
que el servidor acepta reanuda los cobros. Cuando el servidor pone su reloj en hora, la campana y el
correo nombran al empleado y a la caja. Cuando se usa la hora de la caja, las lecturas de otros
dispositivos no lo impiden.

Dos cajas o terminales que coinciden con el servidor confirman su hora tras un arranque por sí solos.

El arranque termina en cuanto el servidor ve que el reloj ya no para los cobros. Desde entonces, en cuanto
internet ha confirmado la hora del servidor, un empleado ya no puede poner la hora desde una caja.

## El servicio de hora del servidor {#clock-service}

El servidor tiene un servicio de hora que mantiene su reloj en hora por internet. Cuando el servidor
puede leer ese servicio, la fila **Reloj** dice **Se pone en hora por internet** cuando el servicio
funciona y ha contactado con un servidor de hora, y **No se pone en hora por internet** en otro
caso. Cuando el servidor no puede leerlo, por ejemplo en un portátil, la fila no dice ninguna de las
dos.

Cuando el servicio no mantiene el reloj en hora, la campana avisa a las personas que pueden
gestionar el sistema. El aviso llega solo por la campana, no por correo, y dice por qué:

- **El servicio de hora del servidor está desactivado, así que nada mantiene su reloj en hora.**
- **El servicio de hora del servidor está activado pero no funciona, así que nada mantiene su reloj
  en hora.**
- **El servicio de hora del servidor no ha contactado con ningún servidor de hora, así que su reloj
  puede desviarse.** Comprueba que el servidor tiene conexión a internet.
- **Este servidor no puede ver ni controlar su servicio de hora: la parte del servidor que lo hace no
  responde. Si el servidor tiene conexión a internet, puede que su servicio de hora aún mantenga el
  reloj en hora por sí solo.** Solo lo dice el servidor de un local en funcionamiento; un portátil o
  un servidor de pruebas no dice nada.

Cada aviso te pide que mires la fecha y la hora del servidor en esta página. Mientras la parte
del servidor que pone su reloj en hora no responde, el servidor no puede poner su reloj en hora: entonces solo puede confirmar
una hora que ya es correcta.

## Dispositivos como testigos de la hora {#clock-witnesses}

Un servidor no puede saber por sí solo que su reloj está mal, así que lo compara con otros relojes.
Las cajas registradoras y los terminales de camarero envían su propia hora al servidor cada 15
segundos, más o menos, mientras hay alguien con la sesión iniciada en ellos o mientras muestran la
pantalla de inicio de sesión. Las pantallas de cocina no envían la suya. Una caja o un terminal que
funciona en el propio servidor no cuenta, y los dispositivos con una misma dirección de red cuentan
como uno.

Cuando dos o más dispositivos coinciden entre sí en que el reloj del servidor va desviado más de un
minuto, la campana avisa a las personas que pueden gestionar el sistema: **2 dispositivos coinciden en que marcan 2026-10-23 21:40, pero el servidor marca 2026-10-23
21:10. Comprueba la fecha y la hora del servidor en Estado del servidor.** El personal de los terminales
no ve nada de esto.

Los dispositivos nunca ponen la hora
del servidor por sí solos.

## Correos sobre el servidor {#emails}

El servidor envía un correo a todas las personas que pueden gestionar el sistema y tienen dirección de
correo cuando:

- a su disco le quedan unos 2 GB libres o menos, después de borrar las copias antiguas que puede;
- su disco está lleno, así que no se puede guardar nada;
- su reloj marca una fecha anterior al 28 de octubre de 2024, así que no se puede registrar ninguna
  venta;
- puso su propio reloj en hora, o lo intentó y no pudo confirmar que el cambio se aplicara;
- borró copias de seguridad antiguas para hacer sitio;
- no se hizo una copia de seguridad por falta de espacio.

Cada persona recibe un correo por problema, en su propio idioma, o en el del local si no ha
elegido ninguno. Si no se puede enviar, porque el servidor no tiene internet o el servidor de
correo lo rechaza (por ejemplo, porque los ajustes del servidor de correo tienen una contraseña
equivocada), el servidor lo vuelve a intentar al cabo de un minuto y después con esperas cada vez
más largas, durante un día como mucho. Así, el correo llega en cuanto se arregla la conexión o
los ajustes, si es dentro de ese día. Si la conexión se corta después de entregar el correo al
servidor de correo, el servidor no puede saber si salió y no lo vuelve a enviar.
Si el problema termina antes, por ejemplo porque se puso bien la hora, el servidor deja de
intentarlo y no envía nada. Si se
borraron copias, el servidor lo sigue intentando mientras su aviso esté abierto en la campana,
durante un día como mucho. El correo de disco lleno no se puede guardar con el disco lleno, así
que el servidor lo envía en el acto y lo vuelve a intentar cada minuto mientras el disco siga
lleno; los demás correos esperan a que vuelva a haber espacio. Un disco lleno al que solo
se le libera parte del espacio sigue casi sin espacio, así que quien no recibió el correo de
disco lleno recibe en su lugar el de poco espacio. Un reinicio mientras el disco, una copia o la
hora siguen con problemas puede enviar el mismo correo otra vez. Mientras no haya ningún
servidor de correo configurado, no se envía nada.

Cada vez que el servidor pone su reloj en hora envía su propio correo, aunque lo vuelva a poner en
hora antes de un minuto, lo que marca como resuelto el aviso del primer cambio. Cuando el aviso de
un cambio está resuelto, el servidor deja de intentar enviar su correo a un encargado cuya dirección
rechazó del todo después el servidor de correo, y un reinicio en el minuto antes de que el correo
quede en cola lo pierde. El aviso en sí
sigue en la página **Avisos**, en **Resueltos**.

Un servidor cuyo reloj marca una fecha anterior al 28 de octubre de 2024 normalmente no puede enviar
su correo: con una fecha tan temprana no puede comprobar el certificado del servidor de correo.

## Cuando no coincide un importe de tarjeta {#card-amount-mismatch}

Si no coincide un importe de tarjeta, lee las dos cifras de la alerta antes de volver a cobrar:
lo que solicitó Waitron y lo que indicó el proveedor de pagos. Comprueba el cobro en el panel del
proveedor.
