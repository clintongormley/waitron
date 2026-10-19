// Copied from apps/setup (certificate-export-help.ts and i18n/strings/venue.ts), which a module may
// not import; scripts/certificate-export-guides.test.ts keeps the copy equal. Each step 3 says
// "above" because the dashboard shows the guides under the file field.

export const EXPORT_GUIDES = [
  {
    id: "windows",
    title: "cert_help.windows.title",
    href: "https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1501-como-puedo-exportar-un-certificado-digital-con-google-chrome-en-windows-",
    steps: ["cert_help.windows.step1", "cert_help.windows.step2", "cert_help.windows.step3"],
  },
  {
    id: "mac",
    title: "cert_help.mac.title",
    href: "https://www.sede.fnmt.gob.es/eu/preguntas-frecuentes/android-mac/-/asset_publisher/1RphW9IeUoAH/content/1379-como-puedo-exportar-mi-certificado-desde-el-llavero-de-mac-",
    steps: ["cert_help.mac.step1", "cert_help.mac.step2", "cert_help.mac.step3"],
  },
  {
    id: "firefox",
    title: "cert_help.firefox.title",
    href: "https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1399-como-puedo-exportar-mi-certificado-con-mozilla-firefox-",
    steps: ["cert_help.firefox.step1", "cert_help.firefox.step2", "cert_help.firefox.step3"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  title: ExportGuideKey;
  href: string;
  steps: readonly ExportGuideKey[];
}>;

export const EXPORT_GUIDE_STRINGS = {
  "cert_help.aria_label": {
    en: "Export your signing certificate",
    es: "Exporta tu certificado de firma",
  },
  "cert_help.heading": {
    en: "Get your certificate file",
    es: "Consigue el archivo de tu certificado",
  },
  "cert_help.intro": {
    en: "Export the signing certificate on the computer where it is installed.",
    es: "Exporta el certificado de firma en el ordenador donde está instalado.",
  },
  "cert_help.choose": {
    en: "Choose the instructions for that computer or browser below.",
    es: "Elige abajo las instrucciones para ese ordenador o navegador.",
  },
  "cert_help.transfer": {
    en: "If your certificate is on another computer, export it there and transfer the file to this device.",
    es: "Si tu certificado está en otro ordenador, expórtalo allí y pasa el archivo a este dispositivo.",
  },
  "cert_help.other_guides": {
    en: "Exporting from a different computer or browser?",
    es: "¿Lo exportas desde otro ordenador o navegador?",
  },
  "cert_help.fnmt_link": {
    en: "FNMT export instructions",
    es: "Instrucciones de exportación de la FNMT",
  },
  "cert_help.windows.title": {
    en: "Windows (Chrome)",
    es: "Windows (Chrome)",
  },
  "cert_help.windows.step1": {
    en: "In Chrome Settings, open Privacy and security, then Security, Manage certificates and Manage imported certificates from Windows.",
    es: "En la configuración de Chrome, abre Privacidad y seguridad, después Seguridad, Gestionar certificados y Gestionar certificados importados de Windows.",
  },
  "cert_help.windows.step2": {
    en: "Select your signing certificate and choose Export. In the Windows wizard, choose to export the private key and keep the default export format.",
    es: "Selecciona tu certificado de firma y elige Exportar. En el asistente de Windows, elige exportar la clave privada y deja el formato de exportación predeterminado.",
  },
  "cert_help.windows.step3": {
    en: "Set and confirm an export password, choose where to save the file, then finish the wizard. Choose the resulting .pfx or .p12 file above and enter that export password.",
    es: "Escribe y confirma una contraseña de exportación, elige dónde guardar el archivo y termina el asistente. Elige arriba el archivo .pfx o .p12 resultante e introduce esa contraseña de exportación.",
  },
  "cert_help.mac.title": {
    en: "macOS (Keychain Access)",
    es: "macOS (Acceso a Llaveros)",
  },
  "cert_help.mac.step1": {
    en: "Open Keychain Access from Applications, Utilities. Under My Certificates, select your signing certificate.",
    es: "Abre Acceso a Llaveros desde Aplicaciones, Utilidades. En Mis certificados, selecciona tu certificado de firma.",
  },
  "cert_help.mac.step2": {
    en: "Choose File, Export Items. Choose a name and folder for the .p12 file.",
    es: "Elige Archivo, Exportar ítems. Elige un nombre y una carpeta para el archivo .p12.",
  },
  "cert_help.mac.step3": {
    en: "Set and confirm an export password. Choose the saved .p12 file above and enter that password.",
    es: "Escribe y confirma una contraseña de exportación. Elige arriba el archivo .p12 guardado e introduce esa contraseña.",
  },
  "cert_help.firefox.title": {
    en: "Firefox",
    es: "Firefox",
  },
  "cert_help.firefox.step1": {
    en: "Open Firefox Settings and find Certificates. Open the certificate manager and its Your Certificates tab.",
    es: "Abre los Ajustes de Firefox y busca Certificados. Abre el administrador de certificados y su pestaña Sus certificados.",
  },
  "cert_help.firefox.step2": {
    en: "Select your signing certificate and choose Backup. Choose a folder and a filename ending in .p12.",
    es: "Selecciona tu certificado de firma y elige Hacer copia. Elige una carpeta y un nombre de archivo que termine en .p12.",
  },
  "cert_help.firefox.step3": {
    en: "Enter Firefox's primary password if requested, then set and confirm a password for the exported copy. Choose that .p12 file above and enter the export password.",
    es: "Introduce la contraseña principal de Firefox si te la pide y, después, escribe y confirma una contraseña para la copia exportada. Elige arriba ese archivo .p12 e introduce la contraseña de exportación.",
  },
} as const satisfies Record<string, { en: string; es: string }>;

export type ExportGuideKey = keyof typeof EXPORT_GUIDE_STRINGS;
