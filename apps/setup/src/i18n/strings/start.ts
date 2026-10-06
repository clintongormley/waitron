// The connection, role, connect, mode and admin screens, the old-box question and server-fields.ts.

export const startEn = {
  "connection.heading": "Is this page secure?",
  "connection.check_address_bar": "Look at your browser's address bar. If it says",
  "connection.warning_words": "Not secure",
  "connection.install_before_continuing":
    ", install this server's certificate before you continue.",
  "connection.install_certificate": "Install certificate",
  "connection.checking": "Checking connection…",
  "connection.continue": "Continue to setup",

  "role.heading": "Join or recover an existing restaurant",
  "role.intro":
    "Restore a backup onto this server when no other server is still running with newer restaurant data, or rebuild onto it from the continuous copy in your own storage bucket when the old server is gone. Adding this server as a mirror does not work in this version — the card below says what happens if you try.",
  "role.mirror.heading": "Add a mirror node",
  "role.mirror.copy":
    "This does not work in this version. The server signs in to the restaurant's primary and restarts, then stops part-way through joining, and it will not get any further however many times you restart it. It ends up holding none of the restaurant's information, with no dashboard and no till, and it cannot sell or file anything. This setup wizard does not open on this server again afterwards.",
  "role.mirror.button": "Add a mirror",
  "role.restore.heading": "Restore from backup",
  "role.restore.copy":
    "Recover onto this fresh server from an encrypted Waitron backup when no other server is still running with newer restaurant data.",
  "role.restore.button": "Restore a backup",
  "role.bucket.heading": "Restore from my bucket",
  "role.bucket.copy":
    "Rebuild onto this fresh server from the continuous copy in your own storage bucket, when the old server is gone. You need the recovery kit.",
  "role.bucket.button": "Restore from my bucket",
  "role.back": "Back",

  "connect.heading": "Connect to the primary",
  "connect.intro":
    "Point this server at the restaurant's primary and sign in with an admin login for it. This does not work in this version: the server signs in and restarts, then stops part-way through joining, and it will not get any further however many times you restart it. It ends up holding none of the restaurant's information, with no dashboard and no till, and it cannot sell or file anything. This setup wizard does not open on this server again afterwards.",
  "connect.primary_url.label": "Primary server address",
  "connect.primary_url.error": "Check the primary server address.",
  "connect.primary_url.help_label": "Help with primary server address",
  "connect.primary_url.help":
    "Enter the full HTTPS address of the primary server this server would join.",
  "connect.person_id.label": "Admin login (person ID)",
  "connect.person_id.error": "Check the admin login (person id).",
  "connect.person_id.help_label": "Help with admin login (person id)",
  "connect.person_id.help": "Enter an admin's person ID from the primary server.",
  "connect.password.label": "Admin password",
  "connect.password.error": "Check the admin password.",
  "connect.password.help_label": "Help with admin password",
  "connect.password.help": "Enter that admin's dashboard password on the primary server.",
  "connect.totp.label": "Authenticator code (if required)",
  "connect.totp.error": "Check the authenticator code (if required).",
  "connect.totp.help_label": "Help with authenticator code (if required)",
  "connect.totp.help": "If this admin uses an authenticator, enter its current one-time code.",
  "connect.fix_fields": "Correct the highlighted fields to continue.",
  "connect.back": "Back",
  "connect.connect": "Connect",

  "mode.heading": "Set up this Waitron server",
  "mode.intro":
    "This server runs the till and files fiscal records. Set it up once here, then it restarts into everyday trading mode.",
  "mode.cert_note": "If your browser shows a certificate warning,",
  "mode.cert_note_link": "open certificate help",
  "mode.production_warning":
    "This server is stamped for production — provisioning files real records to AEAT.",
  "mode.demo.heading": "Demo",
  "mode.demo.copy": "A practice server. Nothing is filed to AEAT — safe to explore and throw away.",
  "mode.prepare.heading": "Prepare your restaurant",
  "mode.prepare.copy":
    "Enter your real menus, staff and layouts, then practise with test payments. Nothing is filed to AEAT.",
  "mode.live.heading": "Live",
  "mode.live.copy": "The real thing. Every sale is filed to AEAT. This choice is permanent.",
  "mode.existing.heading": "Already have a restaurant?",
  "mode.existing.copy":
    "Add this server as a mirror of a running restaurant, or recover a restaurant from a backup.",
  "mode.existing.choice": "Join or recover",
  "mode.confirm.heading": "This is permanent",
  "mode.confirm.warning":
    "A live server files real invoices to AEAT and can NEVER become a demo — this is permanent.",
  "mode.confirm.understand": "I understand this cannot be undone",
  "mode.confirm.back": "Back",
  "mode.confirm.button": "Set up this live server",

  "admin.heading": "Your account",
  "admin.intro": "Create the account that manages this server. You can add more people later.",
  "admin.first_names.label": "First name(s)",
  "admin.first_names.error": "Enter your first name(s).",
  "admin.first_names.hint": "As on your ID",
  "admin.last_names.label": "Last name(s)",
  "admin.last_names.error": "Enter your last name(s).",
  "admin.last_names.hint": "As on your ID",
  "admin.display_name.label": "Display name",
  "admin.display_name.error": "Enter your display name.",
  "admin.display_name.hint": "The name colleagues see",
  "admin.email.label": "Email",
  "admin.email.error": "Enter your email.",
  "admin.email.hint": "To sign in and recover your account",
  "admin.password.label": "Password",
  "admin.password.error": "Enter your password.",
  "admin.password.hint": "To sign in to the dashboard",
  "admin.pin.label": "PIN",
  "admin.pin.error": "Enter your pin.",
  "admin.pin.hint": "Digits, to sign in at the till",
  "admin.show_password": "Show password",
  "admin.hide_password": "Hide password",
  "admin.show_pin": "Show PIN",
  "admin.hide_pin": "Hide PIN",
  "admin.fix_fields": "Correct the highlighted fields to continue.",
  "admin.back": "Back",
  "admin.next": "Next",

  "old_box.problem": "Confirm that the old server is switched off for good.",
  "old_box.wrote_at": "The old server wrote to its bucket at",
  "old_box.unchecked":
    "Whether the old server is still writing to its bucket could not be checked.",
  "old_box.consequence":
    "If it is still running, two servers would sell from the same records, and that cannot be undone. Switch it off for good before you go on.",
  "old_box.gone": "The old server is switched off for good.",

  // The message's 120 is `NOMBRE_RAZON_MAX` (`packages/fiscal-verifactu/src/venue-fields.ts`).
  "server_fields.legal_name":
    "Keep the name to 120 characters or fewer, and remove any hidden characters the tax agency's records cannot carry — typing the name out instead of pasting it usually clears them.",
  "server_fields.taxpayer_domicile": "Enter the full registered business address.",
  // The message's 38 is `MAX_BASE_CODE_LENGTH` (`packages/fiscal-verifactu/src/reserved-series.ts`).
  "server_fields.series_code":
    "Use letters, numbers, and the characters / _ . and - only, up to 38 characters.",
  "server_fields.operation_description":
    "Keep this to 500 characters or fewer, and remove any hidden characters — typing it out instead of pasting it usually clears them.",
} as const;

export const startEs: Record<keyof typeof startEn, string> = {
  "connection.heading": "¿Es segura esta página?",
  "connection.check_address_bar": "Mira la barra de direcciones de tu navegador. Si pone",
  "connection.warning_words": "No es seguro",
  "connection.install_before_continuing":
    ", instala el certificado de este servidor antes de continuar.",
  "connection.install_certificate": "Instalar el certificado",
  "connection.checking": "Comprobando la conexión…",
  "connection.continue": "Continuar con la configuración",

  "role.heading": "Unirse a un restaurante existente o recuperarlo",
  "role.intro":
    "Restaura una copia de seguridad en este servidor cuando no haya ningún otro servidor funcionando con datos más recientes del restaurante, o reconstrúyelo a partir de la copia continua de tu propio bucket de almacenamiento cuando el servidor anterior ya no esté. Añadir este servidor como réplica no funciona en esta versión: la tarjeta de abajo explica qué pasa si lo intentas.",
  "role.mirror.heading": "Añadir un nodo réplica",
  "role.mirror.copy":
    "Esto no funciona en esta versión. El servidor inicia sesión en el servidor principal del restaurante y se reinicia; después se detiene a medio unirse y no avanza más por muchas veces que lo reinicies. Acaba sin ninguna información del restaurante, sin panel y sin caja, y no puede vender ni enviar nada a la AEAT. Después, este asistente de configuración no vuelve a abrirse en este servidor.",
  "role.mirror.button": "Añadir una réplica",
  "role.restore.heading": "Restaurar desde una copia de seguridad",
  "role.restore.copy":
    "Recupera el restaurante en este servidor nuevo desde una copia de seguridad cifrada de Waitron cuando no haya ningún otro servidor funcionando con datos más recientes del restaurante.",
  "role.restore.button": "Restaurar una copia de seguridad",
  "role.bucket.heading": "Restaurar desde mi bucket",
  "role.bucket.copy":
    "Reconstruye el restaurante en este servidor nuevo a partir de la copia continua de tu propio bucket de almacenamiento, cuando el servidor anterior ya no esté. Necesitas el kit de recuperación.",
  "role.bucket.button": "Restaurar desde mi bucket",
  "role.back": "Volver",

  "connect.heading": "Conectar con el servidor principal",
  "connect.intro":
    "Indica a este servidor cuál es el servidor principal del restaurante e inicia sesión con un usuario administrador de ese servidor. Esto no funciona en esta versión: el servidor inicia sesión y se reinicia; después se detiene a medio unirse y no avanza más por muchas veces que lo reinicies. Acaba sin ninguna información del restaurante, sin panel y sin caja, y no puede vender ni enviar nada a la AEAT. Después, este asistente de configuración no vuelve a abrirse en este servidor.",
  "connect.primary_url.label": "Dirección del servidor principal",
  "connect.primary_url.error": "Revisa la dirección del servidor principal.",
  "connect.primary_url.help_label": "Ayuda sobre la dirección del servidor principal",
  "connect.primary_url.help":
    "Introduce la dirección HTTPS completa del servidor principal al que se uniría este servidor.",
  "connect.person_id.label": "Usuario administrador (ID de persona)",
  "connect.person_id.error": "Revisa el usuario administrador (ID de persona).",
  "connect.person_id.help_label": "Ayuda sobre el usuario administrador (ID de persona)",
  "connect.person_id.help":
    "Introduce el ID de persona de un administrador del servidor principal.",
  "connect.password.label": "Contraseña del administrador",
  "connect.password.error": "Revisa la contraseña del administrador.",
  "connect.password.help_label": "Ayuda sobre la contraseña del administrador",
  "connect.password.help":
    "Introduce la contraseña del panel de ese administrador en el servidor principal.",
  "connect.totp.label": "Código del autenticador (si se pide)",
  "connect.totp.error": "Revisa el código del autenticador.",
  "connect.totp.help_label": "Ayuda sobre el código del autenticador",
  "connect.totp.help":
    "Si este administrador usa un autenticador, introduce el código de un solo uso que muestra ahora.",
  "connect.fix_fields": "Corrige los campos marcados para continuar.",
  "connect.back": "Volver",
  "connect.connect": "Conectar",

  "mode.heading": "Configura este servidor Waitron",
  "mode.intro":
    "Este servidor hace funcionar la caja y envía los registros fiscales. Configúralo aquí una vez y después se reiniciará en el modo de venta diaria.",
  "mode.cert_note": "Si tu navegador muestra un aviso de certificado,",
  "mode.cert_note_link": "abre la ayuda sobre el certificado",
  "mode.production_warning":
    "Este servidor está marcado para producción: al configurarlo se envían registros reales a la AEAT.",
  "mode.demo.heading": "Demostración",
  "mode.demo.copy":
    "Un servidor de práctica. No se envía nada a la AEAT: puedes explorarlo y descartarlo sin riesgo.",
  "mode.prepare.heading": "Prepara tu restaurante",
  "mode.prepare.copy":
    "Introduce tus cartas, tu personal y tus planos reales, y practica con pagos de prueba. No se envía nada a la AEAT.",
  "mode.live.heading": "En vivo",
  "mode.live.copy": "El de verdad. Cada venta se envía a la AEAT. Esta elección es permanente.",
  "mode.existing.heading": "¿Ya tienes un restaurante?",
  "mode.existing.copy":
    "Añade este servidor como réplica de un restaurante en funcionamiento, o recupera un restaurante desde una copia de seguridad.",
  "mode.existing.choice": "Unirse o recuperar",
  "mode.confirm.heading": "Esto es permanente",
  "mode.confirm.warning":
    "Un servidor en vivo envía facturas reales a la AEAT y NUNCA puede convertirse en uno de demostración: es permanente.",
  "mode.confirm.understand": "Entiendo que no se puede deshacer",
  "mode.confirm.back": "Volver",
  "mode.confirm.button": "Configurar este servidor en vivo",

  "admin.heading": "Tu cuenta",
  "admin.intro":
    "Crea la cuenta que gestiona este servidor. Puedes añadir más personas más adelante.",
  "admin.first_names.label": "Nombre(s)",
  "admin.first_names.error": "Introduce tu nombre o nombres.",
  "admin.first_names.hint": "Como en tu documento",
  "admin.last_names.label": "Apellido(s)",
  "admin.last_names.error": "Introduce tus apellidos.",
  "admin.last_names.hint": "Como en tu documento",
  "admin.display_name.label": "Nombre visible",
  "admin.display_name.error": "Introduce tu nombre visible.",
  "admin.display_name.hint": "El nombre que ven tus compañeros",
  "admin.email.label": "Correo electrónico",
  "admin.email.error": "Introduce tu correo electrónico.",
  "admin.email.hint": "Para entrar y recuperar tu cuenta",
  "admin.password.label": "Contraseña",
  "admin.password.error": "Introduce tu contraseña.",
  "admin.password.hint": "Para entrar en el panel",
  "admin.pin.label": "PIN",
  "admin.pin.error": "Introduce tu PIN.",
  "admin.pin.hint": "Cifras, para entrar en la caja",
  "admin.show_password": "Mostrar contraseña",
  "admin.hide_password": "Ocultar contraseña",
  "admin.show_pin": "Mostrar PIN",
  "admin.hide_pin": "Ocultar PIN",
  "admin.fix_fields": "Corrige los campos marcados para continuar.",
  "admin.back": "Volver",
  "admin.next": "Siguiente",

  "old_box.problem": "Confirma que el servidor anterior está apagado para siempre.",
  "old_box.wrote_at": "El servidor anterior escribió en su bucket el",
  "old_box.unchecked":
    "No se ha podido comprobar si el servidor anterior sigue escribiendo en su bucket.",
  "old_box.consequence":
    "Si sigue funcionando, dos servidores venderían a partir de los mismos registros, y eso no se puede deshacer. Apágalo para siempre antes de continuar.",
  "old_box.gone": "El servidor anterior está apagado para siempre.",

  "server_fields.legal_name":
    "Usa 120 caracteres como máximo y quita los caracteres ocultos que los registros de la Agencia Tributaria no admiten; suele bastar con escribir el nombre en lugar de pegarlo.",
  "server_fields.taxpayer_domicile": "Introduce el domicilio fiscal completo del negocio.",
  "server_fields.series_code":
    "Usa solo letras, números y los caracteres / _ . y - (hasta 38 caracteres).",
  "server_fields.operation_description":
    "Usa 500 caracteres como máximo y quita los caracteres ocultos; suele bastar con escribirlo en lugar de pegarlo.",
};
