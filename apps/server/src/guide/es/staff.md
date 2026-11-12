# Usuarios

Usa **Usuarios** para mantener al día los datos del equipo. Solo un administrador puede gestionar
el acceso de otra persona, para que editar sus datos de contacto no permita entrar en su cuenta.

## Nombres y datos de contacto {#staff-details}

Como gerente, abre el menú de una persona y elige **Editar** para cambiar sus nombres y teléfono.
Su correo es su dirección de acceso, por lo que solo un administrador puede cambiarlo. Lo mismo
se aplica al rol y al estado de la cuenta.

## Acceso a la cuenta {#account-access}

Como administrador, puedes añadir personas y enviar su invitación, reenviar una invitación,
restablecer el PIN o el acceso, y deshabilitar o volver a habilitar cuentas. Restablecer el PIN
lo borra; la persona elige el nuevo. Restablecer el acceso borra sus credenciales y envía una
nueva invitación si el correo está configurado; si Waitron no lo permite o no cambia nada,
consulta [Pérdidas habituales](data-protection.md#breach-losses). Deshabilitar una cuenta también
borra su PIN, contraseña, llaves de acceso, verificación en dos pasos, códigos de recuperación y
vínculo con Google. Al volver a habilitarla se envía una nueva
invitación. Los gerentes no ven estas acciones.

Para configurar el envío de estos enlaces, abre [Configuración del correo](email.md#set-up). Si una invitación no llega en unos minutos, revisa el correo no deseado del destinatario y Correo antes de reenviarla: solo funciona el enlace más reciente. Si un reintento indica que no ha cambiado nada, espera un minuto.

Si Waitron no puede verificar tu passkey, puedes reintentarlo o elegir **Usar tu contraseña**
para iniciar sesión. En la pantalla de contraseña, **¿Has olvidado tu contraseña?** solicita un
correo con un enlace para elegir una nueva. La confirmación es la misma para todas las direcciones;
no confirma que exista una cuenta ni que pueda acceder. Restablecer la contraseña no habilita una
cuenta deshabilitada.

Waitron te pide que vuelvas a identificarte antes de invitar a alguien, reenviar una invitación,
restablecer su acceso, deshabilitar o volver a habilitar su cuenta, o cambiar un correo, rol o
estado en **Usuarios**, incluido tu propio correo. Los nombres, el teléfono y el restablecimiento
del PIN no necesitan esta confirmación.
También confirmas antes de cambiar las copias de seguridad, descargar archivos de recuperación,
mostrar la clave de recuperación de las copias o exportar la configuración o los datos de otro
miembro del personal. La misma confirmación cubre conectar o desconectar proveedores de pagos,
cambiar el servidor de correo o la conexión Cloud, activar el acceso remoto, preparar un equipo
sustituto, instalar el certificado fiscal, cambiar la razón social y quitar un servidor.
Usa tu contraseña o passkey y, si tienes
verificación en dos pasos, un código del autenticador o de recuperación. La confirmación cubre
estas acciones en este navegador durante 15 minutos o hasta que termine tu sesión.
Elige **Cancelar** para dejar la acción sin realizar. Si el disco está lleno, abre **Estado del
equipo** y usa **Liberar** para dejar espacio antes de confirmar. Consulta
[Liberar espacio en el equipo](box-status.md#free-space).

## Tu propia cuenta {#own-account}

Abre **Configuración de la cuenta** desde el menú de cuenta para cambiar tus propios datos de
acceso. Puedes seguir gestionando tu correo, contraseña, PIN, llaves de acceso y verificación en
dos pasos.

Estos cambios usan la misma confirmación de 15 minutos que las otras acciones protegidas. Si usas
un autenticador, introduce su código actual para cada cambio de acceso; un código de recuperación
no lo sustituye. Puedes crear una contraseña con **Añadir** si normalmente accedes con una
passkey.

También puedes cambiar tu nombre, nombre visible, teléfono e idioma, y vincular Google en **Seguridad** si está disponible.

Para confirmar una nueva dirección, introduce el código que llegue a ella. Si el correo no está configurado, usa el enlace a Correo o **Iniciar sesión como administrador** que ofrece el resultado; después vuelve a tu cuenta, introduce de nuevo la dirección en **Tus datos** y guarda. Si el código no llega en unos minutos, vuelve a introducir la nueva dirección y guarda: solo funciona el código más reciente.

En **Seguridad**, elige **Añadir passkey** junto a **Passkeys**.
Sigue las instrucciones de tu gestor de contraseñas para añadirla.

Si tu local tiene una dirección web para el personal desde fuera, inicia sesión allí con tu
correo y contraseña habituales. Para usar una passkey en esa dirección, abre allí
**Configuración de la cuenta** y añade una, aunque ya uses una en la dirección de la red local.

## Descargar tus datos {#own-data}

Abre **Configuración de la cuenta** desde el menú de cuenta y, en **Tus datos**, pulsa
**Descargar** junto a **Copia de tus datos**. Recibes un archivo ZIP con tus datos de perfil y de
acceso en archivos `.json`. Si el local planifica el personal o registra la jornada en Waitron,
la copia también puede contener tus datos de contrato, tus turnos, tus ausencias, tus roles de
personal y las preguntas sobre tus fichajes en archivos `.json`, y tu registro de jornada en PDF y
en una hoja de cálculo `.csv`. Puede haber también un `actions.json`: las ventas completas ya
registradas cuya anulación autorizaste, las devoluciones que pediste, autorizaste o cuyo resultado
registraste, y las aperturas del cajón de efectivo que hiciste o autorizaste. Puede haber también un
`adjustments.json`: las cancelaciones y los descuentos en una cuenta que hiciste indicando un
motivo, o que autorizaste a otra persona.

Un `README.txt` explica cada archivo, quién más recibe los datos, cuánto tiempo se guardan y tus
derechos. La copia nunca contiene secretos como tu PIN o tu contraseña. Para cualquier otra cosa
sobre tus datos, pregunta al local.

## Descargar los datos de otra persona {#person-data}

Como administrador, puedes descargar la copia de los datos de otra persona, por ejemplo cuando
alguien que ya no trabaja en el local la pide. En
**Usuarios**, elige **Todos los estados** en **Estado** si la persona está deshabilitada, abre el
menú de su fila y elige **Descargar sus datos**. Recibes los mismos archivos que la persona
obtiene con **Copia de tus datos**, con su `README.txt` en el idioma que eligió la persona o, si
no eligió ninguno, en el idioma del local. Los gerentes no ven esta acción. Waitron no guarda una
lista de estas solicitudes, así que anota la solicitud y tu respuesta en los registros del local.
El plazo de un mes para responder y las demás obligaciones del local están en
[Protección de datos](data-protection.md#who-does-what).

## Descargar los datos de un cliente de factura {#invoice-customer-data}

Cuando un cliente pregunta qué datos suyos tiene el local, un administrador puede buscar sus
facturas completas por su identificador y descargarlas. En **Pedidos**, pulsa **Buscar un cliente
de factura**. Para un NIF español, mantén **NIF español**, escribe el número y pulsa **Buscar**.
En esa búsqueda las mayúsculas, los espacios, los puntos, los guiones y un ES al principio no
cambian nada. Para otro documento, elige su tipo y país emisor e introduce el número exacto tal
como se guardó, incluidos los espacios y las mayúsculas. La ventana muestra las facturas completas
que coinciden en los tres datos;
pulsa **Descargar sus datos** para obtener un ZIP con una copia en PDF de cada factura, un archivo
`invoices.json` con el nombre, el identificador, su tipo y país emisor cuando existen y la dirección de cada una y todas las direcciones de correo
a las que la caja la envió o intentó enviarla, y un `README.txt` en el idioma del local. Los
gerentes no ven esta acción. Una reserva no lleva NIF, así que esta búsqueda no encuentra reservas.
Waitron no guarda una lista de estas solicitudes, así que anota la solicitud y tu respuesta en los
registros del local. El plazo de un mes para responder y las demás obligaciones del local están en
[Protección de datos](data-protection.md#who-does-what).

## Eliminar un rol de personal {#delete-staff-role}

En la lista de roles de personal, elige **Eliminar** en el menú del rol. Comprueba cuántas
personas lo tienen y confirma. Esto quita sus puestos y los bloques del plan de personal.
Los turnos existentes conservan el nombre del puesto. Para asignar nuevos turnos, elige otro.

## Puestos por persona {#job-roles}

Para incluir a alguien en el cuadrante y en la lista de acceso de los dispositivos que aceptan su puesto, abre su editor en **Usuarios**, elige sus **Puestos** y pulsa
**Guardar puestos**. Necesitas permiso para gestionar el horario. Estas etiquetas se guardan por
separado de los datos de la persona. Si alguien las cambia mientras editas, pulsa **Recargar** para
ver sus puestos actuales antes de elegir de nuevo.

## Quién puede iniciar sesión en un dispositivo {#device-profile-sign-in}

Abre **Perfiles de dispositivo** y edita el perfil que usa el dispositivo. En **Quién puede iniciar
sesión**, selecciona sus puestos y guarda. Por ejemplo, selecciona Camarero para un móvil que usa
el personal de sala. Las personas que tienen un puesto seleccionado pueden iniciar sesión; sus
permisos siguen decidiendo lo que pueden hacer. No marques ningún puesto para que nadie pueda
iniciar sesión. Un perfil nuevo empieza con todos los puestos actuales seleccionados. Al copiar
un perfil se conservan sus selecciones. Si añades un puesto después, selecciónalo en los perfiles
donde sus titulares necesiten iniciar sesión.

## Horas y descansos {#hours}

Usa **Iniciar descanso** y **Terminar descanso** para una pausa durante tu turno. Usa **Fichar salida** cuando termines de trabajar.

Si falta un fichaje o su hora es incorrecta, elige **Corregir mis horas** en el menú de tu nombre.
En un dispositivo de mano, abre **Más** si tu nombre está ahí. La opción aparece cuando puedes
fichar. Elige la **Fecha** y pulsa **Corregir hora** junto a un fichaje, o **Fichar entrada**,
**Fichar salida**, **Iniciar descanso** o **Terminar descanso** para añadir uno que falta.
También puedes añadir juntos la entrada y la salida que faltan, o el inicio y el fin de un descanso.

Introduce las fechas y horas reales y un **Motivo**, y pulsa **Guardar** para registrar tu
solicitud. Pide a otro supervisor, gerente o administrador que elija **Aprobar con PIN**,
seleccione su nombre e introduzca su PIN. Si eres administrador, puedes aprobar tu propia
solicitud. Consulta su estado en **Mis horas**.
