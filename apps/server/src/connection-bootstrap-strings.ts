import type { DeviceHelp, DeviceId } from "./trust-page-devices.js";

export const CONNECTION_TEXT = {
  en: {
    title: "Set up secure connection",
    intro: "Reconnect to the venue network and use your server’s known address.",
    publicOnly:
      "Do not enter passwords or recovery keys here. Reopen HTTPS without warnings before recovering setup.",
    repair: "Set up secure connection",
    reconnect: "Reconnect",
    needed: "The server’s secure connection needs repair.",
    busy: "Setting up the connection…",
    ready: "Certificate ready.",
    certificateReady: "Certificate ready. Follow the instructions, then reconnect.",
    open: "Open Waitron below.",
    failed:
      "The connection could not be set up. Retry to run the repair again. If it keeps failing, stop here: this page cannot fix every certificate problem.",
    operator:
      "This server uses a separately installed certificate. Check the HTTPS address below. If it shows a certificate warning, stop; this page cannot replace that certificate.",
    check: "Check again",
    stop: "Stop",
    stopped: "Stopped. You can close this tab, or check the connection again.",
    choiceHelp: "Check again rereads the connection without repairing it. Stop ends this attempt.",
    retained: "Keep your installed Waitron certificate.",
    retainedHelp:
      "If this device already trusts it, continue below. Otherwise, download and install it on this device.",
    newTrust: "Install the new Waitron certificate on each device.",
    newTrustHelp:
      "The previous certificate cannot be reused. Remove the old Waitron entry, then download, install and trust the new one.",
    download: "Download public certificate",
    downloadHelp: "If your browser asks, keep the downloaded file.",
    install: "Installation help",
    remove: "Remove the old Waitron certificate only when replacing it.",
    managed: "If this device blocks certificate installation, use a venue device that allows it.",
    continue: "Continue to Waitron",
    warning: "Check the page that opens: continue only when HTTPS shows no certificate warning.",
    fingerprint: "Public certificate fingerprint",
    language: "Language",
    languageName: "English",
  },
  es: {
    title: "Configurar conexión segura",
    intro: "Conéctate a la red del local y usa la dirección conocida de tu servidor.",
    publicOnly:
      "No introduzcas contraseñas ni claves de recuperación aquí. Abre HTTPS sin avisos antes de recuperar la configuración.",
    repair: "Configurar conexión segura",
    reconnect: "Reconectar",
    needed: "La conexión segura del servidor necesita reparación.",
    busy: "Configurando la conexión…",
    ready: "Certificado listo.",
    certificateReady: "Certificado listo. Sigue las instrucciones y reconecta.",
    open: "Abre Waitron abajo.",
    failed:
      "No se ha podido configurar la conexión. Reintenta la reparación. Si sigue fallando, detente aquí: esta página no puede reparar todos los problemas de certificados.",
    operator:
      "Este servidor usa un certificado instalado por separado. Comprueba la dirección HTTPS de abajo. Si muestra un aviso del certificado, detente: esta página no puede sustituirlo.",
    check: "Comprobar de nuevo",
    stop: "Detener",
    stopped: "Intento detenido. Puedes cerrar esta pestaña o comprobar la conexión de nuevo.",
    choiceHelp:
      "Comprobar de nuevo vuelve a leer la conexión sin repararla. Detener finaliza este intento.",
    retained: "Conserva el certificado de Waitron que ya tienes instalado.",
    retainedHelp:
      "Si este dispositivo ya confía en él, continúa abajo. Si no, descárgalo e instálalo en este dispositivo.",
    newTrust: "Instala el nuevo certificado de Waitron en cada dispositivo.",
    newTrustHelp:
      "No se puede reutilizar el certificado anterior. Elimina la entrada antigua de Waitron y descarga, instala y confía en el nuevo.",
    download: "Descargar certificado público",
    downloadHelp: "Si tu navegador lo pregunta, conserva el archivo descargado.",
    install: "Ayuda para instalar",
    remove: "Elimina el certificado antiguo de Waitron solo si vas a sustituirlo.",
    managed:
      "Si este dispositivo bloquea la instalación del certificado, usa uno del local que la permita.",
    continue: "Continuar a Waitron",
    warning:
      "Comprueba la página que se abre: continúa solo si HTTPS no muestra avisos del certificado.",
    fingerprint: "Huella del certificado público",
    language: "Idioma",
    languageName: "Español",
  },
} as const;

export const CONNECTION_DEVICE_ES: Record<DeviceId, DeviceHelp> = {
  macos: {
    heading: "Instalar en este Mac",
    summary: "macOS: Safari, Chrome, Edge y Firefox",
    removal: [
      "En Acceso a Llaveros, elimina la entrada antigua de Waitron. Revisa los llaveros de inicio de sesión y del sistema.",
    ],
    install: [
      "Abre el archivo descargado con Acceso a Llaveros y añádelo a tu llavero de inicio de sesión.",
      "Abre el certificado, despliega Confianza y elige Confiar siempre en Secure Sockets Layer (SSL). Cierra la ventana y confirma con tu contraseña de Mac si se solicita.",
      "Cierra por completo el navegador y vuelve a abrir esta página.",
    ],
    notes: [
      "En Firefox, permite confiar automáticamente en los certificados raíz de terceros instalados, en Ajustes, Privacidad y seguridad, Certificados.",
    ],
  },
  windows: {
    heading: "Instalar en este PC con Windows",
    summary: "Windows: Edge, Chrome y Firefox",
    removal: [
      "Busca Administrar certificados de usuario en Inicio. En Entidades de certificación raíz de confianza, Certificados, elimina la entrada antigua de Waitron.",
      "Para eliminar una copia instalada para todo el equipo, inicia sesión en Windows con una cuenta de administrador.",
    ],
    install: [
      "Abre el archivo descargado y elige Instalar certificado y Usuario actual.",
      "Elige Colocar todos los certificados en el siguiente almacén, Examinar y Entidades de certificación raíz de confianza. Completa la importación y confirma el certificado elegido.",
      "Cierra todas las ventanas del navegador y vuelve a abrir esta página.",
    ],
    notes: [
      "En Firefox, permite certificados raíz de terceros en Privacidad y seguridad, o importa el archivo con su administrador de certificados.",
    ],
  },
  linux: {
    heading: "Instalar en este PC con Linux",
    summary: "Linux: Chrome, Chromium y Edge",
    removal: [
      "Elimina la entrada antigua de Waitron de Certificados personalizados o Autoridades en cada navegador donde la instalaste.",
    ],
    install: [
      "Busca Administrar certificados en la configuración de Chrome o Chromium, o abre <code>chrome://certificate-manager</code>.",
      "En Certificados personalizados, Certificados de confianza, importa el archivo. Si aparece Autoridades, permite identificar sitios web.",
      "En Edge, busca Administrar certificados o abre <code>edge://certificate-manager</code> e importa el archivo como autoridad de confianza.",
      "Cierra por completo el navegador y vuelve a abrir esta página.",
    ],
    notes: [
      "Instala el archivo en cada navegador que uses. Firefox en Linux tiene su propia lista; sigue sus instrucciones.",
    ],
  },
  chromeos: {
    heading: "Instalar en este Chromebook",
    summary: "ChromeOS: Chrome",
    removal: [
      "Elimina la entrada antigua de Waitron en el mismo administrador de certificados donde la importaste.",
    ],
    install: [
      "Busca Administrar certificados en la configuración de Chrome, o abre <code>chrome://certificate-manager</code>.",
      "Importa el archivo en Certificados personalizados, Certificados de confianza. Si aparece Autoridades, permite identificar sitios web.",
      "Cierra por completo Chrome y vuelve a abrir esta página.",
    ],
  },
  android: {
    heading: "Instalar en este teléfono o tableta Android",
    summary: "Android: Chrome, Edge, Firefox y Samsung Internet",
    removal: [
      "En Cifrado y credenciales, busca Credenciales de usuario o Credenciales de confianza, Usuario. Elimina solo el certificado antiguo de Waitron.",
    ],
    install: [
      "Busca Instalar un certificado en Ajustes de Android. En un Pixel, busca Seguridad y privacidad, Más ajustes de seguridad, Cifrado y credenciales.",
      "Elige Certificado de CA, confirma el aviso, desbloquea el dispositivo si se solicita y selecciona el archivo descargado.",
      "Cierra el navegador desde las aplicaciones recientes y vuelve a abrir esta página.",
    ],
    notes: [
      "La autoridad se instala para todo el dispositivo. Puedes usar un dispositivo del local en lugar de tu teléfono personal.",
    ],
  },
  ios: {
    heading: "Instalar en este iPhone o iPad",
    summary: "iPhone y iPad: Safari, Chrome, Edge y Firefox",
    removal: [
      "Abre Ajustes, General, VPN y gestión de dispositivos. Selecciona el perfil antiguo de Waitron y elige Eliminar perfil.",
    ],
    install: [
      "Abre esta página en Safari para descargar el archivo y permite la descarga del perfil.",
      "Abre Ajustes, General, VPN y gestión de dispositivos. Selecciona el perfil descargado e instálalo.",
      "En Ajustes, General, Información, Ajustes de confianza de certificados, activa la confianza total para este certificado. Instalar el perfil no basta.",
      "Cierra el navegador desde las aplicaciones recientes y vuelve a abrir esta página.",
    ],
  },
  "firefox-linux": {
    heading: "Instalar en Firefox para Linux",
    summary: "Firefox en Linux: su propio administrador de certificados",
    removal: [
      "En la misma lista de Autoridades, selecciona la entrada antigua de Waitron y elige Eliminar o dejar de confiar.",
    ],
    install: [
      "Abre Ajustes, Privacidad y seguridad, Certificados, Ver certificados.",
      "Elige Autoridades, Importar, selecciona el archivo descargado y permite identificar sitios web.",
      "Cierra por completo Firefox y vuelve a abrir esta página.",
    ],
    notes: [
      "Firefox en Linux necesita esta importación aunque ya hayas instalado el archivo para Chrome.",
    ],
  },
};
