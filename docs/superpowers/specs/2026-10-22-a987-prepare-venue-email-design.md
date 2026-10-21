# A987: a venue preparing to go live sends real email

Status: draft for owner review

Written 2026-10-22 by an unattended campaign run. Docs only; nothing is built. Claims about the code
cite `file:line` at commit `96a1129e3`; the measurements in §3 say what was run and what it printed. Four questions wait for the owner (§5). Pictures:
[mockups/a987/](../../backlog/mockups/a987/).

**What the owner asked** (2026-10-03, recorded in `docs/backlog/box.md`): "Later prepare should use a
real SMTP server". A venue in the Prepare stage would send invitations and password resets through a
real mail server instead of keeping them on the box, and the top bar's inbox link (A227) would become
demo-only again.

---

## 1. Words used here

- **A stage** is what the setup wizard chose for this server: **Demo** (sample content, nothing filed),
  **Prepare** (the venue's real menus and staff, practice payments, nothing filed) or **Live**. The
  code calls it the onboarding intent, `"demo" | "prepare" | "live"`
  (`apps/server/src/trading-config.ts:8`); it is absent on a mirror or a restored server
  (`trading-config.ts:24-25`). The dashboard labels Prepare "Preparation"
  (`apps/dashboard/src/i18n/strings.ts:770`).
- **SMTP** is the standard way one computer hands an email to a mail server. **The mail server**
  here is the venue's own provider's server (Gmail, Outlook, a hosting company's), which then
  delivers the message.
- **Encryption** is how the connection to the mail server is protected. **STARTTLS** opens a plain
  connection and then upgrades it to an encrypted one, usually on port 587. **TLS** (also called
  implicit TLS) is encrypted from the first byte, usually on port 465 (§12, P1 to P4).
- **A certificate** is what proves the mail server is who it says it is. The box checks it against
  the certificate authorities it trusts; a **self-signed** certificate is one the server made for
  itself, which nobody vouches for.
- **The captured inbox** is Mailpit, a small mail catcher that runs beside the app on every box
  (`deploy/compose.yml:78-92`). Mail handed to it goes nowhere; a manager reads it on the dashboard.
- **The vault** is the table where the box keeps secrets such as card-provider keys, sealed
  (encrypted) under a key kept in a file outside the database (§2.5).
- **Practice mode** is the code's name for Demo or Prepare (`apps/server/src/boot.ts:1618`).

## 2. What is there now

### 2.1 Every place the server sends email

Found by `grep -rln -E 'nodemailer|createTransport|smtp' apps packages --include='*.ts'` and then
`grep -rn -E 'sendMail|createTransport' apps packages` (non-test files). Only `apps/server` depends on
`nodemailer` (`apps/server/package.json:84`, version 10.1.1 installed). There are five senders; the
account sender carries three kinds of message:

| What | File | How it is sent | When it fails |
| --- | --- | --- | --- |
| Staff invitation, resend, reset-login and reactivate invitations | `account-email.ts:75-150` | Inside the request, which waits for it (`management-api.ts:1114`, `:1138`, `:1225`, `:1249`) | The person is still created; the answer says `invitationSent: false` and the Users screen says "The account was created, but the invitation could not be sent…" (`strings.ts:1161-1162`). No retry. |
| Forgotten-password link | same sender | After the request has answered 202, whether or not the address exists (`management-api.ts:905-930`) | Logged only; the person sees nothing, by design. |
| New-email confirmation code | same sender | Inside the request (`me-api.ts:155-171`) | `emailVerificationSent: false`. |
| Full invoice as a PDF | `invoice-email.ts:31-80` | An outbox table, `invoice_deliveries`, drained by a loop on the primary (`boot.ts:1779-1789`) | A refusal (an SMTP 4xx or 5xx answer) is retried up to five attempts, after 5 s, 30 s, 2 min and 10 min (`invoice-delivery.ts:385-400`); a timeout or a dropped connection is marked "unknown" and is not retried, because the message may have gone (`invoice-email.ts:58-70`). |
| Missing clock-time reminders | `attendance-email.ts` | A loop (`boot.ts:1728-1742`) | Skipped while no delivery exists (`attendance-email-worker.ts:65`). |
| Signing-certificate expiry reminders | `certificate-reminder-email.ts` | A loop (`boot.ts:1749-1767`), to everyone holding `system.manage` (`certificate-reminder-worker.ts:76-77`) | Skipped while no delivery exists (`certificate-reminder-worker.ts:55`). Never runs in Demo or Prepare (`onboarding-policy.ts:12-16`, `:22-29`). |
| The settings test message | `smtp-test-message.ts` | Inside the request, with a 30 s deadline (`:25`) | Reports one of two codes (§2.6). |

No other email exists: there are no sign-in codes by email (an account action's purpose is only
`"invitation" | "password_reset" | "email_change"`, `packages/identity/src/account-action.ts:23`),
and no alert is emailed (`apps/server/src/alert-sources.ts` mentions email once, at `:594`, to read
invoice deliveries).

**No sale waits on a mail server.** No till route reaches a sender: the grep for every sender function
and for `nodemailer` lists no `till-api` file. A sale that asks for an emailed invoice reads only
whether the mail credential exists, from the local database (`invoiceEmailAvailable`,
`boot.ts:1651-1652`; checked at `invoice-choice-delivery.ts:55-57`), and the sending happens later in
the outbox loop.

### 2.2 Where each stage's email goes today

Account email, missing clock-time reminders and certificate reminders all use `resolveEmailDelivery`
with practice mode switched on for Demo, Prepare and a development server (`boot.ts:1739`, `:1763`,
`:1850-1851`). Invoice email uses `resolveInvoiceEmailDelivery` (`email-delivery.ts:37-46`).

| | Demo | Prepare | Live |
| --- | --- | --- | --- |
| Invitations, resets, email-change codes, clock-time reminders | the mail server if one is set, else the captured inbox (`email-delivery.ts:21-34`) | the same | the mail server if one is set, else **not sent** (`email-delivery.ts:34`) |
| Invoice email | always the captured inbox (`email-delivery.ts:42-44`) | the mail server if one is set, else the captured inbox (`:45`) | the mail server if one is set; else the till does not offer Email |
| Certificate reminders | never run | never run | the mail server if one is set, else skipped |

A development server (`WAITRON_ENV=dev`) captures invoice email always and everything else unless a
mail server is set (`email-delivery.ts:42`, `boot.ts:1850-1851`). The captured inbox's address is
`smtp://127.0.0.1:1025`, from `Waitron <no-reply@waitron.test>` (`email-delivery.ts:10-13`).

### 2.3 Where the mail server settings live, and who can set them

The settings are one sealed vault row, purpose `email.smtp`, holding a connection address (`url`,
which carries the user and password) and a sender address (`from`)
(`packages/credentials/src/purposes.ts:11-13`). The form's fields become that address in
`parseEmailSettings` (`packages/provisioning/src/email-settings.ts:5-52`): encryption is `starttls` or
`tls` and nothing else (`:24-26`); STARTTLS adds `requireTLS=true`, so a server that cannot encrypt
is refused rather than used in the clear (`:43`); a user needs a password and the reverse (`:39-40`).

Three ways to set it:

1. **The setup wizard's Email step**, shown only on the Live path of a server that is not a
   development one (`apps/setup/src/setup-app.ts:2336`). Continue stays disabled until the mail
   server has accepted a test message to the admin's address (`apps/setup/src/screens/email-screen.ts:129-137`).
   The server refuses settings sent with a Demo or Prepare setup (`apps/server/src/setup-api.ts:833`)
   and refuses a production Live setup without them, `setup.email_required`
   (`setup-api.ts:830-832`; the same in `first-fiscal-activation.ts:124-125` and
   `packages/provisioning/src/first-setup-settings.ts:41`). It checks the settings' shape only; the
   accepted test is the wizard's own rule.
2. **The dashboard's Account email page**, `/manage/email`, for anyone holding `system.manage`
   (`email-settings-api.ts:35-40`), which managers and admins hold
   (`packages/identity/src/permissions.ts:56-62`). Saving is refused in Demo and Prepare,
   `email.settings_not_allowed` (`email-settings-api.ts:41-42`, `:75`), whose message reads "You
   cannot change mail settings in Demo or Prepare mode." (`apps/dashboard/src/i18n/codes.ts:474-477`).
   The page never returns the password, only whether there is one (`email-settings-api.ts:56-66`).
   Save does not require a test.
3. **The terminal**: `waitron-credentials set --purpose email.smtp` (`apps/server/README.md:331-336`,
   `:441`). A box's operator has no terminal, so this is not a way a venue can use.

**A Live venue's Email page has no menu entry.** A227 (`be4edb062`, owner decision 2026-10-03) removed
the sidebar's inbox entry everywhere; the page's access rule moved to a list of screens with no entry
(`apps/dashboard/src/dashboard-app.ts:301`). The only link to it is the demo bar's "Email inbox",
which shows only in Demo and Prepare (`dashboard-app.ts:1707-1714`). So in Live, the page that sets
the mail server is reached only by typing its address.

### 2.4 The captured inbox and its link

Mailpit runs on every box, production included, because the box is installed before a stage is chosen
(`deploy/compose.yml:78-92`); it refuses messages over 1 MB (`MP_MAX_MESSAGE_SIZE: 1`, `:87`). The
server reads it at `http://127.0.0.1:8025` (`boot.ts:1938-1946`). The inbox lists messages only while
account email is being captured, and needs `person.manage` (`email-inbox-api.ts:29-43`); the page
then shows "Messages are captured on this box…" (`apps/dashboard/src/screens/email-screen.ts:179-181`).
The top bar's "Email inbox" link (A227) shows in Demo and Prepare whatever the delivery is, and
before sign-in too (`dashboard-app.ts:1707-1714`).

### 2.5 How the mail password is kept

The same way as the card providers' keys, the backup bucket's keys and the AEAT certificate: one row
per purpose in `tenant_credentials`, AES-256-GCM over the whole JSON payload, bound to the purpose
(`packages/credentials/src/cipher.ts:3`, `:27-40`; `schema/tenant-credentials.ts`). The key is
`WAITRON_CREDENTIALS_KEY` in `<state>/secrets.env`, a 0600 file outside the database
(`packages/credentials/src/keyring.ts:4-8`, `apps/server/src/box-secrets.ts:171-178`). So the copy of
`venue.db` a primary streams to the venue's bucket holds the ciphertext only. The key file travels in
backup archives and in the sealed node state, both encrypted under the venue's recovery key
(`apps/server/src/state-secrets.ts:10-23`, `sealed-state.ts:24-30`); other paths that copy the
state folder were not traced here. The table is classified
`local`: a row opens only on the node that sealed it (`packages/credentials/src/classification.ts:3-14`).
A login is stored as a hash (CLAUDE.md §3); a mail password cannot be, because the box must hand it
to the mail server, and sealing it is the house's answer for every such outbound secret.

### 2.6 What the test reports, and what a failure logs

The test has two failure codes: `email.test_timeout` when the 30 s deadline passes, and
`email.test_refused` for every other failure (`smtp-test-message.ts:4-5`, `:34-37`). §3 shows that a
wrong host, a closed port, a wrong encryption choice, an untrusted certificate, a wrong password and a
missing login all arrive as "refused". The dashboard says "The mail server refused the test
message. Check the settings and try again." (`codes.ts:462-465`) and marks no field.

A failed account email is logged as `account_email.send_failed` with the purpose and the person, and
deliberately without the mailer's error, "SMTP connection URLs can contain credentials, and provider
errors sometimes echo them" (`management-api.ts:191-197`). The test rig already plays a provider that
echoes a password (`apps/server/src/testing/smtp-settings-fixture.ts:52`). **The new-email path does
log the error's message** (`me-api.ts:165-168`, since `a10e1cd28`, 2026-09-10, before this branch).

The account-email sender opens its connection with nodemailer's defaults and no deadline of its own
(`account-email.ts:77`). Measured in §3: an invitation waited 30 s on a server that never greets, and
75 s on an address that never answers.

### 2.7 Moving from Prepare to Live today

Live is never a promoted Prepare server (CLAUDE.md §5, "One database per environment"). The path is:
export the configuration on the Backups page (`strings.ts:1654`), set up a fresh Live server, choose
"Import a configuration" (`apps/setup/src/i18n/strings/restore.ts:127-144`), then the fiscal test,
the Email step and the review. The export carries no secrets: the credentials module declares
`configurationTransfer: { kind: "none" }` (`packages/composition/src/modules.ts:266-277`). So a mail
server set while preparing does not reach Live today, and a production Live setup asks for one again.
Once running, Live does not refuse to trade without a mail server (a restored Live server may have
none): invoice Email is not offered, and invitations report "not sent" (`email-delivery.ts:34`,
`boot.ts:1651-1652`).

---

## 3. What was measured

All on 2026-10-22, macOS, Node v26.11.1, nodemailer 10.1.1, against Mailpit v1.31.6 (the image
`deploy/compose.yml:81` pins) run in Docker on spare ports. Three servers: a plain one (no
encryption, no login), one requiring STARTTLS and a login, and one requiring TLS from the first byte
and a login; the last two used a self-signed certificate for `localhost` and `127.0.0.1` and a
password file with one user. A fourth plain server refused every recipient
(`--smtp-allowed-recipients '^nobody@'`), and a Node socket on port 2599 accepted connections and
never spoke. The probes imported the repo's own `parseEmailSettings`, `sendSmtpTestMessage`,
`createAccountEmailSender` and `redactSecrets` through `tsx`. The scripts are kept outside the
repository (`~/waitron-campaign-b/a987-experiments/`).

**What a failing probe would have printed**: for M1, an `accepted: true` against a wrong setting, or
one raw code shared by two classes; for M2, a send that failed within seconds, which would mean a
deadline already exists; for M3, the password or user name inside an error message.

### M1: the test against each failure, today's product answer

| Case | Product answer, time | nodemailer `code` / `originalCode` / reply |
| --- | --- | --- |
| Plain server, STARTTLS chosen | refused, 10 ms | `ETLS`, reply 502 to `STARTTLS` ("Command not implemented") |
| Plain server, TLS chosen | refused, 6 ms | `ESOCKET` / `ERR_SSL_WRONG_VERSION_NUMBER` |
| STARTTLS server, self-signed certificate, nothing trusted | refused, 20 ms | `ESOCKET` / `DEPTH_ZERO_SELF_SIGNED_CERT` |
| Same, certificate trusted by the probe, right password | **accepted**, 13 ms; Mailpit stored it | accepted |
| Same, wrong password | refused, 4 ms | `EAUTH`, reply 535 |
| Same, no login given | refused, 12 ms | `EENVELOPE`, reply 530 to `MAIL FROM` |
| TLS server, TLS chosen, trusted | **accepted**, 7 ms; Mailpit stored it | accepted |
| TLS server (port 465 style), STARTTLS chosen | **timeout** after the 8 s deadline given | both sides wait for the other to speak |
| Closed port | refused, 2 ms | `ESOCKET` / `ECONNREFUSED` |
| Unknown host (`.invalid`) | refused, 30 ms | `EDNS` / `ENOTFOUND` |
| Server that never greets, 5 s deadline | timeout, 5002 ms | no error: the probe's own deadline ended it |
| Every recipient refused | refused | `EENVELOPE`, reply 550 |
| Trusted authority, wrong name on the certificate | not run through the product | `ESOCKET` / `ERR_TLS_CERT_ALTNAME_INVALID` |

The "trusted" rows passed the certificate as the `ca` option, which `sendSmtpTestMessage` accepts
(`smtp-test-message.ts:10`, `:17`) but no route passes (`grep -n 'ca:'` over the three routes that
call it printed nothing). So the product as shipped refuses this self-signed server; that is M1's
third row.

### M2: what a real send waits for

- `createAccountEmailSender` against the silent server: failed after **30 009 ms**, `ETIMEDOUT`,
  "Greeting never received".
- Against `10.255.255.1:587`, an address nothing answers: failed after **75 005 ms**,
  `ESOCKET`, "connect ETIMEDOUT". That is the socket's own error, not nodemailer's connection limit
  (which a third probe showed reports `ETIMEDOUT` with `CONNECT_TIMEOUT`), so the 75 s came from this
  Mac's network stack, before nodemailer's two-minute limit (§12, P7). The box runs Linux; its figure
  was not measured.
- Against the self-signed STARTTLS server with the right password: failed, `ESOCKET`,
  "self-signed certificate…". An invitation does not go to such a server either.

### M3: what the error messages carry

The probe checked eleven failure messages from M1's runs automatically: none contained the password
or the user name, and `redactSecrets` changed none of them. The messages in M2 and the
refused-recipient case were read by eye: none carried a password or a user name, though only one
of those runs had a password set. The refused-recipient message was "Can't send mail - all recipients were
rejected: 550 5.1.0 Requested action not taken: mailbox unavailable", without the address. This covers
Node's and Mailpit's wording only; a provider that echoes more is not ruled out, which is why §7 keeps
the rule of never logging the message.

Read, not run: the dashboard and wizard screens, every route's permission, the outbox's retry rule,
the vault's encryption and where its key travels, the configuration export's contents, the practice
line on invoice PDFs, and the Linux connection timeout.

---

## 4. Decisions this design makes

Each can be overruled; each says why it is the default.

1. **Demo always keeps its email on the box**, account email included. Today a Demo sends account
   email through a mail server if one was set by the terminal (§2.2), while its invoice email never
   leaves (`email-delivery.ts:42-44`). The owner's words for invoice email were "before that (eg in
   the demo) we can use our test mail gateway" (A231d design, decision 6); one rule for every
   Demo email is simpler to explain and to test.
2. **Who may set the mail server: `system.manage`**, as in Live today (`email-settings-api.ts:35-40`),
   so managers and admins. Reading the captured inbox stays `person.manage`.
3. **No "none" encryption.** STARTTLS or TLS only, as today (`email-settings.ts:24-26`). Without
   encryption the password crosses the network readable by anyone on the path, and the standards body
   has asked for cleartext submission to be retired (§12, P1).
   STARTTLS keeps `requireTLS`, so a server that cannot encrypt is refused (M1, first row) rather than
   used in the clear.
4. **Certificate checks stay on.** Measured: the product's test refuses a self-signed certificate, and
   nodemailer refuses a certificate naming another server even when its authority is trusted (M1,
   last row). A venue with its own office mail server is owner decision O3.
5. **The sender's name is the venue's name.** Recipients see "Bar Pepe &lt;reservas@barpepe.es&gt;",
   built at send time from the location's name, so no new field and no migration. Today they see the
   bare address (`account-email.ts:143-149` sends `from` as stored). This also changes Live.
6. **The test says what went wrong, by reading nodemailer's error codes, never its message text**
   (§6.5). Each class in M1 gets its own code, under the field it concerns.
7. **An invitation waits at most 30 s**, the deadline the test and the invoice sender already use
   (`smtp-test-message.ts:25`, `invoice-email.ts:43-49`). The sender owns its socket as those two do.
   Without it, M2 measured 30 s and 75 s, and nodemailer's own limits run to two and ten minutes.
8. **No outbox for account email.** The person pressing Invite is told at once, in words, what
   happened, and the Users screen already offers Send new invitation
   (`strings.ts:1905`, route at `management-api.ts:1119-1139`). An automatic retry would send a second link the manager did not
   ask for. Invoice email keeps its outbox (§2.1).
9. **A captured invitation says so.** In Prepare without a mail server the Users screen says the
   invitation is waiting in the server's Email inbox, not that it was sent.
10. **The inbox link shows whenever email is being kept on the box, and only then.** After sign-in it
    follows the delivery the server reports for the session (a new `emailCaptured` on
    `GET /management-api/session/me`, beside `onboardingIntent` at `me-api.ts:330`). Before sign-in it
    shows in Demo only. The public languages read (`me-api.ts:290-302`) is not given the flag, so an
    unsigned visitor on the LAN does not learn whether the venue has a mail server.
11. **The page is called "Email"**, not "Account email" (`strings.ts:988`), because it also governs
    invoice email; its card is "Mail server", not "Invoice email" (`strings.ts:999`).
12. **The port's placeholder follows the encryption choice**: 587 for STARTTLS, 465 for TLS. The
    port stays required. Of the wrong settings M1 tried, only STARTTLS against a port-465-style server
    showed up as a timeout rather than a refusal, so the timeout sentence names the port and the
    encryption.
13. **Save does not require a test**, as on Live today. A manager may need to save when their own
    mailbox is the thing that is broken. The wizard keeps requiring an accepted test.
14. **Live is unchanged** apart from decisions 5 to 7 and 11 to 12 and its new menu entry (O4): its
    setup still requires a mail server in production, and it never captures.

---

## 5. Owner decisions

Each lists the recommended answer first.

### O1. Does a Prepare venue need a mail server before it starts?

- **(A) Recommended: the Prepare setup offers the Email step, with "Set up later".** Until a server is
  set, email stays on the box and the Email inbox link shows; once one is set, email reaches real
  people and the link disappears. Picture 04.
- (B) Required, as for Live: Prepare cannot finish setup without an accepted test. The inbox link is
  Demo-only from the start.
- (C) Optional, but nothing is kept on the box: until a server is set, invitations say "not sent",
  as in Live. The inbox link is Demo-only from the start.

*Worked example.* Ana sets up Bar Pepe in Prepare on Monday morning and has no mail password to hand.
She invites Jordi, the chef. Under (A) she presses "Set up later"; Jordi's invitation waits in the
server's Email inbox, and Ana opens it and sends him the link on WhatsApp. On Tuesday she sets up the
mail server, and from then on invitations reach people directly. Under (B) Ana cannot finish setup on
Monday. Under (C) she finishes, but nobody can join until she sets up the mail server.

### O2. Does the mail server carry from Prepare into Live?

- **(A) Recommended: no.** The Live wizard asks for it again, as today. The password has to be typed
  and tested again anyway, going live happens once, and the configuration export keeps carrying no
  secrets.
- (B) The export carries everything except the password, and the Live wizard's Email step opens
  filled in. This changes what the export holds, a contract between packages, so it is a separate
  build slice with a full review.
- (C) Everything, password included, inside the passphrase-encrypted export. Not recommended: the
  export is a file that can be copied anywhere, and today it holds no secrets by design.

*Worked example.* On 1 December Ana exports Bar Pepe's configuration, resets the server and sets up
Live. Under (A) the Email step is empty and she types smtp.barpepe.es, 587, STARTTLS, her user,
password and sender, then sends the test. Under (B) she types only the password, then the test.

### O3. A mail server whose certificate the box does not trust

- **(A) Recommended: not in this build.** The test says "This mail server's certificate is not
  trusted" under the server field, and the venue uses a provider with an ordinary certificate. A
  backlog entry keeps the case.
- (B) The form lets a manager paste the mail server's own certificate, and the box trusts it for that
  server only. That adds a field to the vault's `email.smtp` purpose; changing a provisioned purpose's
  fields needs care with key rotation (`purposes.ts:24-25`).
- (C) A "Don't check the certificate" switch. Not recommended: anyone between the box and the server
  could pose as it and read the password.

*Worked example.* Bar Pepe's owner's cousin runs a mail server in his office with a certificate he
made himself. Ana enters it and presses Send a test. Under (A) she sees "certificate not trusted" and
switches to the venue's Gmail account. Under (B) she pastes the cousin's certificate and the test
passes.

### O4. Where a manager finds the Email page

A227 removed the sidebar's inbox entry everywhere (owner, 2026-10-03), which also left Live with no way
to reach the mail settings except by typing `/manage/email` (§2.3).

- **(A) Recommended: an "Email" entry under Settings, for managers and admins, in Prepare and Live**,
  opening the settings card and, while email is kept on the box, the inbox. Demo has nothing to set and
  keeps only its top-bar link. Pictures 01 to 03.
- (B) A tab on Venue settings instead of a sidebar entry.
- (C) Leave it: the top-bar link in Prepare, and the address in Live.

*Worked example.* In January Bar Pepe's mail provider makes Ana change her password, and invitations
start failing. Under (A) she opens Settings, then Email, then Change mail server. Under (C) she has to
be told the address.

---

## 6. The design

### 6.1 The rules after the change

| | Demo | Prepare, no mail server | Prepare, mail server set | Live |
| --- | --- | --- | --- | --- |
| Account email, clock-time reminders | kept on the box | kept on the box (O1 A) | sent | sent; not sent without a server |
| Invoice email | kept on the box | kept on the box | sent, with the practice line | sent |
| Can set a mail server | no | yes, wizard (skippable) and dashboard | yes | yes, wizard (required in production) and dashboard |
| Inbox link in the top bar | yes | yes | no | no bar |

A development server keeps today's rules (§2.2).

### 6.2 The setup wizard, Prepare path

Picture 04 ([light](../../backlog/mockups/a987/04-setup-prepare-email-light-1280.png),
[dark](../../backlog/mockups/a987/04-setup-prepare-email-dark-1280.png),
[phone](../../backlog/mockups/a987/04-setup-prepare-email-light-390.png)).

The Prepare path shows the same Email step as Live, after the venue details and before the review,
with one more button, **Set up later**, and a note: "You can do this later from the dashboard. Until
then, emails stay on this server and nobody receives them." Continue still needs an accepted test.
Set up later goes to the review with no settings. The server accepts settings with a Prepare setup
(today it refuses them, `setup-api.ts:833`) and seals them in the same step as Live
(`setup-api.ts:884-889`). Demo still refuses them.

### 6.3 The dashboard's Email page

Pictures: before a server, [01](../../backlog/mockups/a987/01-prepare-no-server-light-1280.png)
([dark](../../backlog/mockups/a987/01-prepare-no-server-dark-1280.png),
[phone](../../backlog/mockups/a987/01-prepare-no-server-light-390.png),
[phone dark](../../backlog/mockups/a987/01-prepare-no-server-dark-390.png)); the form after a refused
login, [02](../../backlog/mockups/a987/02-form-login-refused-light-1280.png)
([dark](../../backlog/mockups/a987/02-form-login-refused-dark-1280.png),
[phone](../../backlog/mockups/a987/02-form-login-refused-light-390.png),
[phone dark](../../backlog/mockups/a987/02-form-login-refused-dark-390.png)); after a server is set,
[03](../../backlog/mockups/a987/03-prepare-server-set-light-1280.png)
([dark](../../backlog/mockups/a987/03-prepare-server-set-dark-1280.png),
[phone](../../backlog/mockups/a987/03-prepare-server-set-light-390.png),
[phone dark](../../backlog/mockups/a987/03-prepare-server-set-dark-390.png)).

- **Before a server (Prepare).** The Mail server card says nobody receives Waitron's emails yet and
  they stay on this server; its action is Set up mail server. Below it, "Kept on this server" lists
  the captured messages, as the inbox does today.
- **The form** keeps today's fields and behaviour (`apps/dashboard/src/widgets/email-settings-form.ts`):
  mail server, port, encryption, Use authentication with user and password, sender address. It adds a
  read-only line, "People see it from Bar Pepe &lt;reservas@barpepe.es&gt;" (decision 5). It follows
  design-system.md → Forms: required fields marked; nothing said until the first press; a test result
  that names a field goes under that field, with "Correct the highlighted fields to continue." at the
  bottom above the buttons; a result that names no field is the bottom message; Save is quiet and
  disabled until the draft changes; hints are placeholders. A test result never disables an action.
- **After a server is set.** The card names the server, port, encryption and the From line, says the
  emails now reach real people, and in Prepare notes that invoices emailed while preparing carry the
  practice line, as printed ones do (the PDF is drawn by `buildReceiptDocument`,
  `apps/server/src/invoice-page.ts:113`, which prints the practice line when the server is in practice
  mode, `receipt-document.ts:172-175`, `:435-438`, `invoice-document.ts:130`; read, not run). The
  top bar loses Email inbox.
- **Demo.** The card says a demo keeps every email on this server and offers no change.

### 6.4 The settings and their checks

| Field | Required | Check | Today |
| --- | --- | --- | --- |
| Mail server | yes | a host name or address, no spaces, `/`, `@`, `?` or `#` | `email-settings.ts:9-15` |
| Port | yes | a whole number from 1 to 65535; placeholder 587 or 465 by encryption | `:16-23` |
| Encryption | yes | STARTTLS or TLS | `:24-26` |
| Use authentication | | when on, user and password are both required | `email-settings-form.ts:163-164` |
| User, password | together | one without the other is refused | `email-settings.ts:39-40` |
| Sender address | yes | a valid email address | `:44-50` |

Changing an authenticated server asks for the user and password again, as today (`strings.ts:1020-1021`).

### 6.5 Send a test: what it reports

The test sends one short message to the signed-in manager's own address (dashboard,
`email-settings-api.ts:84-97`) or the admin's (wizard). "Accepted" means the mail server took the
message; whether it arrived is for the person to check, and the screen says so.

The result is chosen from nodemailer's `code`, `originalCode` and SMTP reply number only. The new
codes follow the existing `email.test_*` names (`codes.ts:462-469`).

| Result | Chosen when (measured in M1 unless marked) | Shown | Sentence |
| --- | --- | --- | --- |
| accepted | the message was accepted | bottom, as success | "The mail server accepted the test message. Check your inbox." (today's) |
| `email.test_host_not_found` | `EDNS` / `ENOTFOUND` | under Mail server | "No mail server has this name. Check the spelling." |
| `email.test_connection_refused` | `ECONNREFUSED` | under Port | "Nothing at this mail server accepts connections on this port." |
| `email.test_encryption_mismatch` | `ETLS` after a 502 to STARTTLS; `ERR_SSL_WRONG_VERSION_NUMBER` | under Encryption | "This port uses the other kind of encryption." |
| `email.test_certificate_untrusted` | `DEPTH_ZERO_SELF_SIGNED_CERT`, `ERR_TLS_CERT_ALTNAME_INVALID`; others in the same family (an expired certificate, an unknown authority) are read, not measured | under Mail server | "This mail server's certificate is not trusted, so Waitron will not send it your password." |
| `email.test_login_refused` | `EAUTH` (reply 535) | under Password | "The mail server refused this user and password." |
| `email.test_login_required` | reply 530 | bottom | "This mail server needs a user and password. Turn on Use authentication." |
| `email.test_timeout` | the 30 s deadline | bottom | "The mail server did not answer in time. Check the port and the encryption." |
| `email.test_refused` | anything else (a refused sender or recipient, reply 550) | bottom | today's sentence |

The classifier is one function shared by the test, the account sender and the invoice and reminder
senders' logs, with a case per row above.

### 6.6 Failure while sending

- **Invitations, resends and email-change codes** wait at most 30 s (decision 7). The answer keeps
  `invitationSent` and adds what happened: `delivery: "sent" | "captured"` when it went, or
  `problem` with `email.unconfigured`, `email.send_refused` or `email.send_timeout` when it did not.
  The Users screen says, for example, "Jordi's account was created, but the mail server refused the
  invitation. Check Email settings, then use Send new invitation." A timeout says the invitation "may
  not have been sent", because the server may have taken it.
- **Forgotten-password requests** keep answering 202 at once, whatever happens (they must not reveal
  whether an address has an account). The log line gains the same short reason.
- **Invoice email** keeps its outbox and retry rule (§2.1). **Reminders** keep theirs.
- **No sale path changes.** A sale reads only whether a mail server is set (§2.1).

### 6.7 Moving from Prepare to Live

Under O2 (A), nothing changes: the export carries no mail settings, the Live wizard's Email step asks
for them, and a production Live setup refuses to finish without them (§2.3). Once trading, Live runs
without a mail server if it has to, as today. Under O2 (B), the export gains the settings minus the
password and the wizard opens them filled in.

**Waitron Cloud, later.** Cloud's own email goes through Amazon SES in an EU region (owner decision).
A box could one day hand its email to Cloud instead of to its own provider. Two consequences to carry
into that design: SES sends only from addresses or domains verified in Waitron's account (§12, P9), so
a venue's own address would need verifying there or the mail would come from a Waitron address; and
Cloud would then handle the venue's staff and customers' email, which makes Waitron the venue's
processor for it (A980 design §3). Not designed here.

---

## 7. Security

- **At rest.** Prepare adds no new storage: the same sealed `email.smtp` row (§2.5). A copy of the
  database in the bucket holds ciphertext; the key travels in archives and sealed state under the
  recovery key (§2.5 names what was not traced).
- **In logs.** No mailer message is ever logged, only the short reason code of §6.5, everywhere
  (`management-api.ts`, `me-api.ts`, the invoice and reminder loops). This fixes `me-api.ts:165-168`.
  M3 found no password in the messages it checked, but measured only Node's and Mailpit's wording; the rig
  already plays a provider that echoes one (`smtp-settings-fixture.ts:52`). The recovery page's mask
  hides only a password inside a URL (`redact-secrets.ts:1-28`), and the box's stdout is deliberately
  not masked (`redact-secrets.ts:26`), so the rule cannot lean on it. The connection address that holds the password is never
  logged or returned (`email-settings-api.ts:56-66`).
- **On the network.** STARTTLS or TLS only, `requireTLS` kept, certificates checked against the
  authorities Node trusts (decisions 3 and 4, M1). A self-signed office server is O3.
- **Not a relay for strangers.** The test sends only to the signed-in manager's or the admin's own
  address, never one typed into the form (`email-settings-api.ts:90-96`, `setup-email-api.ts:33-38`).
- **What a visitor learns.** `emailCaptured` is only on the signed-in session read (decision 10).
- **Real people, practice server.** Once Prepare sends, invitation and reset links reach real
  inboxes and point at the practice server (`management-api.ts:173`). Invoices emailed from Prepare
  carry the practice line (§6.3); A231d's owner decision 7(b) already allowed a Prepare venue to
  email invoices through a mail server.

## 8. Guides

No user guide covers email, staff invitations or the setup wizard today: the guide folders hold
`appearance`, `content-and-images`, `kitchen-service`, `modifiers` and `products`
(`ls apps/server/src/guide/en/` and `/es/`). The build adds `apps/server/src/guide/en/email.md` and
its Spanish twin `apps/server/src/guide/es/email.md`, with shared section ids: setting up the mail
server `{#set-up}`, what each test result means `{#test-results}`, email kept on the server while
preparing `{#kept-on-server}`, and going live `{#going-live}`. The dashboard links to it through
`apps/dashboard/src/help-guide.ts`. Any help tooltip added outside the wizard carries
`mode="help-mode"` (CLAUDE.md §3).

## 9. Build slices

No slice adds a migration: the settings stay in the existing `tenant_credentials` row for
`email.smtp` (`purposes.ts:13`), and the sender's name is read from the location at send time.

1. **Stage rules on the server.** Prepare may save and test settings on the dashboard
   (`email-settings-api.ts:41-42`); a Prepare setup may carry settings (`setup-api.ts:833`); Demo
   keeps all email on the box (`email-delivery.ts`); `emailCaptured` on the session read; the
   invitation answer's `delivery`. **Full review**: a secret written in a new stage, a permission
   gate, and the setup request contract. Tests: the settings routes in Demo (refused,
   `email.settings_not_allowed`), Prepare and Live (saved, and read back sealed); Demo with a stored
   credential still captures; a Prepare setup with and without settings, and Demo with them refused;
   `emailCaptured` true and false; an invitation in Prepare without a server answers `captured`.
2. **Test results, invitation deadline, safe logs.** The shared classifier, the 30 s deadline on the
   account sender, the reason codes on every log line, the `me-api.ts` fix. **Full review**: secrets in
   logs and codes shared by the server, the dashboard and the wizard. Tests: one case per row of §6.5
   against the in-process rig (`smtp-settings-fixture.ts`, which needs replies 502, 530 and 535 added
   beside its self-signed TLS mode); an invitation against the rig's silent mode fails within the
   deadline; a provider reply carrying the password reaches no log line (with a control that logs the
   message and fails).
3. **The dashboard's Email page.** The Prepare form, the per-stage texts, the From line, the
   rename, the inbox link from `emailCaptured`, the Users screen's messages, the Settings entry (O4),
   EN and ES strings. **Full review**, because it changes a screen's access rule. Tests: the page in
   each stage, the link both ways, the form's existing unsaved-changes suite, axe tests for the new
   states in both themes, and the menu entry for supervisor (absent), manager and admin.
4. **The setup wizard's Prepare step.** Set up later, the port placeholder, the results placed by
   field. **Light review** (screen only; the server side is slice 1). Tests: Prepare shows the step;
   Set up later reaches the review with no settings sent; an accepted test continues with them; axe.
5. **Guides.** `email.md` in English and Spanish and the dashboard link. **Light review.** Tests: the
   guide guards (`apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`).

O2 (B) adds a sixth slice (the export carries the settings, full review); O3 (B) a seventh (a
trusted certificate per mail server, full review).

## 10. Questions for the tax or legal adviser

None new. Emailing a practice invoice from Prepare was allowed by the owner in A231d (decision 7(b)),
the PDF carries the practice line, and the preparation environment as a whole is already Q24 in
`docs/compliance/asesor-questions.md`. The venue's mail provider handling staff and customer email is
a processor relationship the A980 design already lists (its §2.4, "Email").

## 11. Found while reading

- `me-api.ts:165-168` logs the mailer's error message, against the reason given at
  `management-api.ts:193-194`. Predates this branch (`a10e1cd28`). Slice 2 fixes it.
- A Live venue's Email page has no menu entry (§2.3). O4.
- An invitation has no deadline of its own (M2). Slice 2.
- Invitation and reset links use the dashboard's address, `https://waitron.local` by default
  (`deploy/compose.yml:32-33`). Whether a person reading the email away from the venue's network can
  open it was not checked; it matters more once Prepare reaches real inboxes.

## 12. Provenance

| ID | Claim | Source | The source's words |
| --- | --- | --- | --- |
| P1 | Implicit TLS is preferred to STARTTLS for submission, and cleartext is to be retired | RFC 8314, §1 (fetched from rfc-editor.org 2026-10-22) | "Connections to Mail Submission Servers and Mail Access Servers be made using "Implicit TLS" (as defined below), in preference to connecting to the "cleartext" port and negotiating TLS using the STARTTLS command"; and MUAs and providers "(a) discourage the use of cleartext protocols for mail access and mail submission and (b) deprecate the use of cleartext protocols for these purposes as soon as practicable." |
| P2 | Port 465 starts with TLS, and the client must check the certificate | RFC 8314, §3.3 | "When a TCP connection is established for the "submissions" service (default port 465), a TLS handshake begins immediately. Clients MUST implement the certificate validation mechanism described in [RFC7817]." |
| P3 | Port 587 is the submission port | RFC 6409, §3.1 | "Port 587 is reserved for email message submission as specified in this document." |
| P4 | STARTTLS is an extension a server advertises | RFC 3207, §3 | "The STARTTLS keyword is used to tell the SMTP client that the SMTP server is currently able to negotiate the use of TLS." |
| P5 | Replies 535 and 530 | RFC 4954, §6 | "535 5.7.8 Authentication credentials invalid … the authentication failed due to invalid or insufficient authentication credentials"; "530 5.7.0 Authentication required … SHOULD be returned by any command other than AUTH, EHLO, HELO, NOOP, RSET, or QUIT when server policy requires authentication" |
| P6 | Reply 502 | RFC 5321, §4.2.2 | "502 Command not implemented" |
| P7 | nodemailer's default waits | nodemailer 10.1.1, `dist/cjs/smtp-connection/index.js:50-52` (installed copy) | "CONNECTION_TIMEOUT = 2 * 60 * 1000; // how much to wait for the connection to be established"; "SOCKET_TIMEOUT = 10 * 60 * 1000"; "GREETING_TIMEOUT = 30 * 1000; // how much to wait after connection is established but SMTP greeting is not receieved" |
| P8 | What the Mailpit flags in §3 do | `docker run --rm axllent/mailpit:v1.31.6 --help`, run 2026-10-22 | "--smtp-require-starttls Require SMTP client use STARTTLS"; "--smtp-require-tls Require client use SSL/TLS"; "--smtp-auth-file string A password file for SMTP authentication"; "--smtp-allowed-recipients string Only allow SMTP recipients matching a regular expression" |
| P9 | SES sends only from verified identities | AWS, "Verified identities in Amazon SES" (docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html, fetched 2026-10-22) | "Before you can send an email using Amazon SES, you must create and verify each identity that you're going to use as a "From", "Source", "Sender", or "Return-Path" address." Also, from "Creating and verifying identities": "To send email from the same domain or email address in more than one AWS Region, you must create and verify a separate identity for each Region." |
