# Correo electrónico

Antes de depender del correo, envía una prueba con la configuración de tu proveedor. En el panel,
la prueba llega a la dirección de tu propia cuenta. Durante la configuración, llega a la dirección
del administrador que has introducido.

Antes de guardar o quitar el servidor de correo, confirma tu identidad en la ventana compartida.
[La confirmación](staff.md#account-access) dura 15 minutos o hasta que termine tu sesión.

## Configura un servidor de correo {#set-up}

En Preparación o En vivo, abre **Ajustes → Correo**. Con el permiso de administración del equipo (Admin de forma predeterminada), elige **Configurar servidor
de correo** o **Cambiar servidor de correo**, introduce los ajustes de tu proveedor y envía una prueba
antes de guardar. Introduce de nuevo los datos de acceso al cambiar un servidor con autenticación;
Waitron nunca muestra la contraseña guardada. Los gerentes pueden consultar los ajustes, pero no
guardarlos ni quitarlos.

Los mensajes enviados por tu servidor guardado y la prueba de esta página muestran el nombre del
local junto a la dirección del remitente. Si la página indica que la dirección guardada no es válida,
elige **Cambiar servidor de correo** y corrige **Dirección del remitente** antes de repetir la prueba.

Antes de completar la configuración en Preparación o En vivo, introduce los ajustes del servidor
y envía una prueba aceptada a la dirección del administrador. En desarrollo puedes omitir este paso.
Al guardar un servidor, las invitaciones y los enlaces para restablecer contraseñas llegan a buzones
reales. Revisa el estado del correo de cuentas en esta página y el de las facturas en **Servidor de
correo**: las cajas de desarrollo guardan las facturas localmente aunque el correo de cuentas use
el servidor guardado.

En Demostración, usa **Bandeja de correo** en la barra superior. Inicia sesión como gerente o administrador
para abrir los mensajes guardados.

## Comprueba el resultado de la prueba {#test-results}

Una prueba aceptada significa que el servidor de correo ha recibido el mensaje. Revisa tu bandeja,
incluido el correo no deseado. Si no aparece, comprueba la dirección del destinatario y la
información de entrega de tu proveedor.

Si el resultado indica que no se ha encontrado el nombre del servidor, revisa cómo está escrito.
Si rechaza el certificado, usa el nombre del servidor de tu proveedor y un certificado de confianza.
Si Waitron marca **Puerto**, revisa el puerto en la configuración de tu proveedor.

Si rechaza el cifrado, sigue la sugerencia de cifrado y puerto del resultado y envía otra prueba.
Cambiar el cifrado conserva el puerto que has escrito, así que cámbialo también cuando haga falta.

Si el servidor necesita iniciar sesión, introduce el nombre de usuario y la contraseña. En el
panel, activa primero **Usar autenticación**. Si los rechaza, revisa ambos antes de repetir la
prueba. Si no responde a tiempo o rechaza la prueba por otro motivo, revisa el puerto y el cifrado
y vuelve a intentarlo.

Si la configuración te pide probar el correo, repite la prueba después de cambiar los ajustes o
la dirección del administrador. Continuar se habilita cuando el servidor acepta una prueba con
esos ajustes para esa dirección.

## Quita un servidor de correo {#remove}

Con el permiso de administración del equipo (Admin de forma predeterminada), elige **Quitar servidor de correo** y lee la confirmación. **Parar** conserva
los ajustes. Al quitar el servidor también se borran sus datos de acceso; introdúcelos de nuevo
si lo configuras más adelante.

En Preparación o En vivo, los enlaces de acceso y las facturas no pueden enviarse hasta que
configures otro servidor; las ventas continúan.
En una caja de desarrollo, el correo vuelve al buzón de prueba. Si los ajustes no se cargan tras
quitar el servidor, vuelve a cargarlos; el servidor ya se ha quitado.
