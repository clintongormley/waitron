# Correo electrónico

Antes de depender del correo, envía una prueba con la configuración de tu proveedor. En el panel,
la prueba llega a la dirección de tu propia cuenta. Durante la configuración, llega a la dirección
del administrador que has introducido.

## Comprueba el resultado de la prueba {#test-results}

Una prueba aceptada significa que el servidor de correo ha recibido el mensaje. Revisa tu bandeja,
incluido el correo no deseado. Si no aparece, comprueba la dirección del destinatario y la
información de entrega de tu proveedor.

Si Waitron marca **Servidor de correo**, revisa cómo está escrito. Si rechaza el certificado,
necesitas un servidor con un certificado de confianza; Waitron no ofrece una opción para omitir
esta comprobación. Si marca **Puerto**, revisa el puerto en la configuración de tu proveedor.

Si rechaza el cifrado, sigue la sugerencia de cifrado y puerto del resultado y envía otra prueba.
Cambiar el cifrado conserva el puerto que has escrito, así que cámbialo también cuando haga falta.

Si el servidor necesita iniciar sesión, introduce el nombre de usuario y la contraseña. En el
panel, activa primero **Usar autenticación**. Si los rechaza, revisa ambos antes de repetir la
prueba. Si no responde a tiempo o rechaza la prueba por otro motivo, revisa el puerto y el cifrado
y vuelve a intentarlo.

Durante la configuración, repite la prueba después de cambiar los ajustes o la dirección del
administrador. Continuar se habilita cuando el servidor acepta una prueba con esos ajustes para
esa dirección.
