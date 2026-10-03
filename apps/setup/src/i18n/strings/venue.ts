// The venue, review and cert screens, and certificate-export-help.ts.

export const venueEn = {
  "venue.heading": "Your shop",
  "venue.intro": "Enter the business that issues your invoices and the address of this location.",
  "venue.intro_demo":
    "Name your demo location and enter its address. Waitron supplies a made-up business identity and invoice settings; you can review them before setup.",
  "venue.defaults_not_loaded": "Demo invoice settings have not loaded yet.",
  "venue.retry_defaults": "Try loading settings again",
  "venue.section.business": "Business",
  "venue.section.location": "Location",
  "venue.section.invoicing": "Invoicing",

  "venue.label.country": "Country",
  "venue.label.tax_id": "Tax ID",
  "venue.label.legal_name": "Legal name",
  "venue.label.location_name": "Location name",
  "venue.label.invoice_locales": "Receipt language",
  "venue.label.operation_description": "Invoice operation description",
  "venue.label.address_line1": "Address line 1",
  "venue.label.address_line2": "Address line 2 (optional)",
  "venue.label.postal_code": "Postal code",
  "venue.label.city": "City",
  "venue.label.province": "Province",
  "venue.label.province_region": "Province / region",
  "venue.label.day_cutover": "Business day cutover",
  "venue.label.till_name": "Till name",
  "venue.label.series_code": "Invoice series code",
  "venue.label.rectificative_series_code": "Rectificative series code",

  "venue.select_province": "Select province",
  "venue.combobox_search": "Search",
  "venue.combobox_no_results": "No results",
  "venue.fiscal_territory": "Fiscal territory: {territory}",
  "venue.time_zone": "Time zone: {zone}",
  "venue.invoice_locales_help_label": "Help with the receipt language",
  "venue.invoice_locales_help":
    "Choose the one language receipts print in. Where the region's law sets it, it is chosen for you and cannot be changed. The operation description is kept separately.",

  // Each `venue.field.*` fills `{field}` in the three sentences after it. Spanish carries the
  // article in the field, so the sentences read correctly whatever the noun's gender.
  "venue.field.country": "country",
  "venue.field.tax_id": "tax ID",
  "venue.field.legal_name": "legal name",
  "venue.field.name": "location name",
  "venue.field.operation_description": "invoice operation description",
  "venue.field.address_line1": "street address",
  "venue.field.address_line2": "address detail",
  "venue.field.postal_code": "postal code",
  "venue.field.city": "city",
  "venue.field.province": "province",
  "venue.field.day_cutover": "business day cutover",
  "venue.field.till_name": "till name",
  "venue.field.series_code": "invoice series code",
  "venue.field.rectificative_series_code": "correction series code",
  "venue.enter_field": "Enter the {field}.",
  "venue.check_field": "Check the {field}.",
  "venue.help_with_field": "Help with {field}",

  "venue.help.country":
    "Choose the country where your business is registered. It determines the available address and tax settings.",
  "venue.hint.tax_id": "Of the business that issues the invoices",
  "venue.hint.legal_name": "As on the business's tax documents",
  "venue.hint.name": "The name you use for this location",
  "venue.help.operation_description":
    "This text describes the sale on every record sent to the tax agency. Keep the suggested wording for ordinary shop sales. The receipt language does not translate this text. You can change it in the dashboard for future records.",
  "venue.hint.address_line1": "Street and building number",
  "venue.hint.address_line2": "Floor, unit or other detail",
  "venue.hint.postal_code": "Used to suggest the province",
  "venue.hint.city": "Town or city",
  "venue.help.province":
    "The province must match the postal code. It determines the fiscal territory and time zone.",
  "venue.help.day_cutover":
    "Sales before this time belong to the previous business day. Keep 04:00 if you finish trading after midnight.",
  "venue.help.till_name":
    "Name the first register. Caja 1 is a useful starting point; this name is not your tax-filing identity.",
  "venue.help.series_code":
    "This prefix identifies ordinary invoices, for example FS/1. Use letters, numbers, / _ . or -, up to 38 characters. Keep FS unless you need another series.",
  "venue.help.rectificative_series_code":
    "This prefix identifies correction invoices, for example FR/1. Use a different prefix from ordinary invoices. Keep FR unless you need another series.",

  "venue.error.invoice_locales": "Choose the receipt language.",
  "venue.error.tax_id": "Enter a valid tax ID for the selected country.",
  "venue.error.postal_code": "Enter a valid postal code that matches the province.",
  "venue.error.territory_unsupported": "Setup is not available for this fiscal territory yet.",
  "venue.error.province": "Choose the province that matches the postal code.",
  "venue.error.series_codes": "Use different codes for ordinary and correction invoices.",
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
    "Waitron generated a demo tax ID and supplied the business and invoice defaults below. Demo does not submit invoices to the tax agency.",
  "review.country": "Country",
  "review.tax_id": "Tax ID",
  "review.legal_name": "Legal name",
  "review.location": "Location",
  "review.address": "Address",
  "review.invoice_locales": "Receipt language",
  "review.operation_description": "Invoice operation description",
  "review.day_cutover": "Business day cutover",
  "review.till": "Till",
  "review.series": "Invoice series",
  "review.rectificative_series": "Corrections series",
  "review.badge.demo": "Demo",
  "review.badge.prepare": "Prepare",
  "review.badge.live": "Live",
  "review.group.business": "Business",
  "review.group.location": "Location",
  "review.group.invoicing": "Invoicing",
  "review.group.account": "Your account",
  "review.edit": "Edit",
  "review.help.business": "These details identify the legal business on invoices and tax records.",
  "review.help.location":
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
  "cert.passphrase_help_label": "Help with certificate passphrase",
  "cert.passphrase_help": "Enter the password you chose when exporting this certificate file.",
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
  "venue.heading": "Tu tienda",
  "venue.intro":
    "Introduce los datos del negocio que emite tus facturas y la dirección de este local.",
  "venue.intro_demo":
    "Pon nombre a tu local de demostración e introduce su dirección. Waitron aporta una identidad de negocio inventada y los ajustes de factura; puedes revisarlos antes de la configuración.",
  "venue.defaults_not_loaded": "Los ajustes de factura de demostración aún no se han cargado.",
  "venue.retry_defaults": "Volver a cargar los ajustes",
  "venue.section.business": "Negocio",
  "venue.section.location": "Local",
  "venue.section.invoicing": "Facturación",

  "venue.label.country": "País",
  "venue.label.tax_id": "Número de identificación fiscal",
  "venue.label.legal_name": "Razón social",
  "venue.label.location_name": "Nombre del local",
  "venue.label.invoice_locales": "Idioma del recibo",
  "venue.label.operation_description": "Descripción de la operación en la factura",
  "venue.label.address_line1": "Dirección (línea 1)",
  "venue.label.address_line2": "Dirección (línea 2, opcional)",
  "venue.label.postal_code": "Código postal",
  "venue.label.city": "Localidad",
  "venue.label.province": "Provincia",
  "venue.label.province_region": "Provincia / región",
  "venue.label.day_cutover": "Cambio de día comercial",
  "venue.label.till_name": "Nombre de la caja",
  "venue.label.series_code": "Código de la serie de facturas",
  "venue.label.rectificative_series_code": "Código de la serie rectificativa",

  "venue.select_province": "Elige la provincia",
  "venue.combobox_search": "Buscar",
  "venue.combobox_no_results": "Sin resultados",
  "venue.fiscal_territory": "Territorio fiscal: {territory}",
  "venue.time_zone": "Zona horaria: {zone}",
  "venue.invoice_locales_help_label": "Ayuda sobre el idioma del recibo",
  "venue.invoice_locales_help":
    "Elige el idioma en que se imprimen los recibos. Donde la ley de la región lo fija, viene elegido y no se puede cambiar. La descripción de la operación se guarda aparte.",

  "venue.field.country": "el país",
  "venue.field.tax_id": "el número de identificación fiscal",
  "venue.field.legal_name": "la razón social",
  "venue.field.name": "el nombre del local",
  "venue.field.operation_description": "la descripción de la operación en la factura",
  "venue.field.address_line1": "la calle y el número",
  "venue.field.address_line2": "el detalle de la dirección",
  "venue.field.postal_code": "el código postal",
  "venue.field.city": "la localidad",
  "venue.field.province": "la provincia",
  "venue.field.day_cutover": "la hora de cambio de día comercial",
  "venue.field.till_name": "el nombre de la caja",
  "venue.field.series_code": "el código de la serie de facturas",
  "venue.field.rectificative_series_code": "el código de la serie rectificativa",
  "venue.enter_field": "Introduce {field}.",
  "venue.check_field": "Revisa {field}.",
  "venue.help_with_field": "Ayuda sobre {field}",

  "venue.help.country":
    "Elige el país donde está registrado tu negocio. Determina los ajustes de dirección e impuestos disponibles.",
  "venue.hint.tax_id": "Del negocio que emite las facturas",
  "venue.hint.legal_name": "Como en sus documentos fiscales",
  "venue.hint.name": "El nombre que usas para este local",
  "venue.help.operation_description":
    "Este texto describe la venta en cada registro que se envía a la Agencia Tributaria. Mantén el texto propuesto para las ventas habituales en tienda. El idioma del recibo no traduce este texto. Puedes cambiarlo en el panel de control para los registros futuros.",
  "venue.hint.address_line1": "Calle y número",
  "venue.hint.address_line2": "Piso, puerta u otro detalle",
  "venue.hint.postal_code": "Sirve para proponer la provincia",
  "venue.hint.city": "Pueblo o ciudad",
  "venue.help.province":
    "La provincia debe corresponder al código postal. Determina el territorio fiscal y la zona horaria.",
  "venue.help.day_cutover":
    "Las ventas anteriores a esta hora pertenecen al día comercial anterior. Deja las 04:00 si cierras después de medianoche.",
  "venue.help.till_name":
    "Pon nombre a la primera caja. Caja 1 es un buen punto de partida; este nombre no es tu identidad a efectos fiscales.",
  "venue.help.series_code":
    "Este prefijo identifica las facturas ordinarias, por ejemplo FS/1. Usa letras, números, / _ . o -, hasta 38 caracteres. Deja FS salvo que necesites otra serie.",
  "venue.help.rectificative_series_code":
    "Este prefijo identifica las facturas rectificativas, por ejemplo FR/1. Usa un prefijo distinto al de las facturas ordinarias. Deja FR salvo que necesites otra serie.",

  "venue.error.invoice_locales": "Elige el idioma del recibo.",
  "venue.error.tax_id": "Introduce un número de identificación fiscal válido para el país elegido.",
  "venue.error.postal_code": "Introduce un código postal válido que corresponda a la provincia.",
  "venue.error.territory_unsupported":
    "La configuración aún no está disponible para este territorio fiscal.",
  "venue.error.province": "Elige la provincia que corresponde al código postal.",
  "venue.error.series_codes":
    "Usa códigos distintos para las facturas ordinarias y las rectificativas.",
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
    "Waitron ha generado un número de identificación fiscal de demostración y ha puesto los valores del negocio y de factura de abajo. La demostración no envía facturas a la Agencia Tributaria.",
  "review.country": "País",
  "review.tax_id": "Número de identificación fiscal",
  "review.legal_name": "Razón social",
  "review.location": "Local",
  "review.address": "Dirección",
  "review.invoice_locales": "Idioma del recibo",
  "review.operation_description": "Descripción de la operación en la factura",
  "review.day_cutover": "Cambio de día comercial",
  "review.till": "Caja",
  "review.series": "Serie de facturas",
  "review.rectificative_series": "Serie de correcciones",
  "review.badge.demo": "Demostración",
  "review.badge.prepare": "Preparación",
  "review.badge.live": "En vivo",
  "review.group.business": "Negocio",
  "review.group.location": "Local",
  "review.group.invoicing": "Facturación",
  "review.group.account": "Tu cuenta",
  "review.edit": "Editar",
  "review.help.business":
    "Estos datos identifican al negocio en las facturas y los registros fiscales.",
  "review.help.location":
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
  "cert.passphrase_help_label": "Ayuda sobre la contraseña del certificado",
  "cert.passphrase_help":
    "Introduce la contraseña que elegiste al exportar este archivo de certificado.",
  "cert.show_passphrase": "Mostrar la contraseña del certificado",
  "cert.hide_passphrase": "Ocultar la contraseña del certificado",
  "cert.kind_label": "Tipo de certificado",
  "cert.kind_help_label": "Ayuda sobre el tipo de certificado",
  "cert.kind_help":
    "Indica si es un certificado de sello electrónico o de representante, según el certificado que exportaste.",
  "cert.kind.sello": "Sello electrónico",
  "cert.kind.representante": "Representante",
  "cert.fix_fields": "Corrige los campos marcados para continuar.",
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
