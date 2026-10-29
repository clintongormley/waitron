# Choose a certificate that setup can use

For a live Spanish venue, choose your `.pfx` or `.p12` certificate file and enter the passphrase
you used when exporting it. Demo and Preparation do not ask for this certificate.

## Correct a refused file {#refusals}

Setup checks the file before running the fiscal test or provisioning the venue. A wrong passphrase
is explained under **Certificate passphrase**. A file that cannot be opened, uses old RC2
encryption, has no private key, has expired or is not valid yet is explained
under **Certificate file**.

Correct the passphrase or choose a replacement file, then select **Next** and run the fiscal test
again. For a file with no private key or old encryption, export the certificate again with its
private key and modern encryption. The export instructions are on the certificate screen.

If a certificate is refused while finishing an interrupted setup, correct it first. Setup then
asks you to confirm ownership again before you continue.

## Retry a check in Venue settings {#dashboard-check}

If replacing a certificate fails with an HTTP error or an unexpected check failure, the current
certificate stays installed. Check the internet connection, or choose another file or certificate
type in the dialog. Select **Save** to check again. Select **Cancel** to stop without replacing
the current certificate; if asked about unsaved changes, choose **Discard changes** to close.
An HTTP status alone does not tell you whether waiting will help.

## Find out what a check observed {#diagnosis}

When repeating Save does not explain the failure, open **Diagnose connection** from the certificate
card in **Venue settings**, or from a refused replacement. Opening the panel sends no query.
It keeps **Observed**, **Cause** and **Available choices** separate: an HTTP status or a closed
connection alone does not establish why the request failed.

## Choose what you inspect {#diagnosis-source}

Choose **Installed certificate** to inspect the material currently stored on this box, or
**Selected replacement, not installed** for the file, passphrase and type you choose here.
Confirm the selected source, then select **Read again**. This checks the selected material locally
without a network query. It does not substitute the installed certificate for a replacement file.

The **Saved installation record** describes a past installation. Its type and installation time
are not verified current facts until the panel says that the current material matches that record.
After a successful local inspection, you can see the configured environment, destination label and
current material type. A company seal and a representative certificate can use different
destinations; changing the type here does not change the box's configured environment.

## Sign in at the action {#diagnosis-authority}

If you can read the card but cannot manage the system, use **Sign in with permission to manage the
system**, or **Stop**. Sign-in can change the dashboard account. After any account or permission
change, choose your file and enter its passphrase again, confirm the source and select **Read again**.
Sign-in does not resume a check or Save for you.

## Read the result within its limits {#diagnosis-results}

After local inspection succeeds, **Run check** sends one read-only query using that material.
It files no invoice and installs nothing. **Check again** is another explicit attempt; the panel
does not retry automatically. A completed query describes that attempt, not a promise that a later
filing will succeed. [Box status explains the waiting records](box-status.md#retry-now).

The check allows 30 seconds for opening the file, connecting and reading the reply, then up to two
seconds for cleanup. An oversized reply, a timeout, an unreadable reply and an HTTP response are
different observations. If the browser loses the answer, the result is unavailable; no remote
cause has been established. You can select **Read again** for a new local inspection or **Stop**.

If the installed certificate changed meanwhile, select **Stop and reload saved card**. This closes
diagnosis and makes an ordinary signed-in card read. Reopen diagnosis, confirm the source and
inspect again before running another check. **Read again** cannot reuse the old revision.

## Stop, copy or choose a replacement {#diagnosis-stop}

**Stop**, or Escape, cancels the attempt and closes the panel. Diagnosis leaves the installed
certificate and fiscal records unchanged. **Copy evidence** copies a limited diagnostic summary
when you choose it; it excludes the file, passphrase and certificate identity details.

Use **Replace certificate** or **Edit selected file or type** to return to the separate editor.
Only that editor's **Save** can install a replacement, after running its own checks.
This panel cannot repair the box's network configuration or a persistent external refusal.
Its evidence can help you choose your next step, but another identical check is not a repair.
