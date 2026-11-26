export const NOT_SET_UP_WORDS = {
  en: "This box is not set up yet. If this venue already has a Waitron box, do not install this certificate: switch to the spare instead.",
  es: "Este servidor aún no está configurado. Si el local ya tiene un servidor Waitron, no instales este certificado: cambia al servidor de reserva.",
} as const;

export const CERTIFICATE_WORDS = {
  en: {
    current: "Certificate to install (SHA-256 fingerprint)",
    previous: "Previous certificate (SHA-256 fingerprint)",
    match: "Remove the previous certificate only if both its name and fingerprint match.",
    unavailable:
      "Leave installed certificates alone. Download and install the certificate shown here.",
    thumbprint: "Windows: open Details and compare Thumbprint (SHA-1).",
  },
  es: {
    current: "Certificado que vas a instalar (huella SHA-256)",
    previous: "Certificado anterior (huella SHA-256)",
    match: "Elimina el certificado anterior solo si coinciden el nombre y la huella.",
    unavailable:
      "Deja los certificados instalados como están. Descarga e instala el certificado que se muestra aquí.",
    thumbprint: "En Windows, abre Detalles y compara la Huella digital (SHA-1).",
  },
} as const;

export const TRUST_PAGE_WORDS = {
  en: {
    title: "Waitron — connect to this box",
    heading: 'Connect <span class="accent">securely</span> to this Waitron box',
    spareLead: (link: string) =>
      `Adding a spare? You don't need this box's certificate: open this address (${link}) and accept your browser's warning once.`,
    intro: (spare: boolean) =>
      `${spare ? "Otherwise, you" : "You"} need to install the Waitron secure certificate before entering passwords and sensitive information into this website:`,
    remove: "Remove this box’s previous certificate",
    removeIntro:
      "If you have installed a Waitron certificate on this device before, compare it with the previous certificate below. If the name or fingerprint differs, leave that entry alone.",
    findDevice:
      "Find your device in step 3 — each one's steps begin with how to remove an old certificate.",
    reopen: "Then quit your browser completely and reopen this page.",
    removeFirst: "Remove the matching certificate shown in step 1.",
    managed:
      "These steps use your device's own settings, with no terminal. Menu names vary by version. If installation is blocked, use a venue device that permits it.",
    install: "Install it on your device",
    otherDevices: "Using a different device?",
    get: "Get the certificate",
    download: "Download the certificate",
    downloadHelp: (filename: string) =>
      `Your browser may ask you to confirm the download — choose <strong>Keep</strong> or <strong>Download</strong>, or the file never reaches the disk. If the download does not start, delete the old <code>${filename}</code> from your downloads and try again.`,
    unavailable:
      "This box has no certificate to download. Check its known HTTPS address below and stop if it shows a certificate warning. This page cannot replace a separately installed certificate. A certificate downloaded before a re-image may no longer apply.",
    open: "Open Waitron",
    openHelp:
      'Open Waitron with the link below, then check the address bar of the page it opens. If that still shows <span class="warning-words">Not secure</span>, come back here and start again from step 1.',
    qr: "Open this page on another device",
  },
  es: {
    title: "Waitron. Conéctate a este servidor",
    heading: 'Conéctate <span class="accent">de forma segura</span> a este servidor Waitron',
    spareLead: (link: string) =>
      `¿Vas a añadir un servidor de reserva? No necesitas el certificado de este servidor. Abre esta dirección (${link}) y acepta el aviso del navegador una sola vez.`,
    intro: (spare: boolean) =>
      `${spare ? "En los demás casos, instala" : "Instala"} el certificado de Waitron antes de introducir contraseñas o datos sensibles en este sitio.`,
    remove: "Elimina el certificado anterior de Waitron",
    removeIntro:
      "Si ya instalaste un certificado de Waitron en este dispositivo, compáralo con el certificado anterior que se muestra abajo. Si el nombre o la huella no coinciden, deja esa entrada como está.",
    findDevice:
      "Busca tu dispositivo en el paso 3. Sus instrucciones empiezan por cómo eliminar el certificado anterior.",
    reopen: "Después, cierra por completo el navegador y vuelve a abrir esta página.",
    removeFirst: "Elimina el certificado que coincida con el del paso 1.",
    managed:
      "Sigue estos pasos en los ajustes del dispositivo. Los nombres de los menús varían según la versión. Si el dispositivo impide instalar el certificado, usa otro del local que lo permita.",
    install: "Instala el certificado en tu dispositivo",
    otherDevices: "¿Usas otro dispositivo?",
    get: "Obtén el certificado",
    download: "Descargar el certificado",
    downloadHelp: (filename: string) =>
      `Si el navegador te pide confirmar la descarga, elige <strong>Conservar</strong> o <strong>Descargar</strong> para guardar el archivo. Si la descarga no empieza, elimina el archivo <code>${filename}</code> anterior de tus descargas y vuelve a intentarlo.`,
    unavailable:
      "Este servidor no tiene ningún certificado para descargar. Comprueba su dirección HTTPS conocida en la lista de abajo y detente si ves un aviso del certificado. Esta página no puede sustituir un certificado que se instaló por separado. Si descargaste el certificado antes de reinstalar el servidor, puede que ya no sirva.",
    open: "Abre Waitron",
    openHelp:
      'Abre Waitron con el enlace de abajo y comprueba la barra de direcciones de la página que se abre. Si sigue mostrando <span class="warning-words">No es seguro</span>, vuelve aquí y empieza por el paso 1.',
    qr: "Abre esta página en otro dispositivo",
  },
};
