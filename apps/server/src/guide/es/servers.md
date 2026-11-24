# Servidores

Abre la dirección del servidor para entrar al panel de gestión, o añade `/till/` para abrir la caja. Actualiza los marcadores y accesos directos antiguos de la caja para que terminen en `/till/`. El navegador conserva su registro como dispositivo.

En un teléfono o una tableta Android, la página puede decir primero que no se encuentra; cuando
Chrome pregunte si puede acceder a los dispositivos de tu red local, permítelo. Una VPN activada en
el dispositivo, como Google VPN, puede impedir que abra `waitron.local`: desactiva la VPN en los
dispositivos que usan la caja.

## Cuando abres el servidor de reserva {#spare}

Si ves **Este es el servidor de reserva del local**, abre el servidor principal para llegar a las
pantallas y los datos del local, con **Abrir el servidor principal** si la página lo muestra. El servidor de reserva no acepta ventas ni ofrece acceso al
panel de gestión.

La página de reserva también te dice cómo ve el servidor de reserva al principal. Si el principal ha
dejado de responder, indica desde hace cuánto y enlaza a la [página de cambio](servers.md#emergency). Si dice
que el servidor de reserva no llega al principal, revisa el cable de red de cada servidor: mientras
no llegue, no podría sustituir al principal si fallara.

## Añadir un servidor de reserva {#adding-a-spare}

Mientras un servidor de reserva que ha terminado de unirse está apagado, el servidor principal espera
en cada inicio hasta que un administrador [deje que siga sin él](servers.md#carry-on) o
[lo retire](servers.md#remove-a-spare).

Antes de empezar, comprueba dos cosas en el servidor principal:

- Tiene una clave de cifrado de copias, que el servidor de reserva necesita. Si nunca se han
  activado las copias de seguridad, abre **Copias de seguridad** y elige **Activar las copias**.
- **Copia continua en tu bucket** está desactivada. El local copia sus cambios en un solo sitio a
  la vez, y el servidor de reserva ocupa ese sitio. Para añadirlo de todos modos, elige
  **Desactivar** en ese apartado; tu bucket deja entonces de recibir los cambios del local y, en
  esta versión, no puede volver a recibirlos mientras el servidor de reserva siga en el local.

También necesitas un dispositivo con la sesión iniciada en el servidor principal con una cuenta que
pueda abrir **Sistema → Servidores**.

Conecta el servidor nuevo a la red del local y enciéndelo; no necesita conexión a internet. Como
`waitron.local` lleva al servidor principal, abre la dirección que la pantalla del servidor nuevo
muestra después de **Use this box's own address**. No hace falta instalar el certificado del
servidor nuevo: acepta una vez el aviso del navegador, elige **Unirse o recuperar** en la primera
pantalla y después **Añadir un nodo réplica**. Si ahí eliges **Continuar con la configuración**,
«Configura este servidor» dice cuándo encuentra otro servidor Waitron con un restaurante en marcha en
la red y ofrece primero **Unirse como reserva**, que abre la misma página para unirse.

Introduce la dirección del servidor principal por su nombre, `https://waitron.local`, y elige
**Unirse**; su dirección IP, como `https://192.168.1.10`, se rechaza. El servidor nuevo muestra un
código de seis cifras y un enlace a la página Servidores del servidor principal.

En el servidor principal, abre **Sistema → Servidores** (el enlace abre esa página) y elige
**Comprobar** junto a la solicitud. Si los dos servidores muestran el mismo código, elige **Unirse**
en el servidor nuevo y **Añadir como reserva** en el servidor principal, en cualquier orden. Si los
códigos no coinciden, elige **No**.

Deja abierta la página de unión del servidor nuevo. Después, el servidor nuevo recibe su primera
copia por la red del local y se reinicia como servidor de reserva. Su página te pide guardar la clave
del servidor y después imprimir su propia [etiqueta de cambio](servers.md#switch-label) y pegarla en
el servidor.

En el servidor principal, abre **Sistema → Servidores** y busca las filas **Servidor principal** y **Servidor de reserva**. En la fila de reserva, comprueba su retraso en segundos y la **Última copia recibida**.
Deja ambos servidores encendidos. Si la copia lleva más de un minuto de retraso o sigue apareciendo **Actualización desconocida**,
comprueba que el servidor de reserva esté conectado a la red del restaurante. **Reconstruyendo la copia** indica que debes dejar ambos servidores encendidos mientras se restaura la copia.

Al cambiar, primero se pone al día la copia de este servidor de reserva. Comprueba la copia que ofrece la página de traspaso antes de cambiar.
La campana y **Estado del servidor** avisan si se retrasa el envío o la aplicación de cambios, o si no se puede contactar con el servidor de reserva durante dos minutos.

## Imprimir una etiqueta de cambio para cada servidor {#switch-label}

El servidor de un restaurante nuevo ofrece su etiqueta en su página **Configuración completada**, y
un servidor de reserva en su propia página: elige **Imprimir etiqueta** y pega la
etiqueta en ese servidor. Para volver a imprimirla, abre **Sistema → Servidores** en el servidor
principal, abre el menú de la fila del servidor y elige **Imprimir etiqueta de cambio** y después
**Imprimir**. Si
el servidor principal falla, escanea la etiqueta del servidor de reserva con cualquier caja o móvil
conectado a la red del local para abrir su [página de cambio](servers.md#emergency).

## Retirar un servidor de reserva {#remove-a-spare}

En el servidor principal, abre **Sistema → Servidores**, abre el menú de la fila del servidor de
reserva y elige **Retirar del local**. Si ha terminado de unirse, apágalo primero y asegúrate de que nadie está restaurando el local desde una copia de seguridad ni pasándolo a otro servidor; después activa las dos declaraciones. Una vez retirado, el servidor principal
deja de esperarlo en cada inicio, y puedes guardar tu bucket o añadir otro servidor de reserva. Para
volver a usar esa máquina, restablécela desde un terminal y añádela como un nuevo servidor de
reserva. El servidor principal anterior del que este tomó el relevo se borra desde su fila
([más información](servers.md#old-box-returns)).

## Iniciar aquí si ha fallado el servidor principal {#emergency}

Usa un servidor de reserva que haya terminado de unirse a este local. Apaga el servidor principal
anterior y mantenlo apagado, porque dos servidores principales encendidos podrían cobrar y enviar
registros por separado. El cambio no se puede deshacer.

Si la pantalla de la caja o del terminal de camarero se pone roja, déjala abierta. Cuando el
servidor principal vuelva a responder, podrás seguir con tu pedido. Si el servidor de reserva
responde, elige **Cambiar al servidor de reserva**. Para hacer el cambio, inicia sesión en el
servidor de reserva con el permiso **Gestionar servidores**. Cuando el servidor
principal lleva cerca de medio minuto sin responder, una caja, un móvil o el panel que recargue la
dirección habitual del local también llega a esta página. Un reinicio del servidor principal de
más de unos 20 segundos, por ejemplo durante una actualización, también trae aquí a un dispositivo
que recargue; si no querías cambiar, no hagas el cambio y recarga la página cuando el servidor
principal vuelva. Desde cualquier otro dispositivo, abre la dirección HTTPS del
servidor de reserva y añade `/handover/emergency`, por ejemplo
`https://spare.example/handover/emergency`, o escanea la [etiqueta de cambio](servers.md#switch-label) del servidor de reserva.

La página comprueba primero si el servidor principal responde a tu dispositivo. Si responde, la
página dice **El servidor principal responde**: elige **Volver a la caja** (**Volver** si no
llegaste desde una caja) y sigue trabajando. Si aun así necesitas pasar el local, abre **Aun así
necesito pasar el local a este servidor** para ver el enlace a la página Servidores del servidor
principal y [haz el traspaso](servers.md#hand-over) desde allí; si el servidor principal está
averiado, apágalo y elige **Comprobar otra vez**.

Si el servidor principal no responde, la página dice qué hace el cambio y, cuando el servidor de
reserva lo sabe, desde hace cuánto. Comprueba que el servidor principal está enchufado y que su
cable de red está conectado; si vuelve a funcionar, sigue usándolo. Hasta que elijas **Cambiar a este servidor**, **Volver
a la caja** (**Volver** si no llegaste desde una caja) sale sin cambiar.

Elige **Empezar el cambio**, escribe el correo de un administrador y elige **Continuar**, o elige
una passkey guardada que te ofrezca el campo del correo. Si escribiste el correo, elige **Usar tu passkey**, o
escribe tu contraseña y el código actual del autenticador, si está configurado, y elige
**Identificarse con contraseña**. Escribe la contraseña con cuidado: si es incorrecta, el servidor de reserva se reinicia y
vuelve a poner al día su copia antes de que puedas intentarlo de nuevo.

**Preparando el local** aplica los cambios que el servidor de reserva ya recibió del servidor
principal y después comprueba la copia. El servidor de reserva puede reiniciarse; mantén la página
abierta. Si tarda más de un minuto o no puede, **Usar la copia que guarda este servidor de
reserva** ofrece la copia que ya tiene, normalmente la de cuando se incorporó, sin nada posterior.
Cuando la copia esté comprobada, revisa **Última venta o pedido en esta copia** en la zona horaria
del local. Puede faltar lo posterior. Después elige **Seguir**.

Si falla la preparación automática, puedes usar una copia de seguridad cifrada. En **Preparando
el local**, elige **Subir un archivo de copia de seguridad en su lugar**, elige el archivo y pulsa
**Usar esta copia de seguridad**.
Si se te pide, introduce la **Clave de cifrado de copias** de esa copia. El servidor conserva su clave guardada.
Mantén la página abierta mientras se reinicia y revisa **Copia de seguridad seleccionada** y su
última venta o pedido antes de elegir **Seguir**. Elige una copia hecha después de que este
servidor de reserva se uniera a su principal actual.

Si la página indica que falta espacio temporal, libera espacio en el disco del servidor de
reserva antes de volver a elegir la copia de seguridad.

En **Listo para cambiar**, marca las tres declaraciones y explica por qué haces el cambio. Elige **Cambiar a este servidor**. La página **Cambiando a este servidor** comprueba entonces la hora de este
servidor e inicia el local por sí sola; mantén la página abierta mientras se reinicia el servidor.
Solo si este servidor no puede comprobar su hora por internet muestra **Comprueba la hora** con la
hora de este servidor y la de este dispositivo. Si las dos son correctas, elige **Confirmar la
hora**. Si solo es correcta la de este dispositivo, elige **Tu dispositivo tiene la hora correcta**;
si no, corrige la hora de este dispositivo y elige **Volver a comprobar**. Introduces tu contraseña y código una sola vez; si
el código caduca, introduce el código actual cuando se te pida y vuelve a intentar el paso. Con una
passkey, la página te la pide cuando eliges un paso y el servidor de reserva la necesita,
normalmente una vez, y de nuevo solo si la página pasa 15 minutos esperando a que elijas un paso; si en su lugar dice que hay que volver a
comprobar tu passkey, vuelve a elegir el paso (después de **Cambiar a este servidor**, elige
**Volver a intentarlo** o usa tu contraseña). El motivo y las declaraciones se conservan.

Si la copia cambia antes de hacer el cambio, la página vuelve a **Preparando el local**: revisa su
última venta o pedido, elige **Seguir** y vuelve a marcar las tres declaraciones. Si la copia no
supera su comprobación al elegir **Cambiar a este servidor**, la página también vuelve allí: elige
**Volver a intentarlo** o **Subir un archivo de copia de seguridad en su lugar**.

Una vez elegido **Cambiar a este servidor**, al recargar o abrir la dirección en otro
dispositivo se encuentra el cambio; identifícate y elige **Volver a intentarlo**. Un traspaso controlado pendiente
ofrece su página de progreso. Si no se puede verificar la copia con el cambio guardado, para y
conserva los datos de ambos servidores.

Cuando el local se haya iniciado, **Este servidor lleva ahora el local** te pide que no restablezcas el
servidor principal antiguo: puede tener datos que este servidor no tiene. Cuando se vuelva a
encender, envía aquí sus registros de facturación y sus horas trabajadas por sí solo y se retira. Después, elige [**Borrar y retirar**](servers.md#old-box-returns)
para él en la página Servidores de este servidor, en el panel.

Si el alojamiento de emergencia está disponible para tu local, la pantalla roja también ofrece **Iniciar el local en la nube**, incluso sin servidor de reserva. La opción aparece en la pantalla de acceso y para todo el personal. [Comprueba qué necesitas](servers.md#cloud-emergency) antes de abrirla.

## Conservar los datos del servidor averiado {#old-box-returns}

Usa el nuevo servidor principal cuando arranque. Conserva el servidor averiado y sus datos para la
devolución. Los registros de facturación con sus hechos de pago registrados, y las horas
trabajadas, pueden volver al nuevo servidor principal; esto no repite pedidos, cambios de existencias, impresiones ni aperturas de
cajón. No borres el servidor anterior mientras necesites sus datos.

Enciende el servidor anterior y mantenlo conectado: devuelve sus registros de facturación y horas
trabajadas por sí solo. Hasta que lleguen, su fila en **Sistema → Servidores** del nuevo servidor
principal dice **Esperando a que el servidor principal anterior devuelva sus registros de
facturación y horas trabajadas**, y no se puede volver a
traspasar el local ni retirar ese servidor.

Una persona añadida en el servidor anterior después de la copia vuelve deshabilitada, con sus
horas pero sin correo electrónico: añade su nombre, apellidos y correo con **Editar…** y luego
[vuelve a habilitar su cuenta](staff.md#account-access) en lugar de añadirla de nuevo. Si ya
la habías añadido de nuevo, deja deshabilitada la cuenta devuelta: Waitron no permite volver a
habilitarla mientras otra cuenta tenga el mismo nombre. La exportación del registro de jornada
lista las horas de las dos cuentas con ese nombre.

Si alguien fichó la entrada o la salida en los dos servidores alrededor del cambio, revisa las
horas de esa persona ese día y corrígelas ([cómo](staff.md#hours)).

Si el servidor anterior no va a volver nunca con sus datos, elige **No volverá** en el menú de su
fila.

Mientras se siguen esperando sus registros de facturación y horas trabajadas, o después de **No volverá**, el menú de
su fila ofrece también **Borrar y retirar**. Su diálogo avisa de que el servidor principal anterior
no ha devuelto todos sus registros de facturación y horas trabajadas: antes de borrarse, intenta enviarlos una vez
más; después sus bases de datos se apartan en él en lugar de borrarse, y dejan de usarse. Antes de
confirmar, marca que has descargado sus datos o que lo aceptas.

Cuando haya devuelto sus registros de facturación y horas trabajadas, **Borrar y retirar** no pide
marcar nada. El
diálogo dice que puede que el servidor principal anterior tenga datos que este servidor no tiene
e indica la dirección del servidor anterior cuando su fila tiene una: ábrela y
[descarga esos datos](servers.md#handed-over) antes de confirmar, porque una vez empezado el borrado
ya no se pueden descargar. Una línea de **ATENCIÓN** en el diálogo indica que los registros
recuperados solo están en este servidor hasta que se haga una copia de seguridad. Cuando lo
confirmes, la fila dice **Borrado solicitado**. El servidor principal anterior se borra y sale de la
lista la próxima vez que esté encendido y pueda conectar con este servidor, y se reinicia en la
primera página de la configuración: desde ahí,
[vuelve a añadirlo como servidor de reserva](servers.md#adding-a-spare), comparando el código que
muestra con el de este servidor. Si ya se borró a mano, elige **Retirar del local**. Si este
servidor principal también se sustituye antes de que el anterior se haya borrado, el anterior nunca
recibe el borrado: elige **Retirar del local** en el nuevo servidor principal y bórralo desde un
terminal.

Para retirar un servidor principal anterior sin borrarlo, elige **Retirar del local** en el menú de
su fila. Si no ha devuelto sus registros de facturación y horas trabajadas, marca que se ha borrado o que no se volverá
a encender nunca. Si vuelve, bórralo desde un terminal y no elijas nunca **Seguir como servidor
principal** en él.

## Traspasar el local a un servidor de reserva {#hand-over}

Usa este proceso solo con un servidor de reserva que haya terminado de unirse al local.

En el servidor principal, abre **Sistema → Servidores**. Abre el menú de la fila del servidor de reserva
y elige **Traspasar el local**. Lee la explicación. Elige **Parar** para mantener el local en este
servidor, o **Traspasar el local** para detener las ventas aquí y mover la copia final. Si se te pide,
[confirma tu acceso](staff.md#account-access). Se reutiliza una confirmación reciente; si usaste un código
de recuperación, debes confirmar con el código actual del autenticador. Necesitas una cuenta con
contraseña y tener a mano esa contraseña y el código actual del autenticador, si está configurado,
para acceder en el servidor de reserva. Una llave de acceso no completa ese paso.

Si al traspasar el local el servidor de reserva indica que no tiene sitio, elige **Parar**, haz sitio en el
servidor de reserva y vuelve a traspasar el local. El servidor principal sigue vendiendo. Si falta
una clave de cifrado o es distinta, elige **Parar** y vuelve a unir el servidor de reserva antes
de traspasar el local.

Antes de detener las ventas, este servidor comprueba los datos del local. Si la comprobación rechaza
el traspaso, elige **Parar** y sigue vendiendo aquí. Conserva este servidor y sus datos. Puedes volver
a intentarlo más tarde. Si se rechaza de nuevo, mantén el local en este servidor. Para un cambio urgente, sigue el
[procedimiento de emergencia](servers.md#emergency) con una copia de seguridad que funcione.

Mantén los dos servidores conectados. La página de traspaso se abre en el servidor de reserva y sigue la
transferencia. Cuando la copia esté lista, introduce la misma cuenta de administrador y elige
**Continuar a la comprobación del reloj**. Marca **Estos datos son correctos.** y elige
**Continuar**: la página compara los relojes y crea las series de facturas nuevas sola, también tras
cualquier espera, y muestra para qué sirve cada una. Si el servidor de reserva no
puede comprobar su hora por internet, la página muestra antes la hora del servidor de reserva y la de
este dispositivo: comprueba que las dos son correctas (las dos se muestran en la zona horaria del local) y elige **Confirmar la hora**. Si los relojes
no coinciden, la página pregunta qué hora es la correcta: **Este dispositivo** pone la
hora del servidor de reserva con la del dispositivo que estás usando y la página sigue; después de **El
servidor** o **Las dos horas están mal**, corrige la hora de este dispositivo y vuelve a conectarte. Elige **Continuar** otra vez para iniciar el local en el servidor de reserva. Un código del autenticador dura
menos de un minuto. Si el tuyo caduca antes de que la página lo use, la página te pide revisar la contraseña y el código: introduce un código nuevo y elige
**Volver a intentarlo** para seguir. Antes de elegir **Continuar** en la comprobación del reloj,
**Editar estos datos** vuelve a la identificación. Si la página indica que el
servidor se está reiniciando, mantenla abierta hasta que aparezca **Continuar en este servidor**.
Los pagos ya registrados se conservan en la copia transferida.

Si se pierde una respuesta en la página Servidores, mantén abierto el diálogo y elige **Consultar el
progreso del traspaso**. En la página de traspaso del servidor de reserva puedes recargar para
consultar el progreso. No inicies otro traspaso. Un mensaje de espera describe el último intento;
mantén los dos servidores conectados mientras vuelven a intentarlo.
Si sigue fallando la comprobación de la copia, consulta [cómo cambiar al servidor de reserva](servers.md#emergency).

## Después del traspaso {#after-hand-over}

Usa la dirección del nuevo servidor. Si la página del servidor anterior ofrece **Progreso**, sigue el
enlace para continuar el traspaso en el de reserva. Conserva el servidor anterior y sus datos,
encendido y conectado: devuelve sus registros de facturación y horas trabajadas al nuevo servidor por sí solo y, hasta
que lleguen, no se puede volver a traspasar el local ([más información](servers.md#old-box-returns)).

En la caja, deja la pantalla abierta; seguirá al servidor principal cuando ese servidor acepte ventas.

## Cuando el local ya no funciona con un servidor {#handed-over}

Si abres la dirección de un servidor, o su caja o su panel de gestión, y ves una página titulada
**El local ya no funciona con este servidor**, ese servidor se ha retirado. No hace ventas ni envía
nada a Hacienda. Usa **Abrir el panel en el nuevo servidor principal.**, si la página lo muestra,
para ir al servidor que lleva el local.

Mientras algo te necesita, la página muestra también una línea que dice qué hacer. Mientras un
[traspaso](servers.md#hand-over) no ha terminado, puede ofrecer también **Progreso**: úsalo para terminar
el traspaso en el servidor de reserva.

Mantén este servidor encendido mientras devuelve sus registros de facturación y horas trabajadas al
servidor principal.
El envío a Hacienda continúa en el principal.

Antes de que el servidor principal borre este servidor, descarga sus datos en **Descargar los datos
de este servidor**. Introduce el correo electrónico y la contraseña de un administrador, o de una
cuenta con **Gestionar servidores**, tal como estaban la última vez que este servidor llevó el local,
y el código del autenticador si la cuenta lo usa; las llaves de acceso y el inicio de sesión con
Google no funcionan aquí. Elige **Descargar**. La pestaña **Facturas** del archivo lista los
registros de facturación; su primera línea dice si son solo los que el principal no tenía o todos
los que tiene este servidor. Tras un [traspaso de emergencia](servers.md#emergency), el archivo tiene
también las pestañas **Pedidos**, **Pagos y caja**, **Horas de trabajo** y **Actividad**. La primera
línea de cada pestaña dice qué lista, normalmente desde poco antes de la última venta o pedido de la copia con la que empezó el nuevo servidor principal.

Cuando alguien elige **Borrar y retirar** en el servidor principal, este servidor se borra. La página lo indica entonces, y el servidor se reinicia en breve en la primera
página de la configuración, listo para [volver a unirse como servidor de
reserva](servers.md#adding-a-spare). El borrado retira sus datos del local, incluidas las líneas de
venta y las copias de seguridad locales, que esta devolución no incluye; conserva los datos del
servidor anterior si los necesitas. Si se eligió Borrar y retirar antes
de que volvieran todos sus registros de facturación y horas trabajadas, o al servidor principal le faltan registros de
facturación u horas trabajadas que tiene este servidor, aparta sus bases de datos en lugar de borrarlas.

Si la devolución se detiene porque un registro de facturación entra en conflicto con uno del
servidor principal, sigue usando el principal y conserva los datos del servidor anterior si aún los
necesitas. La devolución no está confirmada. Cuando hayas descargado los datos de este servidor,
puedes elegir igualmente **Borrar y retirar** en el servidor principal: este servidor aparta
entonces sus bases de datos en lugar de borrarlas, incluidos los registros que no pudo devolver.

Si la página indica que el servidor principal no ha podido guardar algunas de las horas trabajadas
de este servidor, sus registros de facturación ya han llegado. Descarga los datos de este servidor
antes de que nadie elija **Borrar y retirar** en el servidor principal: tras un cambio de
emergencia, la pestaña **Horas de trabajo** del archivo lista las horas de este servidor, desde la
hora que indica su primera línea cuando indica una. Reiniciar este servidor no sirve. El borrado
aparta entonces las bases de datos de este servidor en lugar de borrarlas, así que cualquier hora
anterior también se conserva en ellas.

Si otros datos devueltos difieren, mantén ambos servidores encendidos y conserva sus datos. Solo se
pueden aceptar diferencias de pago admisibles mediante la API interna. Una persona administradora
puede consultarlas con GET `/management-api/return-clashes`
en el principal y aceptar una con POST `/management-api/return-clashes/:clashId/accept`, indicando
`actionKey` y `reason`. Todavía no hay una pantalla para ello. Después, apaga y enciende el servidor
detenido para reintentarlo. Cada nuevo lote en conflicto requiere su propia aceptación; solo
cuenta el grupo exacto aceptado.

Si la página avisa de una diferencia de reloj, comprueba los relojes de ambos servidores y manténlos
encendidos mientras se vuelve a intentar la devolución. No borres el servidor anterior.

La página aparece en español cuando tu navegador prefiere el español, y en inglés en los demás
casos.

## Comprobar los intervalos del traspaso {#reconciliation}

Después de un traspaso de emergencia, abre **Informes** y después **Intervalos del traspaso** para
comprobar el período cuya actividad podría faltar. Necesitas permiso para ver informes. La lista
muestra los servidores principal anterior y nuevo, la última hora de venta o pedido en la copia, las horas
de declaración y activación, y el motivo indicado al tomar el relevo. Todas las horas usan la zona
horaria del local. **Desconocida** significa que la copia no tenía ventas ni pedidos fechados; no significa
que no falte dinero.

Ventas, el arqueo, los informes por categorías y el IVA muestran un aviso de traspaso con un enlace
a esta lista. Comprueba las fechas del traspaso antes de decidir si las cifras cubren el período que
necesitas. Pulsa **Actualizar el estado del traspaso** para comprobarlo de nuevo. El aviso se mantiene
tras recibir un inventario.

Pulsa **Actualizar intervalos** para comprobar la recepción del inventario. **Recepción del inventario
confirmada** significa que el nuevo servidor ha contabilizado todos los lotes de un inventario anunciado
por el anterior. No confirma la actividad que falte ni los importes, ni reconstruye los arqueos. Una
recepción sin confirmar necesita una devolución completa; si el servidor anterior ya dejó de enviar,
reinícialo mientras sigue restringido para que reenvíe los datos. Si la página del servidor anterior
dice que el servidor principal no ha podido guardar algunas de sus horas trabajadas, reiniciarlo no
sirve: descarga sus datos ([cómo](servers.md#handed-over)).

Debajo de los intervalos, **Facturas devueltas** muestra cada factura recibida por primera vez
con el servidor de origen, la instalación que la generó, la fecha de expedición original y los
importes registrados. Las filas de facturas muestran un tipo legible junto a su código original.
Las correcciones y anulaciones aparecen por separado. **No consta** indica que ese importe no
figura en el registro. Usa el buscador para encontrar facturas devueltas, ordénalas por **Primera recepción** y usa los botones de página
para seguir leyendo; **Actualizar facturas** vuelve a la primera página.

El seguimiento empieza con esta función. No se añaden las facturas que ya estaban en una copia,
por lo que una lista vacía no es un historial completo de devoluciones anteriores. La lista no
identifica duplicados.

El aviso de los informes también indica si hay facturas devueltas registradas, independientemente
de las fechas que selecciones. Sigue el enlace **Comprobar los intervalos del traspaso** del aviso;
**Facturas devueltas** está debajo de los intervalos. Comprueba las fechas de expedición originales
de las facturas. Usa las cifras que muestra cada informe; no añadas los importes de la lista a los
totales del informe.

## Cuando un servidor espera a otro servidor {#waiting}

Cuando un servidor se inicia y no consigue contactar con el otro servidor del local, espera en lugar de
vender, porque el otro quizá ha pasado a llevar el local. Su página, titulada **Este servidor está
esperando a** y la dirección del otro servidor, lo indica. Mientras espera no hace ventas ni envía nada
a Hacienda. Vuelve a preguntar cada 15 segundos; cuando el otro servidor responde, este se inicia con
normalidad o, si el otro ha pasado a llevar el local, lo indica.

## Seguir como servidor principal {#carry-on}

Si sabes que el otro servidor está apagado, puedes dejar que este servidor siga sin él. Abre el servidor
en su dirección `https://`, inicia sesión como administrador en **Seguir como servidor principal** y
marca las dos casillas. Este servidor lleva entonces el local hasta que se reinicie, y entonces vuelve
a preguntar al otro servidor. Si el otro es un servidor de reserva que ya no necesitas,
[retíralo](servers.md#remove-a-spare) cuando este servidor esté funcionando, para que deje de
esperarlo en cada inicio.

Si el otro servidor responde antes, manda su respuesta. Un servidor que ya ha pasado el local no puede
seguir; su página lo indica en lugar de mostrar el formulario.

Debajo del formulario, la página también ofrece **Descargar los datos de este servidor**, la misma
descarga y el mismo inicio de sesión que en [un servidor que ya no lleva el local](servers.md#handed-over).

Si la copia de seguridad confirma que otro servidor ha pasado a llevar el local, este servidor se
niega a seguir como principal. Abre el otro servidor con el enlace. Si esa información aparece después
de continuar, este servidor deja de aceptar ventas. Usa el nuevo servidor principal. Los servidores antiguos
pueden compartir dirección: comprueba qué servidor has abierto.

Mantén este servidor encendido y conserva sus datos mientras devuelve los registros. Puedes
restablecerlo desde un terminal, pero eso borra sus datos del local aunque la devolución se haya detenido o no haya
terminado.

Cuando un servidor pase a ser el principal, abre **Copias de seguridad** y comprueba que cada carpeta de copias esté en este servidor.

## Conectar un servidor de pruebas durante la configuración {#setup-cloud-sign-in}

En un servidor de pruebas preparado para Cloud, introduce primero los datos del administrador
en **Preparación** o al empezar de cero en un ensayo de **Empezar un restaurante nuevo** en un servidor de
desarrollo. Luego elige **Iniciar sesión en Waitron Cloud** e inicia sesión o crea una cuenta.
La configuración se reanuda en el formulario del local, en la misma pestaña. Waitron registra el
local cuando lo guardas y se reinicia el servidor. Comprueba la conexión en **Sistema → Servicios
Cloud**.

Si tu cuenta de pruebas de Cloud tiene una sola empresa española, sin NIF ni locales, elige
una sugerencia en **Buscar el domicilio fiscal** o **Buscar la dirección**. Revisa los campos
que se han rellenado y corrígelos antes de continuar. Si añades un local a una empresa que ya
usa Cloud o la búsqueda no está disponible, escribe las direcciones a mano.

En **Preparación**, puedes [elegir Cloud para el correo del personal](email.md#cloud-staff-email) y
continuar con el servidor de correo en blanco. Si eliges **Omitir** antes de abrir Cloud o importas
una configuración, escribe las direcciones a mano, introduce tu servidor de correo y conéctate
más tarde desde **Servicios Cloud**.

Si tu sesión de Cloud caduca o la cierras antes de que se registre el local, termina de
guardarlo. Luego abre **Sistema → Servicios Cloud**, elige **Iniciar sesión en Waitron Cloud**
y usa la misma cuenta de Cloud para terminar de registrar el local. Si Cloud sigue rechazando
la conexión, pide ayuda al responsable de la prueba.

## Activar o desactivar el acceso remoto del personal {#remote-access}

En un servidor de pruebas preparado para iniciar sesión en Cloud, abre **Sistema → Servicios
Cloud** y elige **Iniciar sesión en Waitron Cloud**. Usa tu cuenta de Cloud. La misma pestaña
vuelve al servidor para conectar tu local. Deja esa pestaña abierta. Si la conexión se interrumpe,
elige **Iniciar sesión en Waitron Cloud** en la misma pestaña. Si la cerraste y Waitron indica que
la solicitud anterior sigue activa, espera a que caduque antes de volver a intentarlo.

Si Waitron te pide que revises los datos de conexión, comprueba el nombre, la dirección y los datos
fiscales guardados en **Ajustes del local → Datos del local** y vuelve a intentarlo.

Vincula tu servidor de pruebas con Waitron Cloud e inicia la prueba gratuita del local en
**Facturación** para abrir la dirección del personal que se te asigna. **Servicios Cloud** te
avisa si necesitas iniciar la prueba. Después de iniciarla, elige **Actualizar estado** para
volver a comprobar la conexión.

Activar el acceso remoto pide la [confirmación de identidad compartida](staff.md#account-access).
Desactivarlo no pide una nueva confirmación de identidad.

Si restauras una copia hecha antes de conectarlo con Cloud, abre **Servicios Cloud** en **Sistema** y elige **Conectar con Cloud** de nuevo.

Si el acceso a Cloud ha terminado, porque alguien eligió **Detener el acceso a Cloud** en el servidor o eliminó el local en Waitron Cloud, **Servicios Cloud** lo indica. En el servidor principal, elige **Volver a conectar** para añadir el local a Waitron Cloud como un local nuevo.

Para impedir que el personal abra el panel desde fuera del local, abre **Servicios Cloud** en **Sistema**
en el servidor principal y elige **Desactivar el acceso remoto**. Si usas la dirección del personal,
confirma **Desactivar el acceso remoto** para desconectarte también, o elige **Detener** para mantenerlo activado. Ten a mano la dirección local del servidor. La vinculación con
Cloud y los demás servicios de Cloud se mantienen. Elige **Activar el acceso remoto** para que el
servidor vuelva a conectarse.

El estado junto al botón es la opción que has guardado. Abre la dirección del personal para
comprobar si puedes conectarte; esta página no prueba esa conexión. Si un cambio falla, revisa la opción guardada y elige **Actualizar estado** para volver a intentar la conexión. **Detener el acceso a Cloud** es la opción aparte
que detiene todos los servicios de Cloud.

## Enviar informes automáticos de errores {#error-reports}

Puedes activar el envío en **Revisar y configurar** durante la configuración o en
**Sistema → Servicios Cloud**. Elige **Activar los informes de errores** para
ayudar a Waitron a detectar errores en una versión. La opción se aplica a este
servidor. Los servidores nuevos o de sustitución empiezan con el envío desactivado.

Cuando se conecta a Waitron Cloud, el servidor envía los códigos de error, sus
orígenes, la versión de Waitron, las fechas y los recuentos de incidencias bajo
el registro de este servidor en Cloud. Si se repite la misma incidencia abierta,
cuenta una sola vez. El servidor guarda los informes mientras no pueda conectar
con Cloud. Elige **Desactivar los informes de errores** para descartar los que
queden pendientes de envío.

## Aprobar la recuperación del propietario de Cloud {#cloud-owner-recovery}

Si estás recuperando una cuenta propietaria de Cloud, verifica primero tu correo en la página de recuperación de Cloud.
En el local, abre **Sistema → Servicios Cloud** en el servidor principal vinculado y elige **Cargar solicitudes de recuperación**.
Debe haber iniciado sesión un administrador del servidor; usa **Entrar como administrador** si se te pide.

Comprueba el correo, la cuenta, la organización y el ID del local. **Aprobar recuperación** te permite terminar en la misma
página de recuperación de Cloud y configurar de nuevo el inicio de sesión. **Rechazar recuperación** termina esa solicitud
de forma permanente. **Cancelar** no envía ninguna decisión. Cuando se registre la aprobación, vuelve a la misma página de Cloud para terminar.

## Consultar el inicio de emergencia en Cloud {#cloud-emergency}

Abre **Sistema → Servicios Cloud** en el servidor principal y consulta **Inicio de emergencia
en Cloud**. La tarjeta muestra la dirección de emergencia, cuándo se consultaron los datos
y cuándo se emitió el código actual.

Si el inicio está desactivado, el plan Conectado no está activo o falta un método de pago,
abre la cuenta de Cloud para corregirlo. **Cloud aún no puede iniciar este local** indica que el
alojamiento no está disponible para este local. Los datos anteriores se indican como tales;
Cloud los comprueba de nuevo antes de iniciar el local. El precio diario es aproximado y no
incluye IVA.

Con permiso para gestionar el servidor, pulsa **Mostrar código** para consultar el código actual.
Comprueba su fecha de emisión antes de usar una copia guardada. **Ocultar código** lo retira de
la tarjeta, igual que salir de esta pantalla. La dirección junto al código corresponde a ese código.
La tarjeta también muestra quién tiene permiso y autenticador, y quién necesita configurarlo
en su perfil. La tarjeta no inicia el local.

Si el servidor principal deja de responder, mantén el terminal abierto. Cuando la pantalla roja ofrezca **Iniciar el local en la nube**, elige la opción para ver la dirección de emergencia y un código QR. Escanéalo con el móvil o elige **Abrir aquí** para salir del terminal y abrirla en este navegador. **Cerrar** vuelve al terminal.

Ten a mano el código de emergencia, tu contraseña de Waitron y un código del autenticador o de recuperación. El diálogo indica los roles que pueden iniciar el local; Cloud comprueba la disponibilidad antes de continuar. La opción permanece oculta hasta que Cloud habilite el alojamiento de emergencia para tu local.

En **Copias de seguridad**, elige **Hacer paquete de recuperación** en el servidor principal mientras Cloud esté disponible. Con permiso para gestionar el servidor, el paquete incluye la dirección y el código de emergencia, sus códigos QR y la fecha de emisión del código. Guárdalo bajo llave fuera del servidor. El código inicia una copia bloqueada; aún necesitas tu contraseña y tu autenticador o un código de recuperación. Las llaves de acceso no funcionan allí. Si falta la página de emergencia o ha fallado, haz un paquete nuevo cuando esté disponible.

Elige **Imprimir paquete de recuperación** en la tarjeta de Cloud para abrir el formulario en **Copias de seguridad**. Si ha cambiado, haz un paquete nuevo antes de necesitarlo. Si no se pudo comprobar, vuelve a intentarlo más tarde; eso por sí solo no significa que necesites otro paquete.

En la copia bloqueada, entra con tu correo de Waitron, contraseña y código del autenticador, o elige **Usar un código de recuperación**. Al entrar, comprueba tu nombre, la hora de cierre de la copia y cuándo fue el último contacto de Cloud con el servidor anterior. Si el estado de Cloud no está disponible, elige **Volver a comprobar**. Esta página aún no ofrece la declaración ni inicia el local.
