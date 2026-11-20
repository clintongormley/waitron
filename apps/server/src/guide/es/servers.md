# Servidores

Abre la dirección del servidor para entrar al panel de gestión, o añade `/till/` para abrir la caja. Actualiza los marcadores y accesos directos antiguos de la caja para que terminen en `/till/`. El navegador conserva su registro como dispositivo.

## Cuando abres el servidor de reserva {#spare}

Si ves **Este es el servidor de reserva**, abre la dirección del servidor principal para usar las
pantallas y los datos del local. La página de reserva muestra su estado; no acepta ventas ni
ofrece acceso al panel de gestión.

La página de reserva también te dice cómo ve el servidor de reserva al principal. Si el principal ha
dejado de responder, indica desde hace cuánto y enlaza a la [página de cambio](servers.md#emergency). Si dice
que el servidor de reserva no llega al principal, revisa el cable de red de cada servidor: mientras
no llegue, no podría sustituir al principal si fallara.

## Añadir un servidor de reserva {#adding-a-spare}

Mientras un servidor de reserva que ha terminado de unirse está apagado, el servidor principal espera
en cada inicio hasta que un administrador [deje que siga sin él](servers.md#carry-on) o
[lo retire](servers.md#remove-a-spare).

Antes de empezar, comprueba dos cosas en el servidor principal:

- Tiene una clave de recuperación, que el servidor de reserva necesita. Si nunca se han
  activado las copias de seguridad, abre **Copias de seguridad** y elige **Activar las copias**.
- **Copia continua en tu bucket** está desactivada. El local copia sus cambios en un solo sitio a
  la vez, y el servidor de reserva ocupa ese sitio. Para añadirlo de todos modos, elige
  **Desactivar** en ese apartado; tu bucket deja entonces de recibir los cambios del local y, en
  esta versión, no puede volver a recibirlos mientras el servidor de reserva siga en el local.

También necesitas una cuenta que pueda abrir **Sistema → Servidores** en el servidor principal, con
el correo con el que inicia sesión, su contraseña y el código actual del autenticador, si está
configurado.

Conecta el servidor nuevo a la red del local y enciéndelo; no necesita conexión a internet. Como
`waitron.local` lleva al servidor principal, abre la dirección que la pantalla del servidor nuevo
muestra después de **Use this box's own address**. Elige **Unirse o recuperar** y después
**Añadir un nodo réplica**.

Introduce la dirección del servidor principal por su nombre, `https://waitron.local`, y elige **Continuar**; su dirección IP, como `https://192.168.1.10`, se rechaza. En un dispositivo que ya
tenga la sesión iniciada en el panel del servidor principal, abre **Sistema → Servidores** y compara
**Huella del certificado público de este servidor** con la que muestra el servidor nuevo. Elige
**Coincide** solo si son iguales. Después introduce el correo y la contraseña de la cuenta y elige
**Conectar**. Si la cuenta usa un autenticador, la página te pide entonces su código actual:
escríbelo y elige **Conectar** otra vez. El servidor nuevo recibe su primera copia por la red del
local y se reinicia solo como servidor de reserva. La página del servidor nuevo se queda en
**Este servidor se está uniendo** y no cambia.

En el servidor principal, abre **Sistema → Servidores** para comprobar el retraso del equipo de reserva en segundos y la **Última copia recibida**.
Deja ambos equipos encendidos. Si la copia lleva más de un minuto de retraso o sigue apareciendo **Actualización desconocida**,
comprueba que el equipo de reserva esté conectado a la red del restaurante. **Reconstruyendo la copia** indica que debes dejar ambos equipos encendidos mientras se restaura la copia.

Al cambiar, primero se pone al día la copia de este equipo de reserva. Comprueba la copia que ofrece la página de traspaso antes de cambiar.
La campana y **Estado del servidor** avisan si se retrasa el envío o la aplicación de cambios, o si no se puede contactar con el equipo de reserva durante dos minutos.

## Imprimir una etiqueta de cambio para cada servidor {#switch-label}

Cuando un servidor de reserva haya terminado de unirse, abre **Sistema → Servidores** en el
servidor principal. Para el servidor principal y para el de reserva, abre el menú de su fila,
elige **Imprimir etiqueta de cambio** y después **Imprimir**, y pega la etiqueta en ese servidor. Si
el servidor principal falla, escanea la etiqueta del servidor de reserva con cualquier caja o móvil
conectado a la red del local para abrir su [página de cambio](servers.md#emergency).

## Retirar un servidor de reserva {#remove-a-spare}

En el servidor principal, abre **Sistema → Servidores**, abre el menú de la fila del servidor de
reserva y elige **Retirar**. Si ha terminado de unirse, apágalo primero y asegúrate de que nadie está restaurando el local desde una copia de seguridad ni pasándolo a otro servidor; después activa las dos declaraciones. Una vez retirado, el servidor principal
deja de esperarlo en cada inicio, y puedes guardar tu bucket o añadir otro servidor de reserva. Para
volver a usar esa máquina, restablécela y añádela como un nuevo servidor de reserva.

## Iniciar aquí si ha fallado el servidor principal {#emergency}

Usa un servidor de reserva que haya terminado de unirse a este local. Apaga el servidor principal
anterior y mantenlo apagado, porque dos servidores principales encendidos podrían cobrar y enviar
registros por separado. Esta declaración no se puede deshacer.

En una caja o un terminal de camarero, la franja roja **El servidor principal no responde** ofrece
**Cambiar al servidor de reserva** en la pantalla de inicio de sesión, y a quien tenga **Gestionar
servidores**. Abre esta página en el servidor de reserva, y **Parar** o **Continuar en este
servidor** te devuelve a la caja. Cuando el servidor principal lleva cerca de medio minuto sin responder,
una caja, un móvil o el panel que recargue la dirección habitual del local también llega a esta
página. Un reinicio del servidor principal de más de unos 20 segundos, por ejemplo durante una
actualización, también trae aquí a un dispositivo que recargue; si no querías cambiar, no declares
nada y recarga la página cuando el servidor principal vuelva. Desde cualquier otro dispositivo, abre la dirección HTTPS del
servidor de reserva y añade `/handover/emergency`, por ejemplo
`https://spare.example/handover/emergency`, o escanea la [etiqueta de cambio](servers.md#switch-label) del servidor de reserva. Identifícate con la contraseña de una cuenta de
administrador y su código actual de autenticador, si está configurado, o elige **Usar tu passkey**;
después elige **Comprobar esta copia** y, con una passkey, úsala cuando la página la pida. Escribe la contraseña con cuidado: si es incorrecta, el servidor de reserva se reinicia y
vuelve a poner al día su copia antes de que puedas intentarlo de nuevo. El servidor de reserva primero pone al día su copia y se reinicia; mantén la página
abierta. Si tarda más de un minuto o no puede, **Usar la copia que guarda este servidor de reserva** ofrece la copia que ya tiene,
normalmente la de cuando se incorporó, sin nada posterior. Revisa la última actividad con fecha de la copia. Puede faltar la actividad posterior; si no hay
ninguna fecha disponible, la página lo indica.

Si la página indica que falta espacio temporal, libera espacio en el disco del equipo de
reserva antes de volver a elegir la copia.

Para usar una copia de seguridad cifrada, elige su archivo y pulsa **Usar esta copia de seguridad**.
Si se te pide, introduce la clave de esa copia; no cambia la clave guardada en este equipo.
Mantén la página abierta mientras se reinicia y revisa **Copia de seguridad seleccionada** y su
última actividad antes de declarar. Elige una copia hecha después de que este equipo de reserva
se uniera a su principal actual.

Lee las advertencias, marca las tres declaraciones y explica el motivo. Elige **Declarar apagado
el servidor principal anterior**. En la comprobación del reloj, marca **Estos datos son correctos.**
y elige **Continuar**: la página compara los relojes, crea las series de facturas nuevas e inicia
el local en este servidor sola. Si este servidor no puede comprobar su hora por internet, la página
muestra antes la hora de este servidor y la de este dispositivo: comprueba que las dos son correctas y
elige **Confirmar la hora**. Si los relojes no coinciden, la página pregunta qué hora es la correcta: **Este dispositivo** pone la
hora de este servidor con la del dispositivo que estás usando y la página sigue; después de **El
servidor** o **Las dos horas están mal**, corrige la hora de este dispositivo y vuelve a conectarte. Mantén la página abierta durante el reinicio. Introduces tu contraseña y código una sola vez; si
el código caduca, introduce el código actual cuando se te pida y vuelve a intentar el paso. Con una
passkey, la página te la pide cuando el servidor de reserva la necesita, normalmente una vez, y de
nuevo pasados 15 minutos. El
motivo y las declaraciones se conservan.

Si la copia cambia antes de declarar, revisa la nueva actividad y vuelve a marcar las tres
declaraciones.

Si se pierde una respuesta, mantén la página abierta y vuelve a comprobar la copia antes de
reintentar. Al recargar o abrir la dirección en otro dispositivo se encuentra la declaración
guardada; identifícate y continúa con la comprobación del reloj. Un traspaso controlado pendiente
ofrece su página de progreso. Si responde el servidor principal anterior, abre su enlace
**Servidores** o apágalo y vuelve a comprobarlo. Si no se puede verificar la copia con la
declaración, para y conserva los datos de ambos servidores.

Si el alojamiento de emergencia está disponible para tu local, la franja también ofrece **Iniciar el local en la nube**, incluso sin servidor de reserva. La opción aparece en la pantalla de acceso y para todo el personal. [Comprueba qué necesitas](servers.md#cloud-emergency) antes de abrirla.

## Conservar los datos del servidor averiado {#old-box-returns}

Usa el nuevo servidor principal cuando arranque. Conserva el servidor averiado y sus datos para la
devolución. Los registros de facturación y sus hechos de pago registrados pueden volver al nuevo
servidor principal; esto no repite pedidos, cambios de existencias, impresiones ni aperturas de
cajón. No restablezcas el servidor anterior mientras necesites sus datos.

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
cualquier espera, y después inicia el local en el servidor de reserva. Si el servidor de reserva no
puede comprobar su hora por internet, la página muestra antes la hora del servidor de reserva y la de
este dispositivo: comprueba que las dos son correctas y elige **Confirmar la hora**. Si los relojes
no coinciden, la página pregunta qué hora es la correcta: **Este dispositivo** pone la
hora del servidor de reserva con la del dispositivo que estás usando y la página sigue; después de **El
servidor** o **Las dos horas están mal**, corrige la hora de este dispositivo y vuelve a conectarte. Un código del autenticador dura
menos de un minuto. Si el tuyo caduca antes de que la página lo use, la página te pide revisar la contraseña y el código: introduce un código nuevo y elige
**Volver a intentarlo** para seguir. Antes de **Continuar**,
**Editar estos datos** vuelve a la identificación. Si la página indica que el
servidor se está reiniciando, mantenla abierta hasta que aparezca **Continuar en este servidor**.
Los pagos ya registrados se conservan en la copia transferida.

Si se pierde una respuesta en Servidores, mantén abierto el diálogo y elige **Consultar el
progreso del traspaso**. En la página de traspaso del servidor de reserva puedes recargar para
consultar el progreso. No inicies otro traspaso. Un mensaje de espera describe el último intento;
mantén los dos servidores conectados mientras vuelven a intentarlo.
Si sigue fallando la comprobación de la copia, consulta [cómo cambiar al servidor de reserva](servers.md#emergency).

## Después del traspaso {#after-hand-over}

Usa la dirección del nuevo servidor. Si la página del servidor anterior ofrece **Progreso**, sigue el
enlace para continuar el traspaso en el de reserva. Conserva el servidor anterior y sus datos.

En la caja, deja la pantalla abierta; seguirá al servidor principal cuando ese servidor acepte ventas.

## Cuando el local ya no funciona con un servidor {#handed-over}

Si abres la dirección de un servidor en un navegador y ves una página titulada **El local ya no
funciona con este equipo**, ese servidor se ha retirado. No hace ventas ni envía nada a Hacienda. La
página indica, en negrita, el servidor que pasa a llevar el local.

Debajo, la página enumera cada paso del traspaso que este servidor ha registrado, en el orden en que
los registró, con la fecha y la hora de cada uno en la zona horaria del local.

Si la página ofrece **Progreso**, úsalo para terminar el traspaso en el servidor de reserva.

Mantén este servidor encendido mientras devuelve sus registros de facturación al servidor principal.
Actualiza la página para comprobar el progreso. Los reembolsos con tarjeta en curso se devuelven
con sus pagos originales para que el principal pueda comprobar su resultado. El envío a Hacienda
continúa en el principal. La confirmación significa que cada dato devuelto se ha recibido o se ha
cubierto mediante una diferencia de pago aceptada expresamente; para una diferencia aceptada, el
principal conserva sus propios datos de pago. Restablecer el servidor anterior borra sus datos del
local, incluidas las líneas de venta y las copias de seguridad locales. Esos datos no se incluyen
en esta devolución; conserva los datos del servidor anterior si los necesitas.

Si la devolución se detiene porque un registro de facturación entra en conflicto con uno del
servidor principal, sigue usando el principal y conserva los datos del servidor anterior si aún los
necesitas. La devolución no está confirmada. Puedes restablecer el servidor, pero eso borra sus
datos del local, incluidos los registros que sigan pendientes.

Si otros datos devueltos difieren, mantén ambos servidores encendidos y conserva sus datos. Solo se
pueden aceptar diferencias de pago admisibles mediante la API interna. Una persona administradora
puede consultarlas con GET `/management-api/return-clashes`
en el principal y aceptar una con POST `/management-api/return-clashes/:clashId/accept`, indicando
`actionKey` y `reason`. Todavía no hay una pantalla para ello. Después, apaga y enciende el servidor
detenido para reintentarlo. Cada nuevo lote en conflicto requiere su propia aceptación; solo
cuenta el grupo exacto aceptado.

Si la página avisa de una diferencia de reloj, comprueba los relojes de ambos servidores y manténlos
encendidos mientras se vuelve a intentar la devolución. No restablezcas el servidor anterior.

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
reinícialo mientras sigue restringido para que reenvíe los datos. Si vuelve el servidor anterior,
comprueba el estado de la devolución en su página antes de decidir si lo restableces.

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
vender, porque el otro quizá ha pasado a llevar el local. Su página, titulada **Este equipo está
esperando a** y el nombre del otro servidor, lo indica. Mientras espera no hace ventas ni envía nada
a Hacienda. Vuelve a preguntar cada 15 segundos; cuando el otro servidor responde, este se inicia con
normalidad o, si el otro ha pasado a llevar el local, lo indica.

## Seguir como equipo principal {#carry-on}

Si sabes que el otro servidor está apagado, puedes dejar que este servidor siga sin él. Abre el servidor
en su dirección `https://`, inicia sesión como administrador en **Seguir como equipo principal** y
marca las dos casillas. Este servidor lleva entonces el local hasta que se reinicie, y entonces vuelve
a preguntar al otro servidor. Si el otro es un servidor de reserva que ya no necesitas,
[retíralo](servers.md#remove-a-spare) cuando este servidor esté funcionando, para que deje de
esperarlo en cada inicio.

Si el otro servidor responde antes, manda su respuesta. Un servidor que ya ha pasado el local no puede
seguir; su página lo indica en lugar de mostrar el formulario.

Si la copia de seguridad confirma que otro servidor ha pasado a llevar el local, este servidor se
niega a seguir como principal. Abre el otro servidor con el enlace. Si esa información aparece después
de continuar, este servidor deja de aceptar ventas. Usa el nuevo servidor principal. Los servidores antiguos
pueden compartir dirección: comprueba qué servidor has abierto.

Mantén este servidor encendido y conserva sus datos mientras devuelve los registros. Puedes
restablecerlo, pero eso borra sus datos del local aunque la devolución se haya detenido o no haya
terminado.

Cuando un servidor pase a ser el principal, abre **Copias de seguridad** y comprueba que cada carpeta de copias esté en este servidor.

## Activar o desactivar el acceso remoto del personal {#remote-access}

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

## Aprobar la recuperación del propietario de Cloud {#cloud-owner-recovery}

Si estás recuperando una cuenta propietaria de Cloud, verifica primero tu correo en la página de recuperación de Cloud.
En el local, abre **Sistema → Servicios Cloud** en el equipo principal vinculado y elige **Cargar solicitudes de recuperación**.
Debe haber iniciado sesión un administrador del equipo; usa **Entrar como administrador** si se te pide.

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

Si la caja principal deja de responder, mantén el terminal abierto. Cuando la franja roja ofrezca **Iniciar el local en la nube**, elige la opción para ver la dirección de emergencia y un código QR. Escanéalo con el móvil o elige **Abrir aquí** para salir del terminal y abrirla en este navegador. **Cerrar** vuelve al terminal.

Ten a mano el código de emergencia, tu contraseña de Waitron y un código del autenticador o de recuperación. El diálogo indica los roles que pueden iniciar el local; Cloud comprueba la disponibilidad antes de continuar. La opción permanece oculta hasta que Cloud habilite el alojamiento de emergencia para tu local.

En **Copias de seguridad**, elige **Hacer paquete de recuperación** en el servidor principal mientras Cloud esté disponible. Con permiso para gestionar el servidor, el paquete incluye la dirección y el código de emergencia, sus códigos QR y la fecha de emisión del código. Guárdalo bajo llave fuera del servidor. El código inicia una copia bloqueada; aún necesitas tu contraseña y tu autenticador o un código de recuperación. Las llaves de acceso no funcionan allí. Si falta la página de emergencia o ha fallado, lee su línea en la portada y haz un paquete nuevo cuando esté disponible.

Elige **Imprimir paquete de recuperación** en la tarjeta de Cloud para abrir el formulario en **Copias de seguridad**. El estado muestra cuándo se emitió el código impreso. Si ha cambiado, haz un paquete nuevo antes de necesitarlo. Si no se pudo comprobar, vuelve a intentarlo más tarde; eso por sí solo no significa que necesites otro paquete.

En la copia bloqueada, entra con tu correo de Waitron, contraseña y código del autenticador, o elige **Usar un código de recuperación**. Al entrar, comprueba tu nombre, la hora de cierre de la copia y cuándo fue el último contacto de Cloud con el servidor anterior. Si el estado de Cloud no está disponible, elige **Volver a comprobar**. Esta página aún no ofrece la declaración ni inicia el local.
