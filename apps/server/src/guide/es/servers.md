# Servidores

## Cuando abres el equipo de reserva {#spare}

Si ves **Este es el equipo de reserva**, abre la dirección del equipo principal para usar las
pantallas y los datos del local. La página de reserva muestra su estado; no acepta ventas ni
ofrece acceso al panel de gestión.

## Iniciar aquí si ha fallado el equipo principal {#emergency}

Usa un equipo de reserva que haya terminado de unirse a este local. Apaga el equipo principal
anterior y mantenlo apagado, porque dos equipos principales encendidos podrían cobrar y enviar
registros por separado. Esta declaración no se puede deshacer.

Abre la dirección HTTPS del equipo de reserva y añade `/handover/emergency`, por ejemplo
`https://spare.example/handover/emergency`. Identifícate con la contraseña de una cuenta de
administrador y su código actual de autenticador, si está configurado, y elige **Comprobar esta
copia**. Revisa su última actividad con fecha. Puede faltar la actividad posterior; si no hay
ninguna fecha disponible, la página lo indica.

Lee las advertencias, marca las tres declaraciones y explica el motivo. Elige **Declarar apagado
el servidor principal anterior**. En la comprobación del reloj, marca **Estos datos son correctos.**
y elige **Continuar**: la página compara los relojes, crea las series de facturas nuevas e inicia
el local en este servidor sola. Si los relojes no coinciden, la página pregunta qué hora es la correcta: **Este dispositivo** pone la
hora de este equipo con la del dispositivo que estás usando y la página sigue; después de **El
servidor** o **Las dos horas están mal**, corrige la hora de este dispositivo y vuelve a conectarte. Mantén la página abierta durante el reinicio. Introduces tu contraseña y código una sola vez; si
el código caduca, introduce el código actual cuando se te pida y vuelve a intentar el paso. El
motivo y las declaraciones se conservan.

Si la copia cambia antes de declarar, revisa la nueva actividad y vuelve a marcar las tres
declaraciones.

Si se pierde una respuesta, mantén la página abierta y vuelve a comprobar la copia antes de
reintentar. Al recargar o abrir la dirección en otro dispositivo se encuentra la declaración
guardada; identifícate y continúa con la comprobación del reloj. Un traspaso controlado pendiente
ofrece su página de progreso. Si responde el equipo principal anterior, abre su enlace
**Servidores** o apágalo y vuelve a comprobarlo. Si no se puede verificar la copia con la
declaración, para y conserva los datos de ambos equipos.

## Conservar los datos del equipo averiado {#old-box-returns}

Usa el nuevo equipo principal cuando arranque. Conserva el equipo averiado y sus datos para la
devolución. Los registros de facturación y sus hechos de pago registrados pueden volver al nuevo
equipo principal; esto no repite pedidos, cambios de existencias, impresiones ni aperturas de
cajón. No restablezcas el equipo anterior mientras necesites sus datos.

## Traspasar el local a un equipo de reserva {#hand-over}

Usa este proceso solo con un equipo de reserva que haya terminado de unirse al local.

En el equipo principal, abre **Ajustes → Servidores**. Abre el menú de la fila del equipo de reserva
y elige **Traspasar el local**. Lee la explicación. Elige **Parar** para mantener el local en este
equipo, o **Traspasar el local** para detener las ventas aquí y mover la copia final. Si se te pide,
[confirma tu acceso](staff.md#account-access). Se reutiliza una confirmación reciente; si usaste un código
de recuperación, debes confirmar con el código actual del autenticador. Necesitas una cuenta con
contraseña y tener a mano esa contraseña y el código actual del autenticador, si está configurado,
para acceder en el equipo de reserva. Una llave de acceso no completa ese paso.

Mantén los dos equipos conectados. La página de traspaso se abre en el equipo de reserva y sigue la
transferencia. Cuando la copia esté lista, introduce la misma cuenta de administrador y elige
**Continuar a la comprobación del reloj**. Marca **Estos datos son correctos.** y elige
**Continuar**: la página compara los relojes y crea las series de facturas nuevas sola, también tras
cualquier espera, y después inicia el local en el equipo de reserva. Si los relojes no coinciden, la página pregunta qué hora es la correcta: **Este dispositivo** pone la
hora del equipo de reserva con la del dispositivo que estás usando y la página sigue; después de **El
servidor** o **Las dos horas están mal**, corrige la hora de este dispositivo y vuelve a conectarte. Un código del autenticador dura
menos de un minuto. Si el tuyo caduca antes de que la página lo use, la página te pide revisar la contraseña y el código: introduce un código nuevo y elige
**Volver a intentarlo** para seguir. Antes de **Continuar**,
**Editar estos datos** vuelve a la identificación. Si la página indica que el
servidor se está reiniciando, mantenla abierta hasta que aparezca **Continuar en este servidor**.
Los pagos ya registrados se conservan en la copia transferida.

Si se pierde una respuesta en Servidores, mantén abierto el diálogo y elige **Consultar el
progreso del traspaso**. En la página de traspaso del equipo de reserva puedes recargar para
consultar el progreso. No inicies otro traspaso. Un mensaje de espera describe el último intento;
mantén los dos equipos conectados mientras vuelven a intentarlo.

## Después del traspaso {#after-hand-over}

Usa la dirección del nuevo equipo. Si la página del equipo anterior ofrece **Progreso**, sigue el
enlace para continuar el traspaso en el de reserva. Conserva el equipo anterior y sus datos.

## Cuando el local ya no funciona con un equipo {#handed-over}

Si abres la dirección de un equipo en un navegador y ves una página titulada **El local ya no
funciona con este equipo**, ese equipo se ha retirado. No hace ventas ni envía nada a Hacienda. La
página indica, en negrita, el equipo que pasa a llevar el local.

Debajo, la página enumera cada paso del traspaso que este equipo ha registrado, en el orden en que
los registró, con la fecha y la hora de cada uno en la zona horaria del local.

Si la página ofrece **Progreso**, úsalo para terminar el traspaso en el equipo de reserva.

Mantén este equipo encendido mientras devuelve sus registros de facturación al equipo principal.
Actualiza la página para comprobar el progreso. Los reembolsos con tarjeta en curso se devuelven
con sus pagos originales para que el principal pueda comprobar su resultado. El envío a Hacienda
continúa en el principal. La confirmación significa que cada dato devuelto se ha recibido o se ha
cubierto mediante una diferencia de pago aceptada expresamente; para una diferencia aceptada, el
principal conserva sus propios datos de pago. Restablecer el equipo anterior borra sus datos del
local, incluidas las líneas de venta y las copias de seguridad locales. Esos datos no se incluyen
en esta devolución; conserva los datos del equipo anterior si los necesitas.

Si la devolución se detiene porque un registro de facturación entra en conflicto con uno del
equipo principal, sigue usando el principal y conserva los datos del equipo anterior si aún los
necesitas. La devolución no está confirmada. Puedes restablecer el equipo, pero eso borra sus
datos del local, incluidos los registros que sigan pendientes.

Si otros datos devueltos difieren, mantén ambos equipos encendidos y conserva sus datos. Solo se
pueden aceptar diferencias de pago admisibles mediante la API interna. Una persona administradora
puede consultarlas con GET `/management-api/return-clashes`
en el principal y aceptar una con POST `/management-api/return-clashes/:clashId/accept`, indicando
`actionKey` y `reason`. Todavía no hay una pantalla para ello. Después, apaga y enciende el equipo
detenido para reintentarlo. Cada nuevo lote en conflicto requiere su propia aceptación; solo
cuenta el grupo exacto aceptado.

Si la página avisa de una diferencia de reloj, comprueba los relojes de ambos equipos y manténlos
encendidos mientras se vuelve a intentar la devolución. No restablezcas el equipo anterior.

La página aparece en español cuando tu navegador prefiere el español, y en inglés en los demás
casos.

## Comprobar los intervalos del traspaso {#reconciliation}

Después de un traspaso de emergencia, abre **Informes** y después **Intervalos del traspaso** para
comprobar el período cuya actividad podría faltar. Necesitas permiso para ver informes. La lista
muestra los equipos principal anterior y nuevo, la última hora de venta o pedido en la copia, las horas
de declaración y activación, y el motivo indicado al tomar el relevo. Todas las horas usan la zona
horaria del local. **Desconocida** significa que la copia no tenía ventas ni pedidos fechados; no significa
que no falte dinero.

Ventas, el arqueo, los informes por categorías y el IVA muestran un aviso de traspaso con un enlace
a esta lista. Comprueba las fechas del traspaso antes de decidir si las cifras cubren el período que
necesitas. Pulsa **Actualizar el estado del traspaso** para comprobarlo de nuevo. El aviso se mantiene
tras recibir un inventario.

Pulsa **Actualizar intervalos** para comprobar la recepción del inventario. **Recepción del inventario
confirmada** significa que el nuevo equipo ha contabilizado todos los lotes de un inventario anunciado
por el anterior. No confirma la actividad que falte ni los importes, ni reconstruye los arqueos. Una
recepción sin confirmar necesita una devolución completa; si el equipo anterior ya dejó de enviar,
reinícialo mientras sigue restringido para que reenvíe los datos. Si vuelve el equipo anterior,
comprueba el estado de la devolución en su página antes de decidir si lo restableces.

Debajo de los intervalos, **Facturas devueltas** muestra cada factura recibida por primera vez
con el equipo de origen, la instalación que la generó, la fecha de expedición original y los
importes registrados. Las filas de facturas muestran un tipo legible junto a su código original.
Las correcciones y anulaciones aparecen por separado. **No consta** indica que ese importe no
figura en el registro. Usa **Siguiente** y **Anterior** para seguir leyendo; **Actualizar facturas**
vuelve a la primera página.

El seguimiento empieza con esta función. No se añaden las facturas que ya estaban en una copia,
por lo que una lista vacía no es un historial completo de devoluciones anteriores. La lista no
identifica duplicados.

El aviso de los informes también indica si hay facturas devueltas registradas, independientemente
de las fechas que selecciones. Abre **Facturas devueltas** para comprobar sus fechas de expedición
originales. Usa las cifras que muestra cada informe; no añadas los importes de la lista a los
totales del informe.

## Cuando un equipo espera a otro equipo {#waiting}

Cuando un equipo se inicia y no consigue contactar con el otro equipo del local, espera en lugar de
vender, porque el otro quizá ha pasado a llevar el local. Su página, titulada **Este equipo está
esperando a** y el nombre del otro equipo, lo indica. Mientras espera no hace ventas ni envía nada
a Hacienda. Vuelve a preguntar cada 15 segundos; cuando el otro equipo responde, este se inicia con
normalidad o, si el otro ha pasado a llevar el local, lo indica.

## Seguir como equipo principal {#carry-on}

Si sabes que el otro equipo está apagado, puedes dejar que este equipo siga sin él. Abre el equipo
en su dirección `https://`, inicia sesión como administrador en **Seguir como equipo principal** y
marca las dos casillas. Este equipo lleva entonces el local hasta que se reinicie, y entonces vuelve
a preguntar al otro equipo.

Si el otro equipo responde antes, manda su respuesta. Un equipo que ya ha pasado el local no puede
seguir; su página lo indica en lugar de mostrar el formulario.

Si la copia de seguridad confirma que otro equipo ha pasado a llevar el local, este equipo se
niega a seguir como principal. Abre el otro equipo con el enlace. Si esa información aparece después
de continuar, este equipo deja de aceptar ventas. Usa el nuevo equipo principal. Los equipos antiguos
pueden compartir dirección: comprueba qué equipo has abierto.

Mantén este equipo encendido y conserva sus datos mientras devuelve los registros. Puedes
restablecerlo, pero eso borra sus datos del local aunque la devolución se haya detenido o no haya
terminado.

## Activar o desactivar el acceso remoto del personal {#remote-access}

Activar el acceso remoto pide la [confirmación de identidad compartida](staff.md#account-access).
Desactivarlo no pide una nueva confirmación de identidad.

Para impedir que el personal abra el panel desde fuera del local, abre **Servicios Cloud** en **Ajustes**
en el equipo principal y elige **Desactivar el acceso remoto**. Si usas la dirección del personal,
confirma **Desactivar el acceso remoto** para desconectarte también, o elige **Detener** para mantenerlo activado. Ten a mano la dirección local del equipo. La vinculación con
Cloud y los demás servicios de Cloud se mantienen. Elige **Activar el acceso remoto** para que el
equipo vuelva a conectarse.

El estado junto al botón es la opción que has guardado. Abre la dirección del personal para
comprobar si puedes conectarte; esta página no prueba esa conexión. Si un cambio falla, revisa la opción guardada y elige **Actualizar estado** para volver a intentar la conexión. **Detener el acceso a Cloud** es la opción aparte
que detiene permanentemente todos los servicios de Cloud.
