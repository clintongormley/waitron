# Set up your first Live fiscal identity

Your box needs a signed assignment of its installation name and invoice series before it can
start Live trading. Keep the signing key and the current paper register with a named custodian
on a separate computer. A restored box or an old printout cannot tell you which names another
machine has already used.

**Candidate qualification, 2026-10-15:** this procedure accompanies the A679 feature branch.
The complete joint wizard/tool exercise and actual-paper acceptance remain outstanding. Do not
regard an automated recovery check or a print preview as physical-paper acceptance. The
[approved plan](../superpowers/plans/2026-10-15-a679-first-fiscal-setup.md#task-9-joint-qualification-actual-paper-and-whole-branch-gates)
lists the remaining qualification gates.

## Keep the two computers separate

Use the local setup wizard on the box to choose Live and enter the venue and administrator.
If you imported a prepared configuration, make the same-taxpayer or different-taxpayer choice
before continuing. The claimed attempt retains that choice and the selected export. Replacing
that staged export later refuses activation; it does not silently import a different menu.

Keep the original wizard tab. Its saved claim and your administrator password let you resume
that same attempt after an interruption. A competing tab cannot take it over. Losing both the
tab's claim and its credential proof needs explicit incident handling.

Complete the certificate, separate preproduction readiness check and email steps. That test
uses a disposable identity in a separate database; it grants no production name.

At **First fiscal identity**, choose whether this scope already has a current master. A scope
covers the taxpayer, software and environment shown on screen. For Olivo's production setup,
`S000001` is available only if the current outside register says so.

Choose the proposed serials, reconfirm your password when asked and save the public setup
request. It binds the exact box, administrator, event and series. Save the downloadable custody
tool and transfer it, with that public request, to the custodian's separate computer. Disconnect
that computer from the network before opening the saved HTML tool. It needs no repository or
Cloud subscription. Use a local printer outside the box for its paper outputs.

## Create a first kit only when no master exists

1. Open **New kit**, select the public setup request and choose **Load setup request**. Check the
   taxpayer, environment, event and series against the box. If a master already exists, choose
   **Yes — use its custodian** and follow the existing-custodian route below.
2. Choose **No — create the first kit**, name the custodian and create the key. Save the public
   check request and public key. These public files are separate from the protected signing key.
3. Enter and repeat a passphrase, then choose **Save protected key**. Keep that saved file and
   access to its passphrase outside the box and venue backups.
4. Print the secret recovery sheet and one public original. Collect every page. Check the secret
   format/version, complete ordered groups, full fingerprint and page labels. Whoever holds the
   secret sheet can sign. Store it separately from the public original with access restricted to
   signing custody.
5. Record the public original's issue and print outcome. Confirm that you kept one usable
   original only after checking the actual output. If printing failed or the outcome is uncertain,
   record that outcome and reconcile all sheets before proceeding. A fresh tool session cannot
   enforce sole physical custody for you.
6. Choose **Check saved file**, select the file you actually saved and reopen it with the
   passphrase. Save its public check receipt. The original in-memory key and a download click do
   not satisfy this check.
7. Close all tool sessions. Open the saved tool in a clean **Check secret paper** session. Load
   the public check request. Transcribe the actual printed secret sheet and enter the complete
   fingerprint from the public original. **Check paper** compares that fingerprint before signing
   and verifying a fresh local challenge. Save its public check receipt, then close the session.
8. Open **Reopen / existing kit**. Load the same setup request and public check request. Select
   and reopen the saved protected file again. Use that fresh file receipt with the paper receipt,
   then choose **Verify both receipts**. Compare the full fingerprint and confirm actual-paper
   recovery, the current original and custody only after doing those checks.

Wrong paper, a wrong passphrase or fingerprint, missing groups and corrupt inputs must refuse.
Do not work around a refusal by making another kit. Check the selected inputs and original;
keep recovery material out of screenshots, logs and public evidence.

## Use an existing custodian and consume the assignment

Keep the existing custodian and current original. Do not create another master. For a kit made
by this tool, use **Reopen / existing kit**, its saved public check request and protected file,
and repeat both recovery checks. An existing custodian using another signing path must still
supply the exact public allocation and independently compared public key for this setup.

Before signing, consult the current original and other systems' history. Reserve the exact
proposed names there in ink. Record the event, source, box, administrator and a public record
reference. Confirm that this setup has no former machine and no parallel setup. That statement
does not remotely stop another machine.

Mark the assignment consumed on the original before choosing **Sign consumed assignment**.
Save the public allocation and public key for import at the box. Keep the signed block and
history with the original. A failed, abandoned or uncertain attempt never makes a consumed
entry free again. At exhaustion, stop and obtain a separately reserved block.

At the box, import those public files. Never select the protected key or secret sheet. Compare
the complete fingerprint independently with the current original. Confirm current consultation
and consumption for this exact event, enter its record reference and review the assignment.
Reconfirm ownership before activation.

If the response is lost, reconnect to read the attempt's outcome. Do not start another activation
blindly. An unfinished publication can continue only with a matching locally committed result
and fresh outside confirmation. Otherwise keep the assignment consumed and resolve the incident.

## Keep custody after setup

Continue using the same current original after restoring a key. Recovering the key does not
recover consumption history. Label later public copies as snapshots; they cannot replace the
current original.

Stop assignments during a custodian handover. Name the successor and transfer the same original,
history, protected file, passphrase access and secret sheet. The successor repeats both recovery
checks and consults current consumption. Record any outgoing secret copies that remain; the
handover does not revoke their signing ability.

Stop new signing if the original or every usable signing copy is lost, its currency is uncertain,
or custody is disputed. Preserve known consumption and attempt history for outside incident
resolution. Do not guess free names or create an automatic replacement master.

Check the local printer's queue and collect failed and spoiled secret sheets. Reconcile them
and dispose of secret waste securely. Operating-system or printer copies may remain; the tool
cannot erase them for you.

For acceptance, retain only the date, tool build, browser and printer identity, public fingerprint,
step outcomes and custodian attestation. Record file reopen, actual-paper transcription/challenge,
wrong-input refusals, complete page labels, original custody, spoiled-sheet handling, separation,
handover and loss stops. Never retain private keys, passphrases, transcriptions or secret screenshots
in the acceptance receipt.
