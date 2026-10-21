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
