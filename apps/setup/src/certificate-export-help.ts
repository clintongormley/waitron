import { html, nothing } from "lit";

const GUIDES = [
  {
    id: "windows",
    title: "Windows (Chrome)",
    href: "https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1501-como-puedo-exportar-un-certificado-digital-con-google-chrome-en-windows-",
    steps: [
      "In Chrome Settings, open Privacy and security, then Security, Manage certificates and Manage imported certificates from Windows.",
      "Select your signing certificate and choose Export. In the Windows wizard, choose to export the private key and keep the default export format.",
      "Set and confirm an export password, choose where to save the file, then finish the wizard. Choose the resulting .pfx or .p12 file below and enter that export password.",
    ],
  },
  {
    id: "mac",
    title: "macOS (Keychain Access)",
    href: "https://www.sede.fnmt.gob.es/eu/preguntas-frecuentes/android-mac/-/asset_publisher/1RphW9IeUoAH/content/1379-como-puedo-exportar-mi-certificado-desde-el-llavero-de-mac-",
    steps: [
      "Open Keychain Access from Applications, Utilities. Under My Certificates, select your signing certificate.",
      "Choose File, Export Items. Choose a name and folder for the .p12 file.",
      "Set and confirm an export password. Choose the saved .p12 file below and enter that password.",
    ],
  },
  {
    id: "firefox",
    title: "Firefox",
    href: "https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1399-como-puedo-exportar-mi-certificado-con-mozilla-firefox-",
    steps: [
      "Open Firefox Settings and find Certificates. Open the certificate manager and its Your Certificates tab.",
      "Select your signing certificate and choose Backup. Choose a folder and a filename ending in .p12.",
      "Enter Firefox's primary password if requested, then set and confirm a password for the exported copy. Choose that .p12 file below and enter the export password.",
    ],
  },
];

export function certificateExportHelp(userAgent: string) {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(userAgent);
  const platform = mobile
    ? undefined
    : /Firefox\//.test(userAgent)
      ? "firefox"
      : /Windows/.test(userAgent)
        ? "windows"
        : /Macintosh/.test(userAgent)
          ? "mac"
          : undefined;
  return html`<section
    data-test="certificate-export-help"
    aria-label="Export your signing certificate"
  >
    <h2>Get your certificate file</h2>
    <p>
      Export the signing certificate on the computer where it is installed. Choose the instructions
      for that computer or browser below.
    </p>
    ${platform === undefined ? html`<p>If your certificate is on another computer, export it there and transfer the file to this device.</p>` : nothing}
    ${GUIDES.map(
      (guide) =>
        html`<details ?open=${guide.id === platform}>
          <summary>${guide.title}</summary>
          <ol>
            ${guide.steps.map((step) => html`<li>${step}</li>`)}
          </ol>
          <a href=${guide.href} target="_blank" rel="noopener noreferrer"
            >FNMT export instructions</a
          >
        </details>`,
    )}
  </section>`;
}
