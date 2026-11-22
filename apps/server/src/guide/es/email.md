# Correo electrónico

Antes de depender del correo, envía una prueba con la configuración de tu proveedor. En el panel,
la prueba llega a la dirección de tu propia cuenta. Durante la configuración, llega a la dirección
del administrador que has introducido.

Antes de guardar o quitar el servidor de correo, confirma tu identidad en la ventana compartida.
[La confirmación](staff.md#account-access) dura 15 minutos o hasta que termine tu sesión.

## Configura un servidor de correo {#set-up}

Fuera de Demostración, abre **Sistema → Correo**. Con el permiso de administración del equipo
(Admin de forma predeterminada), elige **Configurar servidor de correo** o **Cambiar servidor de
correo**, introduce los ajustes de tu proveedor y envía una prueba antes de guardar. Introduce
de nuevo los datos de acceso al cambiar un servidor con autenticación; Waitron nunca muestra la
contraseña guardada. Los encargados pueden consultar los ajustes, pero no guardarlos ni quitarlos.

Los mensajes enviados por tu servidor guardado y la prueba de esta página muestran el nombre del
local junto a la dirección del remitente. Si la página indica que la dirección guardada no es válida,
elige **Cambiar servidor de correo** y corrige **Dirección del remitente** antes de repetir la prueba.

Durante la configuración en Preparación o En vivo, introduce los ajustes del servidor de correo
y envía una prueba a la dirección del administrador. La configuración solo prueba un servidor de
correo que ofrezca inicio de sesión con nombre de usuario y contraseña. Si el tuyo acepta correo sin
iniciar sesión, usa durante la configuración uno que lo ofrezca y cámbialo después por el tuyo en **Sistema → Correo**, donde **Usar
autenticación** puede quedar desactivado. Puedes omitir el servidor en desarrollo o si
[eliges Cloud para el correo del personal durante la configuración de prueba](email.md#cloud-staff-email).
Si usas tu propio servidor, al guardarlo las invitaciones y los enlaces para restablecer
contraseñas llegan a buzones reales. Esta página muestra el estado del correo de facturas:
las cajas de desarrollo guardan las facturas localmente aunque el correo de cuentas use
un servidor guardado o Cloud.

En Demostración, usa **Bandeja de correo** en la barra superior. Inicia sesión como encargado o administrador
para abrir los mensajes guardados.

## Envía el informe diario de ventas por correo {#daily-report}

En **Sistema → Correo**, activa **Enviar el informe diario por correo**, elige los destinatarios
y guarda. Cada destinatario necesita una dirección de correo en su cuenta y acceso a **Ventas y
cobros**. Configura un servidor de correo en la misma página para que Waitron pueda enviar el informe.
Para obtener las cifras del día, abre **Ventas y cobros** y selecciona la fecha. Elige una
impresora y pulsa **Imprimir ventas por categoría**, o pulsa **Descargar para tu gestor (XLSX)**
si puedes exportar informes.

Waitron envía el informe del último día de actividad terminado cuando concluye el cierre
automático. También puedes recibirlo después de un reinicio de la caja. Tras un cierre que abarque
varios días, abre **Ventas y cobros** y elige un día anterior para consultar sus cifras.

## Elegir el correo del personal durante la configuración de prueba {#cloud-staff-email}

En un servidor de pruebas, abre **Preparación** e inicia sesión en Waitron Cloud. En el paso de correo,
marca **Enviar el correo del personal a través de Waitron Cloud**. Deja el servidor de correo
en blanco y continúa. Cuando el equipo se reinicie y se conecte, Cloud podrá enviar invitaciones
al personal, enlaces para restablecer contraseñas y códigos de cambio de correo.

Si eliges Cloud y dejas en blanco el servidor de correo, Cloud también envía los avisos sobre
cambios de seguridad de la cuenta y de roles, y el aviso a la dirección anterior cuando otra
persona cambia el correo de un miembro del personal en **Usuarios**. Los encargados con correo
electrónico también pueden recibir alertas por falta de espacio, copias de seguridad eliminadas o
detenidas, actualizaciones revertidas y correcciones del reloj. Si añades tu propio servidor de
correo, Waitron lo usa para esos mensajes. Para enviar correos a clientes, enviar el informe diario
o recibir otras alertas del equipo por correo, añade un servidor en **Sistema → Correo**.

Si la configuración indica que no se ha podido confirmar el correo del personal de Cloud, abre
**Sistema → Correo** para añadir o revisar el servidor que usas para el correo del personal.

## Correo de cuentas a través de Cloud de prueba {#cloud-account-email}

Tu servidor de correo guardado envía las invitaciones, los enlaces para restablecer contraseñas y
los códigos de cambio de correo. Si dejas el servidor en blanco y activas el correo de Cloud de
prueba, Cloud envía esos mensajes. En Demostración fuera de desarrollo, activa el correo de Cloud
para enviar al buzón real del destinatario. Si no lo activas, abre la **Bandeja de correo** de
Demostración.

En un servidor configurado para enviar registros fiscales de prueba, los encargados con correo
electrónico pueden recibir recordatorios de caducidad del certificado a través de Cloud de prueba
si activas el correo de Cloud y dejas en blanco el servidor de correo.

Los enlaces de Cloud vuelven a tu caja. Ábrelos desde una red que pueda acceder a ella. La
invitación de Cloud no incluye tus roles ni el enlace opcional de privacidad del local. Si no
llega un correo, solicita un enlace o código nuevo; un mensaje anterior aún puede llegar después.
Si dependes del correo de Cloud y deja de estar disponible, restablece Cloud. Fuera de
Demostración, también puedes añadir un servidor de correo en **Sistema → Correo**. Si los ajustes
de correo guardados no funcionan, las invitaciones, los enlaces para restablecer contraseñas y
los códigos de cambio de correo quedan pendientes hasta que los corrijas. Corrige los ajustes y
envía otra prueba.

## Comprueba el resultado de la prueba {#test-results}

Una prueba aceptada significa que el servidor de correo ha recibido el mensaje. Revisa tu bandeja,
incluido el correo no deseado. Si no aparece, comprueba la dirección del destinatario y la
información de entrega de tu proveedor.

Si el resultado indica que no se ha encontrado el nombre del servidor, revisa cómo está escrito.
Si rechaza el certificado, usa el nombre del servidor de tu proveedor y un certificado de confianza.
Si Waitron marca **Puerto**, revisa el puerto en la configuración de tu proveedor.

Si rechaza el cifrado, sigue la sugerencia de cifrado y puerto del resultado y envía otra prueba.
Cambiar el cifrado conserva el puerto que has escrito, así que cámbialo también cuando haga falta.

Si el servidor rechaza el usuario o la contraseña, revisa ambos antes de repetir la prueba. Si no
responde a tiempo o rechaza la prueba por otro motivo, revisa el puerto y el cifrado y vuelve a
intentarlo.

Si la configuración te pide probar el correo, repite la prueba después de cambiar los ajustes o
la dirección del administrador. Continuar se habilita cuando el servidor acepta una prueba con
esos ajustes para esa dirección.

## Quita un servidor de correo {#remove}

Con el permiso de administración del equipo (Admin de forma predeterminada), elige **Quitar servidor de correo** y lee la confirmación. **Parar** conserva
los ajustes. Al quitar el servidor también se borran sus datos de acceso; introdúcelos de nuevo
si lo configuras más adelante.

Fuera de desarrollo, al quitar el servidor se detiene el envío de recibos por correo. Si has activado
el correo de Cloud de prueba, Cloud puede enviar el [correo de cuentas](email.md#cloud-account-email).
Las ventas continúan. En una caja de desarrollo sin correo de Cloud, consulta el buzón de prueba.
Si los ajustes no se cargan tras quitar el servidor, vuelve a cargarlos. El servidor ya se ha quitado.
