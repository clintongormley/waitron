// The venue, review and cert screens, and certificate-export-help.ts.

export const venueEn = {
  "email.required": "Send an accepted test message before completing setup.",
  "email.show_password": "Show password",
  "email.hide_password": "Hide password",
  "email.heading": "Set up email",
  "email.intro":
    "Send a test message to {recipient} before continuing. Use your mail provider’s settings.",
  "email.server.label": "Mail server",
  "email.server.hint": "smtp.example.com",
  "email.server.error": "Enter a mail server hostname.",
  "email.port.label": "Port",
  "email.port.hint": "587",
  "email.port.error": "Enter a whole port number from 1 to 65535.",
  "email.encryption.label": "Encryption",
  "email.encryption.error": "Choose STARTTLS or TLS.",
  "email.user.label": "Username",
  "email.user.hint": "Leave blank if your server needs no login.",
  "email.user.error": "Enter the username for this password.",
  "email.password.label": "Password",
  "email.password.hint": "Your mail server password",
  "email.password.error": "Enter the password for this username.",
  "email.from.label": "Sender email",
  "email.from.hint": "invoices@example.com",
  "email.from.error": "Enter a valid sender email address.",
  "email.fix_fields": "Correct the highlighted fields to continue.",
  "email.accepted": "The mail server accepted the test message. Check your inbox.",
  "email.test_host_not_found": "No mail server has this name. Check the spelling.",
  "email.test_connection_refused":
    "Check the port: nothing at this mail server accepts connections on it.",
  "email.test_starttls_refused":
    "This mail server would not start encryption on this port. Try TLS on port 465 or STARTTLS on port 587, or try again later.",
  "email.test_tls_refused": "This port does not start with TLS. Try STARTTLS on this port.",
  "email.test_certificate_untrusted":
    "This mail server's certificate is not trusted, so Waitron will not send it your password.",
  "email.test_login_refused":
    "The mail server refused this user and password. Check both, then send the test again.",
  "email.test_login_required":
    "This mail server needs a user and password. Enter both, then send the test again.",
  "email.test_timeout":
    "The mail server did not answer in time. Check the port and the encryption.",
  "email.test_refused":
    "The mail server refused the test message. Check the settings and try again.",
  "email.failed": "The test could not be completed. Try again.",
  "email.back": "Back",
  "email.next": "Continue",
  "email.test": "Send test message",
  "email.testing": "Sending test…",
  "email.test_help": "Help with the test result",

  "venue.heading": "Your shop",
  "venue.intro": "Enter the business that issues your invoices and the address of this venue.",
  "venue.intro_demo":
    "Name your demo venue and enter its address. Waitron supplies a made-up business identity and invoice settings; you can review them before setup.",
  "venue.section.business": "Business",
  "venue.section.venue": "Venue",
  "venue.section.invoicing": "Invoicing",

  "venue.label.country": "Country",
  "venue.label.tax_id": "Tax ID",
  "venue.label.legal_name": "Legal name",
  "venue.label.taxpayer_domicile": "Registered business address",
  "venue.label.venue_name": "Venue name",
  "venue.label.invoice_locales": "Receipt language",
  "venue.label.staff_language": "Working language",
  "venue.field.staff_language": "working language",
  "venue.staff_language.en": "English",
  "venue.staff_language.es": "Spanish",
  "venue.staff_language.help":
    "Your initial menu, courses and other starter names are created in this language. In Demo, staff and kitchen dish names use it too. Receipts keep their own language.",
  "venue.error.staff_language": "Choose English or Spanish.",
  "review.staff_language": "Working language",
  "venue.label.address_line1": "Address line 1",
  "venue.label.address_line2": "Address line 2 (optional)",
  "venue.label.postal_code": "Postal code",
  "venue.label.city": "City",
  "venue.label.province": "Province",
  "venue.label.province_region": "Province / region",
  "venue.label.day_cutover": "Business day cutover",
  "venue.label.series_code": "Invoice series code",
  "venue.label.full_series_code": "Full invoice series code",
  "venue.label.rectificative_series_code": "Rectificative series code",

  "venue.select_province": "Select province",
  "venue.combobox_search": "Search",
  "venue.combobox_no_results": "No results",
  "venue.fiscal_territory": "Fiscal territory: {territory}",
  "venue.time_zone": "Time zone: {zone}",
  "venue.invoice_locales_help_label": "Help with the receipt language",
  "venue.invoice_locales_help": "Choose the language receipts print in by default.",

  // Each `venue.field.*` fills `{field}` in the three sentences after it. Spanish carries the
  // article in the field, so the sentences read correctly whatever the noun's gender.
  "venue.field.country": "country",
  "venue.field.tax_id": "tax ID",
  "venue.field.legal_name": "legal name",
  "venue.field.taxpayer_domicile": "registered business address",
  "venue.field.name": "venue name",
  "venue.field.address_line1": "street address",
  "venue.field.address_line2": "address detail",
  "venue.field.postal_code": "postal code",
  "venue.field.city": "city",
  "venue.field.province": "province",
  "venue.field.day_cutover": "business day cutover",
  "venue.field.series_code": "invoice series code",
  "venue.field.full_series_code": "full invoice series code",
  "venue.field.rectificative_series_code": "correction series code",
  "venue.enter_field": "Enter the {field}.",
  "venue.check_field": "Check the {field}.",
  "venue.help_with_field": "Help with {field}",

  "venue.help.country":
    "Choose the country where your business is registered. It determines the available address and tax settings.",
  "venue.hint.tax_id": "Of the business that issues the invoices",
  "venue.hint.legal_name": "As on the business's tax documents",
  "venue.hint.taxpayer_domicile": "Full street address, postcode, city and province",
  "venue.hint.name": "The name you use for this venue",
  "venue.help.name":
    "The name you use for this venue. You can keep the suggested name or change it.",
  "venue.hint.address_line1": "Street and building number",
  "venue.hint.address_line2": "Floor, unit or other detail",
  "venue.address_lookup.label": "Find the address",
  "venue.address_lookup.domicile_label": "Find the registered address",
  "venue.address_lookup.placeholder": "Start typing the street and number",
  "venue.address_lookup.no_results": "No address found. Type it below.",
  "venue.address_lookup.unavailable":
    "Address suggestions are not available. Type the address below.",
  "venue.address_lookup.other_country":
    "That address is not in {country}. Choose another or type it below.",
  "venue.hint.postal_code": "Used to suggest the province",
  "venue.hint.city": "Town or city",
  "venue.help.province":
    "The province must match the postal code. It determines the fiscal territory and time zone.",
  "venue.help.day_cutover":
    "Sales before this time belong to the previous business day. Keep 04:00 if you finish trading after midnight.",
  "venue.help.series_code":
    "Ordinary invoice numbers start with this prefix, then a code Waitron adds, then the invoice's number: for example FS-0CSQW/1. Use letters, numbers, / _ . or -, up to 21 characters. Keep FS unless you need another invoice series.",
  "venue.help.full_series_code":
    "Full invoice numbers start with this prefix, then a code Waitron adds, then the invoice's number: for example FF-0CSQW/1. Use letters, numbers, / _ . or -, up to 21 characters.",
  "venue.help.rectificative_series_code":
    "Correction invoice numbers start with this prefix, then a code Waitron adds, then the invoice's number: for example FR-0CSQW/1. Use letters, numbers, / _ . or -, up to 21 characters. Keep FR unless you need another invoice series.",

  "venue.error.invoice_locales": "Choose the receipt language.",
  "venue.error.tax_id": "Enter a valid tax ID for the selected country.",
  "venue.error.postal_code": "Enter a valid postal code that matches the province.",
  "venue.error.territory_unsupported": "Setup is not available for this fiscal territory yet.",
  "venue.error.province": "Choose the province that matches the postal code.",
  "venue.error.series_codes": "Use a different code for each invoice series.",
  "venue.fix_fields": "Correct the highlighted fields to continue.",

  "venue.locale.es_es": "Spanish (España)",
  "venue.locale.ca_es": "Catalan (Català)",
  "venue.locale.gl_es": "Galician (Galego)",
  "venue.locale.eu_es": "Basque (Euskara)",

  "venue.back": "Back",
  "venue.next": "Next",

  "review.heading": "Review and provision",
  "review.intro": "Check the details below, then provision this server.",
  "review.demo_defaults":
    "The legal name and tax ID below are Waitron's fixed demo values. They are made up. Waitron also supplied the other business and invoice defaults below. Demo does not submit invoices to the tax agency.",
  "review.country": "Country",
  "review.tax_id": "Tax ID",
  "review.legal_name": "Legal name",
  "review.taxpayer_domicile": "Registered business address",
  "review.venue_name": "Venue",
  "review.address": "Address",
  "review.invoice_locales": "Receipt language",
  "review.day_cutover": "Business day cutover",
  "review.series_base": "Invoice series base",
  "review.full_series_base": "Full invoice series base",
  "review.rectificative_series_base": "Corrections series base",
  "review.series": "Invoice series",
  "review.full_series": "Full invoice series",
  "review.rectificative_series": "Corrections series",
  "review.group.business": "Business",
  "review.group.venue": "Venue",
  "review.group.invoicing": "Invoicing",
  "review.group.account": "Your account",
  "review.edit": "Edit",
  "review.help.business": "These details identify the legal business on invoices and tax records.",
  "review.help.venue":
    "These details describe the place where sales are made and receipts are issued.",
  "review.help.invoicing":
    "These settings control invoice numbering and the details printed on invoices.",
  "review.help.account": "This account signs in to manage the venue after setup.",
  "review.operator": "Operator",
  "review.operator_display_name": "Operator display name",
  "review.operator_email": "Operator email",
  "review.cert": "AEAT certificate",
  "review.cert_attached": "attached",
  "review.cert_not_attached": "not attached",
  "review.back": "Back",
  "review.provision": "Provision this server",

  "cert.heading": "AEAT certificate",
  "cert.intro":
    "A live Spanish venue files invoices to AEAT with a certificate. Upload the certificate file and enter its passphrase.",
  "cert.file_label": "Certificate file (.pfx or .p12)",
  "cert.file_help_label": "Help with certificate file",
  "cert.file_help":
    "Choose the exported signing certificate, including its private key, so this server can sign fiscal records.",
  "cert.file_required": "Choose the certificate file.",
  "cert.loaded": "Certificate loaded.",
  "cert.loaded_named": "Certificate loaded — {name}.",
  "cert.passphrase_label": "Certificate passphrase",
  "cert.passphrase_required": "Enter the certificate passphrase.",
  "cert.passphrase_hint": "The passphrase set when exporting",
  "cert.show_passphrase": "Show certificate passphrase",
  "cert.hide_passphrase": "Hide certificate passphrase",
  "cert.kind_label": "Certificate type",
  "cert.kind_help_label": "Help with certificate type",
  "cert.kind_help":
    "Select whether this is a company seal or representative certificate, matching the certificate you exported.",
  "cert.kind.sello": "Company seal (sello)",
  "cert.kind.representante": "Representative (representante)",
  "cert.fix_fields": "Correct the highlighted fields to continue.",
  "cert.file_unreadable": "We couldn't read that file. Please choose the certificate file again.",
  "cert.refusal.passphrase_wrong": "The certificate passphrase is incorrect.",
  "cert.refusal.unreadable": "Choose a valid .pfx or .p12 certificate file.",
  "cert.refusal.old_encryption": "Export the certificate again with modern encryption.",
  "cert.refusal.no_private_key": "Export the certificate again, including its private key.",
  "cert.refusal.expired": "This certificate has expired. Choose its replacement.",
  "cert.refusal.not_yet_valid":
    "This certificate is not valid yet. Check the date or choose another file.",
  "cert.guide": "Certificate help",
  "cert.back": "Back",
  "cert.next": "Next",

  "cert_help.aria_label": "Export your signing certificate",
  "cert_help.heading": "Get your certificate file",
  "cert_help.intro": "Export the signing certificate on the computer where it is installed.",
  "cert_help.choose": "Choose the instructions for that computer or browser below.",
  "cert_help.transfer":
    "If your certificate is on another computer, export it there and transfer the file to this device.",
  "cert_help.other_guides": "Exporting from a different computer or browser?",
  "cert_help.fnmt_link": "FNMT export instructions",
  "cert_help.windows.title": "Windows (Chrome)",
  "cert_help.windows.step1":
    "In Chrome Settings, open Privacy and security, then Security, Manage certificates and Manage imported certificates from Windows.",
  "cert_help.windows.step2":
    "Select your signing certificate and choose Export. In the Windows wizard, choose to export the private key and keep the default export format.",
  "cert_help.windows.step3":
    "Set and confirm an export password, choose where to save the file, then finish the wizard. Choose the resulting .pfx or .p12 file below and enter that export password.",
  "cert_help.mac.title": "macOS (Keychain Access)",
  "cert_help.mac.step1":
    "Open Keychain Access from Applications, Utilities. Under My Certificates, select your signing certificate.",
  "cert_help.mac.step2": "Choose File, Export Items. Choose a name and folder for the .p12 file.",
  "cert_help.mac.step3":
    "Set and confirm an export password. Choose the saved .p12 file below and enter that password.",
  "cert_help.firefox.title": "Firefox",
  "cert_help.firefox.step1":
    "Open Firefox Settings and find Certificates. Open the certificate manager and its Your Certificates tab.",
  "cert_help.firefox.step2":
    "Select your signing certificate and choose Backup. Choose a folder and a filename ending in .p12.",
  "cert_help.firefox.step3":
    "Enter Firefox's primary password if requested, then set and confirm a password for the exported copy. Choose that .p12 file below and enter the export password.",
} as const;

export const venueEs: Record<keyof typeof venueEn, string> = {
  "email.required": "Envía un mensaje de prueba aceptado antes de completar la configuración.",
  "email.show_password": "Mostrar contraseña",
  "email.hide_password": "Ocultar contraseña",
  "email.heading": "Configura el correo electrónico",
  "email.intro":
    "Envía un mensaje de prueba a {recipient} antes de continuar. Usa los ajustes de tu proveedor de correo.",
  "email.server.label": "Servidor de correo",
  "email.server.hint": "smtp.example.com",
  "email.server.error": "Introduce el nombre del servidor de correo.",
  "email.port.label": "Puerto",
  "email.port.hint": "587",
  "email.port.error": "Introduce un número de puerto entero entre 1 y 65535.",
  "email.encryption.label": "Cifrado",
  "email.encryption.error": "Elige STARTTLS o TLS.",
  "email.user.label": "Nombre de usuario",
  "email.user.hint": "Déjalo vacío si el servidor no necesita iniciar sesión.",
  "email.user.error": "Introduce el nombre de usuario para esta contraseña.",
  "email.password.label": "Contraseña",
  "email.password.hint": "La contraseña del servidor de correo",
  "email.password.error": "Introduce la contraseña para este usuario.",
  "email.from.label": "Correo del remitente",
  "email.from.hint": "facturas@example.com",
  "email.from.error": "Introduce una dirección válida para el remitente.",
  "email.fix_fields": "Corrige los campos marcados para continuar.",
  "email.accepted": "El servidor de correo ha aceptado la prueba. Revisa tu bandeja.",
  "email.test_host_not_found":
    "No hay ningún servidor de correo con este nombre. Revisa cómo está escrito.",
  "email.test_connection_refused":
    "Revisa el puerto: el servidor de correo no acepta conexiones en él.",
  "email.test_starttls_refused":
    "El servidor de correo no ha iniciado el cifrado en este puerto. Prueba TLS en el puerto 465 o STARTTLS en el puerto 587, o inténtalo más tarde.",
  "email.test_tls_refused":
    "Este puerto no inicia la conexión con TLS. Prueba STARTTLS en este puerto.",
  "email.test_certificate_untrusted":
    "El certificado de este servidor de correo no es de confianza, por lo que Waitron no le enviará tu contraseña.",
  "email.test_login_refused":
    "El servidor de correo ha rechazado este usuario y contraseña. Revisa ambos y vuelve a enviar la prueba.",
  "email.test_login_required":
    "Este servidor de correo necesita un usuario y una contraseña. Introduce ambos y vuelve a enviar la prueba.",
  "email.test_timeout":
    "El servidor de correo no ha respondido a tiempo. Revisa el puerto y el cifrado.",
  "email.test_refused":
    "El servidor de correo ha rechazado la prueba. Revisa la configuración y vuelve a intentarlo.",
  "email.failed": "No se ha podido completar la prueba. Vuelve a intentarlo.",
  "email.back": "Atrás",
  "email.next": "Continuar",
  "email.test": "Enviar mensaje de prueba",
  "email.testing": "Enviando la prueba…",
  "email.test_help": "Ayuda con el resultado de la prueba",

  "venue.heading": "Tu tienda",
  "venue.intro":
    "Introduce los datos del negocio que emite tus facturas y la dirección de este local.",
  "venue.intro_demo":
    "Pon nombre a tu local de demostración e introduce su dirección. Waitron aporta una identidad de negocio inventada y los ajustes de factura; puedes revisarlos antes de la configuración.",
  "venue.section.business": "Negocio",
  "venue.section.venue": "Local",
  "venue.section.invoicing": "Facturación",

  "venue.label.country": "País",
  "venue.label.tax_id": "Número de identificación fiscal",
  "venue.label.legal_name": "Razón social",
  "venue.label.taxpayer_domicile": "Domicilio fiscal del negocio",
  "venue.label.venue_name": "Nombre del local",
  "venue.label.invoice_locales": "Idioma del recibo",
  "venue.label.staff_language": "Idioma de trabajo",
  "venue.field.staff_language": "el idioma de trabajo",
  "venue.staff_language.en": "Inglés",
  "venue.staff_language.es": "Español",
  "venue.staff_language.help":
    "Los nombres del menú inicial, los pases y los demás elementos iniciales se crean en este idioma. En la demostración, también se usa para los nombres de platos del personal y de la cocina. Los recibos mantienen su propio idioma.",
  "venue.error.staff_language": "Elige inglés o español.",
  "review.staff_language": "Idioma de trabajo",
  "venue.label.address_line1": "Dirección (línea 1)",
  "venue.label.address_line2": "Dirección (línea 2, opcional)",
  "venue.label.postal_code": "Código postal",
  "venue.label.city": "Localidad",
  "venue.label.province": "Provincia",
  "venue.label.province_region": "Provincia / región",
  "venue.label.day_cutover": "Cambio de día comercial",
  "venue.label.series_code": "Código de la serie de facturas",
  "venue.label.full_series_code": "Código de la serie de facturas completas",
  "venue.label.rectificative_series_code": "Código de la serie rectificativa",

  "venue.select_province": "Elige la provincia",
  "venue.combobox_search": "Buscar",
  "venue.combobox_no_results": "Sin resultados",
  "venue.fiscal_territory": "Territorio fiscal: {territory}",
  "venue.time_zone": "Zona horaria: {zone}",
  "venue.invoice_locales_help_label": "Ayuda sobre el idioma del recibo",
  "venue.invoice_locales_help": "Elige el idioma en que se imprimen los recibos por defecto.",

  "venue.field.country": "el país",
  "venue.field.tax_id": "el número de identificación fiscal",
  "venue.field.legal_name": "la razón social",
  "venue.field.taxpayer_domicile": "el domicilio fiscal del negocio",
  "venue.field.name": "el nombre del local",
  "venue.field.address_line1": "la calle y el número",
  "venue.field.address_line2": "el detalle de la dirección",
  "venue.field.postal_code": "el código postal",
  "venue.field.city": "la localidad",
  "venue.field.province": "la provincia",
  "venue.field.day_cutover": "la hora de cambio de día comercial",
  "venue.field.series_code": "el código de la serie de facturas",
  "venue.field.full_series_code": "el código de la serie de facturas completas",
  "venue.field.rectificative_series_code": "el código de la serie rectificativa",
  "venue.enter_field": "Introduce {field}.",
  "venue.check_field": "Revisa {field}.",
  "venue.help_with_field": "Ayuda sobre {field}",

  "venue.help.country":
    "Elige el país donde está registrado tu negocio. Determina los ajustes de dirección e impuestos disponibles.",
  "venue.hint.tax_id": "Del negocio que emite las facturas",
  "venue.hint.legal_name": "Como en sus documentos fiscales",
  "venue.hint.taxpayer_domicile": "Calle, número, código postal, localidad y provincia",
  "venue.hint.name": "El nombre que usas para este local",
  "venue.help.name":
    "El nombre que usas para este local. Puedes mantener el nombre propuesto o cambiarlo.",
  "venue.hint.address_line1": "Calle y número",
  "venue.hint.address_line2": "Piso, puerta u otro detalle",
  "venue.address_lookup.label": "Buscar la dirección",
  "venue.address_lookup.domicile_label": "Buscar el domicilio fiscal",
  "venue.address_lookup.placeholder": "Empieza a escribir la calle y el número",
  "venue.address_lookup.no_results": "No se ha encontrado la dirección. Escríbela abajo.",
  "venue.address_lookup.unavailable":
    "Las sugerencias de direcciones no están disponibles. Escribe la dirección abajo.",
  "venue.address_lookup.other_country":
    "Esa dirección no está en {country}. Elige otra o escríbela abajo.",
  "venue.hint.postal_code": "Sirve para proponer la provincia",
  "venue.hint.city": "Pueblo o ciudad",
  "venue.help.province":
    "La provincia debe corresponder al código postal. Determina el territorio fiscal y la zona horaria.",
  "venue.help.day_cutover":
    "Las ventas anteriores a esta hora pertenecen al día comercial anterior. Deja las 04:00 si cierras después de medianoche.",
  "venue.help.series_code":
    "Los números de las facturas ordinarias empiezan por este prefijo, seguido de un código que añade Waitron y del número de la factura: por ejemplo FS-0CSQW/1. Usa letras, números, / _ . o -, hasta 21 caracteres. Deja FS salvo que necesites otra serie de facturas.",
  "venue.help.full_series_code":
    "Los números de las facturas completas empiezan por este prefijo, seguido de un código que añade Waitron y del número de la factura: por ejemplo FF-0CSQW/1. Usa letras, números, / _ . o -, hasta 21 caracteres.",
  "venue.help.rectificative_series_code":
    "Los números de las facturas rectificativas empiezan por este prefijo, seguido de un código que añade Waitron y del número de la factura: por ejemplo FR-0CSQW/1. Usa letras, números, / _ . o -, hasta 21 caracteres. Deja FR salvo que necesites otra serie de facturas.",

  "venue.error.invoice_locales": "Elige el idioma del recibo.",
  "venue.error.tax_id": "Introduce un número de identificación fiscal válido para el país elegido.",
  "venue.error.postal_code": "Introduce un código postal válido que corresponda a la provincia.",
  "venue.error.territory_unsupported":
    "La configuración aún no está disponible para este territorio fiscal.",
  "venue.error.province": "Elige la provincia que corresponde al código postal.",
  "venue.error.series_codes": "Usa un código distinto para cada serie de facturas.",
  "venue.fix_fields": "Corrige los campos marcados para continuar.",

  "venue.locale.es_es": "Español (España)",
  "venue.locale.ca_es": "Catalán (Català)",
  "venue.locale.gl_es": "Gallego (Galego)",
  "venue.locale.eu_es": "Vasco (Euskara)",

  "venue.back": "Volver",
  "venue.next": "Siguiente",

  "review.heading": "Revisar y configurar",
  "review.intro": "Comprueba los datos de abajo y configura este servidor.",
  "review.demo_defaults":
    "La razón social y el número de identificación fiscal de abajo son los valores fijos de demostración de Waitron. Son inventados. Waitron también ha puesto los demás valores del negocio y de factura de abajo. La demostración no envía facturas a la Agencia Tributaria.",
  "review.country": "País",
  "review.tax_id": "Número de identificación fiscal",
  "review.legal_name": "Razón social",
  "review.taxpayer_domicile": "Domicilio fiscal del negocio",
  "review.venue_name": "Local",
  "review.address": "Dirección",
  "review.invoice_locales": "Idioma del recibo",
  "review.day_cutover": "Cambio de día comercial",
  "review.series_base": "Base de la serie de facturas",
  "review.full_series_base": "Base de la serie de facturas completas",
  "review.rectificative_series_base": "Base de la serie de correcciones",
  "review.series": "Serie de facturas",
  "review.full_series": "Serie de facturas completas",
  "review.rectificative_series": "Serie de correcciones",
  "review.group.business": "Negocio",
  "review.group.venue": "Local",
  "review.group.invoicing": "Facturación",
  "review.group.account": "Tu cuenta",
  "review.edit": "Editar",
  "review.help.business":
    "Estos datos identifican al negocio en las facturas y los registros fiscales.",
  "review.help.venue":
    "Estos datos describen el lugar donde se hacen las ventas y se emiten los recibos.",
  "review.help.invoicing":
    "Estos ajustes controlan la numeración y los datos que aparecen en las facturas.",
  "review.help.account":
    "Con esta cuenta iniciarás sesión para gestionar el local después de configurarlo.",
  "review.operator": "Operador",
  "review.operator_display_name": "Nombre visible del operador",
  "review.operator_email": "Correo del operador",
  "review.cert": "Certificado de la AEAT",
  "review.cert_attached": "adjunto",
  "review.cert_not_attached": "no adjunto",
  "review.back": "Volver",
  "review.provision": "Configurar este servidor",

  "cert.heading": "Certificado de la AEAT",
  "cert.intro":
    "Un local real en España envía sus facturas a la AEAT con un certificado. Sube el archivo del certificado e introduce su contraseña.",
  "cert.file_label": "Archivo del certificado (.pfx o .p12)",
  "cert.file_help_label": "Ayuda sobre el archivo del certificado",
  "cert.file_help":
    "Elige el certificado de firma exportado, con su clave privada, para que este servidor pueda firmar los registros fiscales.",
  "cert.file_required": "Elige el archivo del certificado.",
  "cert.loaded": "Certificado cargado.",
  "cert.loaded_named": "Certificado cargado — {name}.",
  "cert.passphrase_label": "Contraseña del certificado",
  "cert.passphrase_required": "Introduce la contraseña del certificado.",
  "cert.passphrase_hint": "La contraseña que elegiste al exportar",
  "cert.show_passphrase": "Mostrar la contraseña del certificado",
  "cert.hide_passphrase": "Ocultar la contraseña del certificado",
  "cert.kind_label": "Tipo de certificado",
  "cert.kind_help_label": "Ayuda sobre el tipo de certificado",
  "cert.kind_help":
    "Indica si es un certificado de sello electrónico o de representante, según el certificado que exportaste.",
  "cert.kind.sello": "Sello electrónico",
  "cert.kind.representante": "Representante",
  "cert.fix_fields": "Corrige los campos marcados para continuar.",
  "cert.refusal.passphrase_wrong": "La contraseña del certificado es incorrecta.",
  "cert.refusal.unreadable": "Elige un archivo de certificado .pfx o .p12 válido.",
  "cert.refusal.old_encryption": "Exporta el certificado de nuevo con un cifrado moderno.",
  "cert.refusal.no_private_key": "Exporta el certificado de nuevo, incluida su clave privada.",
  "cert.refusal.expired": "Este certificado ha caducado. Elige su sustituto.",
  "cert.refusal.not_yet_valid":
    "Este certificado aún no es válido. Revisa la fecha o elige otro archivo.",
  "cert.guide": "Ayuda con el certificado",
  "cert.file_unreadable":
    "No hemos podido leer ese archivo. Vuelve a elegir el archivo del certificado.",
  "cert.back": "Volver",
  "cert.next": "Siguiente",

  "cert_help.aria_label": "Exporta tu certificado de firma",
  "cert_help.heading": "Consigue el archivo de tu certificado",
  "cert_help.intro": "Exporta el certificado de firma en el ordenador donde está instalado.",
  "cert_help.choose": "Elige abajo las instrucciones para ese ordenador o navegador.",
  "cert_help.transfer":
    "Si tu certificado está en otro ordenador, expórtalo allí y pasa el archivo a este dispositivo.",
  "cert_help.other_guides": "¿Lo exportas desde otro ordenador o navegador?",
  "cert_help.fnmt_link": "Instrucciones de exportación de la FNMT",
  "cert_help.windows.title": "Windows (Chrome)",
  "cert_help.windows.step1":
    "En la configuración de Chrome, abre Privacidad y seguridad, después Seguridad, Gestionar certificados y Gestionar certificados importados de Windows.",
  "cert_help.windows.step2":
    "Selecciona tu certificado de firma y elige Exportar. En el asistente de Windows, elige exportar la clave privada y deja el formato de exportación predeterminado.",
  "cert_help.windows.step3":
    "Escribe y confirma una contraseña de exportación, elige dónde guardar el archivo y termina el asistente. Elige abajo el archivo .pfx o .p12 resultante e introduce esa contraseña de exportación.",
  "cert_help.mac.title": "macOS (Acceso a Llaveros)",
  "cert_help.mac.step1":
    "Abre Acceso a Llaveros desde Aplicaciones, Utilidades. En Mis certificados, selecciona tu certificado de firma.",
  "cert_help.mac.step2":
    "Elige Archivo, Exportar ítems. Elige un nombre y una carpeta para el archivo .p12.",
  "cert_help.mac.step3":
    "Escribe y confirma una contraseña de exportación. Elige abajo el archivo .p12 guardado e introduce esa contraseña.",
  "cert_help.firefox.title": "Firefox",
  "cert_help.firefox.step1":
    "Abre los Ajustes de Firefox y busca Certificados. Abre el administrador de certificados y su pestaña Sus certificados.",
  "cert_help.firefox.step2":
    "Selecciona tu certificado de firma y elige Hacer copia. Elige una carpeta y un nombre de archivo que termine en .p12.",
  "cert_help.firefox.step3":
    "Introduce la contraseña principal de Firefox si te la pide y, después, escribe y confirma una contraseña para la copia exportada. Elige abajo ese archivo .p12 e introduce la contraseña de exportación.",
};
