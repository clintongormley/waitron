# Connect to a box before entering setup details

B1, 2026-09-12. Scope: a browser-guided connection and recovery flow for the standalone box.
The owner requires the common operating systems and browsers, not only the Mac/Chrome incident.

## Operator flow

Start at `http://waitron.local/setup/trust`, printed and encoded by the installer. Both listeners
serve `/setup/trust`, `/ca.crt` and `/setup-api/ca.crt`, so an HTTP-to-HTTPS upgrade preserves the
requested resource. HTTPS may still show the browser's certificate interstitial before our page.
The guide explains using HTTP where the browser permits it, or transferring the certificate from
another device that can reach the box. Do not promise that a URL or QR defeats HTTPS-only policy.

The self-contained guide provides expandable instructions for macOS, Windows, Linux, ChromeOS, Android and
iPhone/iPad, with Safari, Chrome/Chromium, Edge and Firefox paths, plus Android's Samsung Internet.
Explain installation, Firefox's separate trust settings, removal of only this box's old certificate,
and a full browser quit after replacing a certificate. Do not ask operators to remove an ambiguous
entry, disable browser security globally or enter application credentials over HTTP.

Opening the wizard directly first shows a connection step. Read the existing discovery and status
APIs. A box without a downloadable CA proceeds to the mode chooser; a box with a CA offers the guide
before collecting passwords or business details. Continue reads status again. This is a communication
check, never proof of installed trust. A failed read leaves a retry and the guide visible. Late reads
must not undo a later successful check. No persistent “trusted” flag and no new authorization gate.

Provisioning failures offer certificate/network help in another tab. Keep the draft in memory;
closing or reloading the wizard loses it. Preserve the existing terminal setup responses and retry
rules. The connection certificate remains separate from the tax-agency signing certificate.

## Verification and limits

Regression tests cover the first connection step, failed/retried reads, preservation of the draft,
help destinations, resource paths on both listeners, uncached certificate downloads and installer
output. Browser checks exercise the generated page and keyboard-accessible disclosures. Run setup
and server coverage, the repository gate, and a production setup build.

Manual acceptance matrix: each OS/browser combination above needs first installation, reopening
without a warning, then replacement after a re-image. Desktop automation and published instructions
are not evidence of completing those system-settings operations on physical phones or Windows/Linux.
Record those rows explicitly in the UI tracker instead of calling all platforms verified.

## Provenance

Accessed 2026-09-12. Short source quotations establish the boundary; the UI paraphrases the procedure.

| Source | Source wording | Consequence |
| --- | --- | --- |
| [Chrome security settings](https://support.google.com/chrome/answer/10468685) | “Chrome upgrades URLs to use HTTPS” | Matching HTTP/HTTPS paths help preserve the destination; they cannot prevent a browser interstitial. |
| [Chrome certificate FAQ](https://chromium.googlesource.com/chromium/src/+/HEAD/net/data/ssl/chrome_root_store/faq.md) | “chrome://certificate-manager”; “Secure Sockets Layer (SSL)” | Chrome provides certificate management and consumes explicit local trust, including the Mac SSL trust setting. |
| [Apple Mac trust settings](https://support.apple.com/guide/keychain-access/change-the-trust-settings-of-a-certificate-kyca11871/mac) | “choose new trust settings from the pop-up menus” | Use Keychain Access to change the imported certificate's trust. |
| [Apple iOS trust](https://support.apple.com/en-us/102390) | “isn't automatically trusted for SSL” | Installing the profile and enabling full trust are separate steps. |
| [Google Android certificates](https://support.google.com/pixelphone/answer/2844832) | “install that certificate manually” | The Android OS owns the installation/removal flow; menu names differ across devices. |
| [Mozilla CA setup](https://support.mozilla.org/en-US/kb/setting-certificate-authorities-firefox) | “Windows, macOS and Android” | Firefox can use those OS stores; retain a separate desktop import path, especially for Linux. |
| [Microsoft root store](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/trusted-root-certification-authorities-certificate-store) | “import new trusted certificates, or remove existing ones” | Windows root-store installation and removal are explicit operations. |
| [Edge certificate verification](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-cert-verification) | “Known locally trusted certificate behavior differences on Windows” | A browser-shipped root store does not make locally installed authorities irrelevant. |
| Local Chrome 153 probe, `/tmp/waitron-b1-probe.ts` | `ERR_CERT_AUTHORITY_INVALID`; after explicit bypass: `secureContext: true, fetchStatus: 200` | `isSecureContext` and a successful fetch cannot establish that the operator installed the CA. No keychain or existing browser profile was modified. |

The old-CA removal plus full Chrome quit procedure comes from the owner's recorded box incident in
`docs/backlog.md` B1. This branch does not claim that every OS or every certificate replacement needs
all those recovery steps.

## Review clarification, 2026-09-12

Public guide/download routes belong on the main listener before setup, trading and adoption gates,
and before the recovery page's catch-all. Machine discovery remains setup-only. Disable box CA
availability and downloads when operator TLS is active, even when fallback box secrets exist.
The installer also prints the HTTPS help address for installations without the HTTP landing listener.
