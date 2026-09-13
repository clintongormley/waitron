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

/** One guide's content: the steps, then the FNMT page they came from. */
function guideBody(guide: (typeof GUIDES)[number]) {
  return html`<ol>
      ${guide.steps.map((step) => html`<li>${step}</li>`)}
    </ol>
    <a href=${guide.href} target="_blank" rel="noopener noreferrer">FNMT export instructions</a>`;
}

function closedGuide(guide: (typeof GUIDES)[number]) {
  return html`<details>
    <summary>${guide.title}</summary>
    ${guideBody(guide)}
  </details>`;
}

const TRANSFER =
  "If your certificate is on another computer, export it there and transfer the file to this device.";

/**
 * Export help for the computer the operator is on, guessed from the user-agent.
 *
 * The guess is promoted OUT of the list rather than pre-opened inside it. Pre-opening was the first
 * shape, and the owner read it as "a list of all available combos" on a Mac (2026-09-13): the open
 * entry sat below Windows, so the first heading a Mac reader met was the wrong computer's. When the
 * user-agent names nothing we recognise, the plain list is still the right answer and comes back.
 */
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
  const chosen = GUIDES.find((guide) => guide.id === platform);
  return html`<section
    data-test="certificate-export-help"
    aria-label="Export your signing certificate"
  >
    <h2>Get your certificate file</h2>
    <p>
      Export the signing certificate on the computer where it is
      installed.${chosen ? nothing : " Choose the instructions for that computer or browser below."}
    </p>
    ${chosen === undefined ? html`<p>${TRANSFER}</p>` : nothing}
    ${
      chosen
        ? html`<div data-test="export-guide">
              <h3>${chosen.title}</h3>
              ${guideBody(chosen)}
            </div>
            <details data-test="other-guides">
              <summary>Exporting from a different computer or browser?</summary>
              <p>${TRANSFER}</p>
              ${GUIDES.filter((guide) => guide !== chosen).map(closedGuide)}
            </details>`
        : GUIDES.map(closedGuide)
    }
  </section>`;
}
