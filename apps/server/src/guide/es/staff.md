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
nueva invitación. Deshabilitar una cuenta también borra su PIN, contraseña, llaves de acceso,
verificación en dos pasos y vínculo con Google. Al volver a habilitarla se envía una nueva
invitación. Los gerentes no ven estas acciones.

Si Waitron no puede verificar tu passkey, puedes reintentarlo o elegir **Usar tu contraseña**
para iniciar sesión. En la pantalla de contraseña, **¿Has olvidado tu contraseña?** solicita un
correo con un enlace para elegir una nueva. La confirmación es la misma para todas las direcciones;
no confirma que exista una cuenta ni que pueda acceder. Restablecer la contraseña no habilita una
cuenta deshabilitada.

## Tu propia cuenta {#own-account}

Abre **Configuración de la cuenta** desde el menú de cuenta para cambiar tus propios datos de
acceso. Puedes seguir gestionando tu correo, contraseña, PIN, llaves de acceso y verificación en
dos pasos.

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

## Eliminar un rol de personal {#delete-staff-role}

En la lista de roles de personal, elige **Eliminar** en el menú del rol. La ventana muestra
**Comprobando qué cambia…** mientras consulta las consecuencias. Revisa **Trabajo que finaliza**
y **Configuración que se elimina** cuando aparezcan esas secciones antes de confirmar la eliminación.
