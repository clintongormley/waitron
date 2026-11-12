export const handoverEn = {
  "handover.heading": "Hand over the venue",
  "handover.loading": "Reading handover progress…",
  "handover.copy":
    "Preparing the final copy. Keep both boxes connected. Sales stay stopped until the new box is ready.",
  "handover.read_failed":
    "Could not read handover progress. Keep this page open while it reconnects.",
  "handover.wait":
    "The last attempt could not continue. Keep both boxes connected; this page checks again automatically.",
  "handover.space":
    "The last attempt found too little room on this box. Make room, then keep this page open to try again.",
  "handover.source":
    "The last attempt could not reach the old box. Check its power and network connection.",
  "handover.done": "This box has taken over the venue.",
  "handover.restarting": "The venue has started here; this box is restarting.",
  "handover.continue": "Continue to this box",
  "handover.closed":
    "This handover ended without activating this box. Open Servers on the main box to see its current state.",
  "handover.sign_in":
    "Sign in as an administrator to confirm the details and start the venue here. Use a fresh authenticator code.",
  "handover.email": "Administrator email",
  "handover.password": "Password",
  "handover.code": "Authenticator code, if set up",
  "handover.compare": "Continue to clock check",
  "handover.starting": "Starting the venue on this box…",
  "handover.try_again": "Try again",
  "handover.fix": "Complete the highlighted fields to continue.",
  "handover.required": "Complete this field.",
  "handover.zone": "Times are shown in your device’s time zone.",
  "handover.emergency.sign_in":
    "Sign in as an administrator to check this spare and start the venue here. Enter your password and current authenticator code, if set up. You only need a new code if this one expires.",
  "handover.emergency.saved":
    "This declaration is saved and cannot be undone. Stop leaves this page; it does not cancel the declaration.",
  "handover.emergency.copy": "Copy held on this spare",
  "handover.emergency.copy_changed":
    "The copy changed while you were reading. Review its latest activity and confirm all three statements again.",
  "handover.emergency.latest_activity": "Latest dated activity:",
  "handover.emergency.declared_at": "Declared:",
  "handover.emergency.no_date": "No dated activity was found in this copy.",
  "handover.emergency.servers": "Open Servers on the old main box",
  "handover.emergency.one_way":
    "This declaration cannot be undone. Switch off the old main box before continuing, and keep it switched off.",
  "handover.emergency.split":
    "If the old main box is still running, both boxes could take payments and file records separately. Do not continue while it is running.",
  "handover.emergency.returned":
    "Keep the old box and its data. Its invoice records and recorded payment facts can return later; orders, stock changes and drawer openings are not replayed.",
  "handover.emergency.sourceSwitchedOff": "I have switched off the old main box.",
  "handover.emergency.noParallelRecovery":
    "No other box or cloud recovery is being started for this venue.",
  "handover.emergency.missingTailAccepted":
    "I accept that this copy may be missing the old box’s latest activity.",
  "handover.emergency.reason": "Why are you starting the venue here?",
  "handover.emergency.reason_long": "Use no more than 500 characters.",
  "handover.emergency.check": "Check this copy",
  "handover.emergency.declare": "Declare the old main box switched off",
  "handover.emergency.stop": "Stop",
  "handover.emergency.progress": "Open handover progress",
  "handover.emergency.controlled_link": "Open the unfinished handover",
  "handover.emergency.code_expired":
    "Your authenticator code may have expired. Enter its current code and try again.",
  "handover.emergency.sign_in_failed":
    "Sign-in could not be confirmed. Check your password and enter your current authenticator code, if set up, then try again.",
  "handover.emergency.permission":
    "This sign-in cannot start the venue. Sign in with an administrator account here.",
  "handover.emergency.throttled": "Too many sign-in attempts. Wait a moment, then try again.",
  "handover.emergency.source_answered":
    "The old main box answered. Open its Servers page, or switch it off and check again.",
  "handover.emergency.controlled":
    "An unfinished controlled handover must be resolved first. Open its progress page.",
  "handover.emergency.copy_failed":
    "This copy could not be verified against the saved declaration. Stop here; keep this box and the old box’s data intact.",
  "handover.emergency.changed":
    "The venue or handover has changed. Check progress and use the current main box.",
  "handover.emergency.trust":
    "The old main box’s identity or address could not be checked. Check its connection and address in Servers before trying again.",
  "handover.emergency.failed":
    "This step could not finish. Check this copy again before trying to continue.",
} as const;
export const handoverEs: Record<keyof typeof handoverEn, string> = {
  "handover.heading": "Traspasar el local",
  "handover.loading": "Consultando el progreso del traspaso…",
  "handover.copy":
    "Preparando la copia final. Mantén los dos servidores conectados. Las ventas siguen detenidas hasta que el nuevo servidor esté listo.",
  "handover.read_failed":
    "No se pudo consultar el progreso. Mantén esta página abierta mientras se recupera la conexión.",
  "handover.wait":
    "El último intento no pudo continuar. Mantén los dos servidores conectados; esta página vuelve a comprobarlo automáticamente.",
  "handover.space":
    "El último intento detectó poco espacio en este servidor. Libera espacio y mantén esta página abierta para volver a intentarlo.",
  "handover.source":
    "El último intento no pudo conectar con el servidor anterior. Comprueba su alimentación y conexión de red.",
  "handover.done": "Este servidor ha pasado a llevar el local.",
  "handover.restarting": "El local se ha iniciado aquí; este servidor se está reiniciando.",
  "handover.continue": "Continuar en este servidor",
  "handover.closed":
    "Este traspaso terminó sin activar este servidor. Abre Servidores en el servidor principal para consultar su estado actual.",
  "handover.sign_in":
    "Identifícate como administrador para confirmar los datos e iniciar el local aquí. Usa un código nuevo del autenticador.",
  "handover.email": "Correo del administrador",
  "handover.password": "Contraseña",
  "handover.code": "Código de autenticador, si está configurado",
  "handover.compare": "Continuar a la comprobación del reloj",
  "handover.starting": "Iniciando el local en este servidor…",
  "handover.try_again": "Volver a intentarlo",
  "handover.fix": "Completa los campos resaltados para continuar.",
  "handover.required": "Completa este campo.",
  "handover.zone": "Las horas se muestran en la zona horaria de tu dispositivo.",
  "handover.emergency.sign_in":
    "Identifícate como administrador para comprobar esta copia e iniciar el local aquí. Introduce tu contraseña y el código actual del autenticador, si está configurado. Solo necesitas un código nuevo si este caduca.",
  "handover.emergency.saved":
    "Esta declaración está guardada y no se puede deshacer. Parar sale de esta página; no cancela la declaración.",
  "handover.emergency.copy": "Copia guardada en este servidor de reserva",
  "handover.emergency.copy_changed":
    "La copia cambió mientras la leías. Revisa su última actividad y vuelve a confirmar las tres declaraciones.",
  "handover.emergency.latest_activity": "Última actividad con fecha:",
  "handover.emergency.declared_at": "Declarado:",
  "handover.emergency.no_date": "No se encontró actividad con fecha en esta copia.",
  "handover.emergency.servers": "Abrir Servidores en el servidor principal anterior",
  "handover.emergency.one_way":
    "Esta declaración no se puede deshacer. Apaga el servidor principal anterior antes de continuar y mantenlo apagado.",
  "handover.emergency.split":
    "Si el servidor principal anterior sigue encendido, ambos servidores podrían cobrar y enviar registros por separado. No continúes mientras siga encendido.",
  "handover.emergency.returned":
    "Conserva el servidor anterior y sus datos. Sus registros de facturación y hechos de pago registrados podrán volver más adelante; no se repiten pedidos, cambios de existencias ni aperturas de cajón.",
  "handover.emergency.sourceSwitchedOff": "He apagado el servidor principal anterior.",
  "handover.emergency.noParallelRecovery":
    "No se está iniciando otro servidor ni una recuperación en la nube para este local.",
  "handover.emergency.missingTailAccepted":
    "Acepto que esta copia puede no incluir la actividad más reciente del servidor anterior.",
  "handover.emergency.reason": "¿Por qué vas a iniciar el local aquí?",
  "handover.emergency.reason_long": "No uses más de 500 caracteres.",
  "handover.emergency.check": "Comprobar esta copia",
  "handover.emergency.declare": "Declarar apagado el servidor principal anterior",
  "handover.emergency.stop": "Parar",
  "handover.emergency.progress": "Abrir el progreso del traspaso",
  "handover.emergency.controlled_link": "Abrir el traspaso pendiente",
  "handover.emergency.code_expired":
    "Puede que tu código de autenticador haya caducado. Introduce el código actual y vuelve a intentarlo.",
  "handover.emergency.sign_in_failed":
    "No se pudo confirmar tu identidad. Comprueba la contraseña e introduce el código actual del autenticador, si está configurado, y vuelve a intentarlo.",
  "handover.emergency.permission":
    "Esta cuenta no puede iniciar el local. Identifícate aquí con una cuenta de administrador.",
  "handover.emergency.throttled":
    "Demasiados intentos de acceso. Espera un momento y vuelve a intentarlo.",
  "handover.emergency.source_answered":
    "El servidor principal anterior ha respondido. Abre su página Servidores o apágalo y vuelve a comprobarlo.",
  "handover.emergency.controlled":
    "Primero hay que resolver un traspaso controlado pendiente. Abre su página de progreso.",
  "handover.emergency.copy_failed":
    "No se pudo verificar esta copia con la declaración guardada. Para aquí y conserva los datos de ambos servidores.",
  "handover.emergency.changed":
    "El local o el traspaso ha cambiado. Comprueba el progreso y usa el servidor principal actual.",
  "handover.emergency.trust":
    "No se pudo comprobar la identidad o dirección del servidor principal anterior. Comprueba su conexión y dirección en Servidores antes de volver a intentarlo.",
  "handover.emergency.failed":
    "No se pudo terminar este paso. Vuelve a comprobar esta copia antes de continuar.",
};
