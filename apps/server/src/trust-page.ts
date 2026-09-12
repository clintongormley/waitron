/** Shared, self-contained instructions for the HTTP landing page and HTTPS setup help. */
export const CA_CONTENT_TYPE = "application/x-x509-ca-cert";
export const CA_FILENAME = "waitron-ca.crt";

export interface TrustPageInput {
  reachUrls: string[];
  caAvailable: boolean;
  caDownloadPath: string;
  qrSvg?: string;
  httpsUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** No external assets: certificate recovery must remain readable without internet access. */
export function renderTrustPage(input: TrustPageInput): string {
  const { reachUrls, caAvailable, caDownloadPath, qrSvg, httpsUrl } = input;
  const urlItems = reachUrls
    .map((u) => `<li><a href="${escapeHtml(u)}">${escapeHtml(u)}</a></li>`)
    .join("");
  const caBlock = caAvailable
    ? `<p><a class="button" href="${escapeHtml(caDownloadPath)}" download="${CA_FILENAME}">Download this box's certificate</a></p>
       <p>Download a fresh copy from this box. Install it using the instructions for your device below.
       This is the connection certificate, not your business's tax-agency certificate.</p>`
    : `<p>No box certificate is available to download. If this box uses an operator-supplied certificate,
       ask whoever installed it to check its trust, expiry and the address you are opening.</p>`;

  const osSteps = caAvailable
    ? `<section>
    <h2>2. Choose your device</h2>
    <p>These steps use your device's settings, without a terminal. Menu names vary by version.
       On a managed device, your administrator may need to install the certificate for you.</p>
    <details><summary>macOS: Safari, Chrome, Edge and Firefox</summary>
      <ol><li>Open the downloaded certificate with Keychain Access and add it to your login keychain.</li>
      <li>In Keychain Access, open the certificate, expand Trust, and set Secure Sockets Layer (SSL) to Always Trust.
      Close the window and approve the change with your Mac password if asked.</li>
      <li>Quit your browser completely, reopen it, and open this box again.</li></ol>
      <p>Firefox: in Settings, Privacy &amp; Security, Certificates, enable
      “Allow Firefox to automatically trust third-party root certificates you install”.
      If needed, use the separate Firefox instructions below.</p>
      <p>To remove an old certificate, find that box's entry in Keychain Access and delete it.
      Check both login and System keychains if it was installed more than once.</p>
    </details>
    <details><summary>Windows: Edge, Chrome and Firefox</summary>
      <ol><li>Open the downloaded certificate and choose Install Certificate, then Current User.</li>
      <li>Choose “Place all certificates in the following store”, Browse, and
      Trusted Root Certification Authorities. Finish the import and approve the certificate you chose.</li>
      <li>Close all browser windows, reopen your browser, and open this box again.</li></ol>
      <p>Firefox: allow installed third-party root certificates in its Privacy &amp; Security settings,
      or use its separate certificate manager below.</p>
      <p>To remove an old certificate, search the Start menu for “Manage user certificates”.
      Under Trusted Root Certification Authorities, Certificates, delete that box's old entry.
      An administrator must remove a copy installed for the whole computer.</p>
    </details>
    <details><summary>Linux: Chrome, Chromium, Edge and Firefox</summary>
      <p>Install the certificate in the browser you will use. Repeat for another browser if it still shows a warning.</p>
      <ol><li>For Chrome or Chromium, open Settings and search for “Manage certificates”.
      You can also type <code>chrome://certificate-manager</code> in the address bar.</li>
      <li>Under Custom certificates, Trusted certificates, import the downloaded file.
      Older versions call this area Authorities; enable trust for identifying websites.</li>
      <li>For Edge, search its Settings for “Manage certificates” or type
      <code>edge://certificate-manager</code>. Import the file as a trusted authority.</li>
      <li>For Firefox, use its separate instructions below. Restart the browser after importing.</li></ol>
      <p>Remove an old certificate in the same browser's custom certificates or Authorities list.
      If your managed browser does not offer import, ask its administrator to install it.</p>
    </details>
    <details><summary>ChromeOS: Chrome</summary>
      <ol><li>Open Chrome Settings and search for “Manage certificates”, or type
      <code>chrome://certificate-manager</code> in the address bar.</li>
      <li>Import the downloaded certificate under Custom certificates, Trusted certificates.
      If your version shows Authorities instead, import it there and allow it to identify websites.</li>
      <li>Close and reopen Chrome, then open the box again.</li></ol>
      <p>Remove the old entry in the same certificate manager. On a managed Chromebook, ask your
      administrator if import or removal is unavailable.</p>
    </details>
    <details><summary>Android: Chrome, Edge, Firefox and Samsung Internet</summary>
      <ol><li>Download the certificate. Open Android Settings and search for “Install a certificate”.
      On Pixel, look under Security &amp; privacy, More security settings, Encryption &amp; credentials.</li>
      <li>Choose CA certificate, approve the device's warning, unlock the device if asked, and select the downloaded file.</li>
      <li>Close and reopen your browser, then open this box again. Firefox can use installed Android authorities;
      update the browser if its certificate support differs from these steps.</li></ol>
      <p>To remove an old certificate, return to Encryption &amp; credentials and look under User credentials
      or Trusted credentials, User. Select only that box's old certificate and remove it.</p>
      <p>Installing a CA grants device-wide trust. Use a venue-owned device if you do not want to grant that trust on a personal phone.</p>
    </details>
    <details><summary>iPhone and iPad (iOS / iPadOS): Safari, Chrome, Edge and Firefox</summary>
      <ol><li>Open this guide in Safari to download the certificate and allow the profile download.</li>
      <li>Open Settings, General, VPN &amp; Device Management. Select the downloaded profile and install it.</li>
      <li>Then open Settings, General, About, Certificate Trust Settings, and enable full trust for this certificate.
      Installing the profile alone does not enable trust for secure websites.</li>
      <li>Reopen the browser you want to use and open this box again.</li></ol>
      <p>To remove an old certificate, open Settings, General, VPN &amp; Device Management,
      select that box's old profile, and choose Remove Profile. Download and trust the replacement afterwards.</p>
    </details>
    <details><summary>Firefox desktop: its own certificate manager</summary>
      <ol><li>Open Settings, Privacy &amp; Security, Certificates, View Certificates.</li>
      <li>Choose Authorities, Import, select the downloaded file, and allow it to identify websites.</li>
      <li>Restart Firefox and open the box again.</li></ol>
      <p>Remove an old entry from Authorities using Delete or Distrust. This browser-specific import is particularly
      useful on Linux, or when Firefox does not use your operating system's installed certificate.</p>
    </details>
  </section>
  <section id="replacement">
    <h2>If this box was re-imaged</h2>
    <p>A re-image can replace this box's certificate while your device keeps the old certificate.
    Download the new file, remove only the old certificate for this box using the steps above,
    and install and trust the replacement. Do not remove unrelated certificates.</p>
    <p>Then fully quit the browser, including its background process if it keeps running, and reopen it.
    On macOS, use the browser's Quit menu or Command-Q; closing a tab is not the same as quitting.</p>
    <p>If several certificates have the same name and you cannot identify this box's old entry,
    ask the installer to identify it before removing anything.</p>
  </section>`
    : `<section id="replacement"><h2>If this box was re-imaged</h2>
       <p>Ask whoever installed the box to confirm which certificate it now serves and how your device
       should trust it. A certificate downloaded before the re-image may no longer apply.</p></section>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Waitron — connect to this box</title>
<style>
:root { color-scheme: light dark; font: 17px/1.55 system-ui, sans-serif; }
body { margin: 0; } main { max-width: 48rem; margin: auto; padding: 1.5rem; }
h1 { line-height: 1.2; } h2 { font-size: 1.3rem; } section { margin: 2rem 0; }
a { color: light-dark(#174da1, #9ec5ff); } li { margin-block: .6rem; }
details { border: 1px solid light-dark(#c4cbd4, #637080); border-radius: .5rem; padding: 1rem; margin-block: .7rem; }
summary { cursor: pointer; font-weight: 600; } .button { display: inline-block; padding: .7rem 1rem; border: 1px solid; border-radius: .4rem; }
code, a { overflow-wrap: anywhere; } svg { max-width: 14rem; height: auto; background: white; }
:focus-visible { outline: 3px solid light-dark(#174da1, #9ec5ff); outline-offset: 4px; }
</style></head><body><main>
<h1>Connect to this Waitron box</h1>
<p>Set up the connection before entering passwords or business details. You should be able to reopen
this box without a certificate warning. A browser's “continue anyway” exception is not a certificate installation.</p>
<section><h2>1. Get the certificate</h2>${caBlock}</section>
${osSteps}
<section id="connection-help"><h2>If you cannot open or download</h2>
<p>Check that the box is on and your device can reach its network. Open this guide at
<code>http://&lt;box-address&gt;/setup/trust</code>, using the box's numeric network address if its name does not work.</p>
<p>Some browsers change HTTP to HTTPS automatically. The guide and certificate download exist on both,
but HTTPS can show a certificate warning before this page opens. Use the browser's option to visit the
HTTP version of this local box if offered. If your browser or administrator forbids that, download the
certificate on another device that can reach the box and transfer the file to this device.</p>
<p>If a certificate warning remains after installation, check the address, your device's date and time,
and the selected browser's trust settings. See the re-image guidance above if this box was replaced.</p>
</section>
<section class="go"><h2>${caAvailable ? "3" : "2"}. Open Waitron</h2>
<p>After installing the certificate, reopen your browser and follow this link. If it still shows a warning,
return to the instructions rather than entering setup details.</p>
<p class="continue"><a class="button" href="${escapeHtml(httpsUrl)}">Continue to Waitron</a></p>
<ul>${urlItems}</ul></section>
<section class="scan"><h2>Open on another device</h2>
${
  qrSvg
    ? `<figure>${qrSvg}<figcaption>This QR opens the box address.</figcaption></figure>`
    : '<p class="no-qr">No QR code is available here. Use one of the addresses above.</p>'
}
</section>
</main></body></html>\n`;
}
