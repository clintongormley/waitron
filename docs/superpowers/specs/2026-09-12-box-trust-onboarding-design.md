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

## Rework, 2026-09-13

Owner review of both pages. Recorded here rather than rewritten above: the sections before this one
describe what was true when they were written.

The guide now guesses the visitor's device from the request's `sec-ch-ua-platform` and `user-agent`
headers and opens that device's steps, folding every other device into one closed disclosure. When
the headers name nothing it recognises it falls back to the closed list this spec described, so a
wrong guess costs one click and an absent guess costs nothing. Neither header's text is ever printed
on the page — it only chooses which fixed section to open, which matters because the page is
unauthenticated (`apps/server/src/detect-device.ts`).

Removal steps moved inside each device, behind "Already installed a Waitron certificate?", and the
separate re-image section went with them: a re-image is the reason an operator holds an old
certificate, not a separate procedure. Added: the Waitron logo, and a warning that a browser may ask
for the download to be confirmed with "Keep" before the file reaches the disk. Every device's steps
now end by closing and reopening the browser. Deleted: the line announcing that no QR code was
available, which described an absence the reader had no way to notice. Measured on screen with every
disclosure closed: 440 words before, 260 after when a device is guessed, 209 when none is.

The wizard's connection step asks one question — is your connection to this page secure? — and tells
the operator to read their own address bar, in the browser's own words: if it says "not secure" (in
red) they install the certificate, otherwise they continue. The Chrome 153 probe row above is why:
the page cannot tell. 103 rendered words before, 40 after (owner's copy, 2026-09-13).

The sentence disclaiming that Continue proves trust is GONE, and this section is the only record of
that. The requirement it served — "a communication check, never proof of installed trust" — is now
carried by the shape of the screen: the heading is a question, the operator is handed the test to
run themselves, and nothing on the page reports a verdict. No test forbids verdict wording, and that
is deliberate: the owner's own copy contains the phrase "whether this page is secure or not", so any
forbidden-words list catches honest phrasing while missing whatever dishonest phrasing nobody
thought of. What IS guarded: the heading stays a question, the guide link stays inside the "not
secure" sentence, and "Otherwise:" stays attached to Continue.

Both pages, and the whole setup wizard's visible text, say "server" rather than "box", and "IP
address" rather than "numeric network address" (owner decision, 2026-09-13). Code identifiers,
comments and the error code `no_box_ca` are unchanged.

## The connection step's failure cases, 2026-09-13

"A failed read leaves a retry and the guide visible" above did not say what the operator is TOLD, and
one sentence covered every failure: *"We could not read the server's setup information. Check its
power and your network connection..."*. On a box that is already set up, that sends the operator to
check a machine that is working perfectly.

The distinction was always available and was being discarded. `fetch` REJECTS when nothing answers,
and resolves when the server answered, so an `ApiError` now carries the HTTP `status` and its
presence means the box is ALIVE. Three messages replace the one: 404 — "This server is already set
up. Reload to open it."; any other status — "This server reported a problem. Try again in a moment.";
no status — "We could not reach the server. Check its power and your network connection."

A failure also says whether retrying is worth anything. A server that is already set up cannot be
set up again, so the whole "Otherwise: Continue to setup" row goes rather than offering a door back
to the same failure (owner, 2026-09-13). The question and the install link STAY in that state: the
operator still needs this server's certificate trusted to use the till it is now serving. The other
two failures keep Continue, because a server that is off or briefly broken may come back.

What the 404 branch cannot tell apart, stated because nothing guards it: a wrong base URL or a proxy
could also answer 404, and the message would then name the wrong reason. The wizard is served
same-origin by the box, so neither arises on a box an operator has in front of them.

A defect found on the way, and fixed: `SetupApi` assumed every failed response carried the
`{ error: { code } }` envelope and called `res.json()` on it. A provisioned box answers
`404 Not Found` as `text/plain` — run against a dev box — so the parse threw a `SyntaxError` that
escaped as though the network had failed. That affected every wizard call, not only this one: a proxy
error page during provisioning read as "network down". The parse is now defensive.

## The guide restructured, 2026-09-13 (owner)

Four numbered steps replace the earlier three, and removing an old certificate is now step ONE
rather than a disclosure inside the install step. The reason it has to come first: installing a new
certificate while the old one is still trusted does nothing the operator can SEE — the browser keeps
using the entry it already has and the page still warns, so an operator who skipped removal has no
way to tell that is what happened. The steps are: remove any old Waitron certificate; get the
certificate; install it on this device; open Waitron. Every device's install steps now end "then
reopen this page", because the page the operator is reading is also the page that tells them whether
it worked.

The heading marks the word *securely*, and the opening line names what the certificate is FOR —
entering passwords and sensitive information — rather than describing the mechanism. Step 4 shows
the browser's own warning words, ``"not secure"``, in the browser's own red, and sends the operator
back to step 1 rather than into setup. "Do not ask operators to remove an ambiguous entry" survives
as the second sentence of step 1.

Three things were DELETED. Two are only recorded here, because nothing else now says they existed:

- *"This is the connection certificate, not your business's tax-agency certificate."* Nothing on this
  page offers a tax-agency certificate, so the distinction answered a question the page had not
  raised.
- The **"If you cannot open this page or download the file"** box. This retires the Operator flow
  claim above that "the guide explains using HTTP where the browser permits it, or transferring the
  certificate from another device that can reach the box" — the guide no longer says either.
  **Worth knowing before anyone relies on that paragraph again:** the box also carried the only
  written route for a browser whose policy forbids the HTTP version, and the only advice to check the
  device's clock. What remains for the other-device case is the QR section. Deleted on the owner's
  instruction, 2026-09-13; the deletion is cheap to reverse and this is the note that says what to
  put back.
- The QR caption *"This QR opens the server address."*, which explained a QR code to someone already
  holding a phone up to it. Its heading now says the same thing: "Open this page on another device".

Also retired by this change, and fixed in the same commit: `deploy/README.md` claimed the guide
covers "replacing the old certificate after a re-image". The guide no longer names re-imaging; it
tells the operator to remove any old certificate first, whatever put it there.
