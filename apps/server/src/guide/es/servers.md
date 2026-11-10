# Servidores

## Cuando abres el equipo de reserva {#spare}

Si ves **Este es el equipo de reserva**, abre la dirección del equipo principal para usar las
pantallas y los datos del local. La página de reserva muestra su estado; no acepta ventas ni
ofrece acceso al panel de gestión.

## Traspasar el local a un equipo de reserva {#hand-over}

Usa este proceso solo con un equipo de reserva que haya terminado de unirse al local.

En el equipo principal, abre **Ajustes → Servidores**. Abre el menú de la fila del equipo de reserva
y elige **Traspasar el local**. Lee la explicación. Elige **Parar** para mantener el local en este
equipo, o **Traspasar el local** para detener las ventas aquí y mover la copia final. Si se te pide,
[confirma tu acceso](staff.md#account-access). Se reutiliza una confirmación reciente; si usaste un código
de recuperación, debes confirmar con el código actual del autenticador. Necesitas una cuenta con
contraseña y tener a mano esa contraseña y el código actual del autenticador, si está configurado,
para acceder en el equipo de reserva. Una llave de acceso no completa ese paso.

Mantén los dos equipos conectados. La página de traspaso se abre en el equipo de reserva y sigue
la transferencia. Cuando la copia esté lista, introduce la misma cuenta de administrador, compara
los relojes y crea la nueva serie. Elige **Iniciar el local en este equipo**. Si la página indica
que el equipo se está reiniciando, mantenla abierta hasta que aparezca **Continuar en este equipo**.
Los pagos ya registrados se conservan en la copia transferida.

Si se pierde una respuesta en Servidores, mantén abierto el diálogo y elige **Consultar el
progreso del traspaso**. En la página de traspaso del equipo de reserva puedes recargar para
consultar el progreso. No inicies otro traspaso. Un mensaje de espera describe el último intento;
mantén los dos equipos conectados mientras vuelven a intentarlo.

## Después del traspaso {#after-hand-over}

Usa la dirección del nuevo equipo. Si la página del equipo anterior ofrece **Progreso**, sigue el
enlace para continuar el traspaso en el de reserva. Conserva el equipo anterior y sus datos hasta
que esté disponible el proceso de devolución.

## Cuando el local ya no funciona con un equipo {#handed-over}

Si abres la dirección de un equipo en un navegador y ves una página titulada **El local ya no
funciona con este equipo**, ese equipo se ha retirado. No hace ventas ni envía nada a Hacienda. La
página indica, en negrita, el equipo que pasa a llevar el local.

Debajo, la página enumera cada paso del traspaso que este equipo ha registrado, en el orden en que
los registró, con la fecha y la hora de cada uno en la zona horaria del local.

Si la página ofrece **Progreso**, úsalo para terminar el traspaso en el equipo de reserva.

Mantén este equipo encendido mientras devuelve sus registros de facturación al equipo principal.
Actualiza la página para comprobar el progreso. No lo restablezcas hasta que la página diga
**Puedes restablecer este equipo**. Esa confirmación indica que el principal tiene los registros
devueltos; el envío a Hacienda continúa allí.

Si la devolución se detiene porque hay diferencias en los datos de facturación o de pago, mantén
ambos equipos encendidos y conserva sus datos. La resolución de estas diferencias aún no está
disponible. Los registros posteriores a una factura con diferencias pueden seguir pendientes en
este equipo: no lo restablezcas.

Si la página avisa de una diferencia de reloj, comprueba los relojes de ambos equipos y manténlos
encendidos mientras se vuelve a intentar la devolución. No restablezcas el equipo anterior.

La página aparece en español cuando tu navegador prefiere el español, y en inglés en los demás
casos.

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

Mantén este equipo encendido y conserva sus datos hasta que su página confirme que el principal
tiene todos los registros de facturación devueltos. No lo restablezcas mientras la devolución esté
esperando, enviándose o detenida.

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
