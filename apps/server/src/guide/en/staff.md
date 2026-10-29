# Users

Use **Users** to keep your team's details up to date. Only an admin can manage another
person's sign-in, so managing contact details cannot give someone access to that account.

## Names and contact details {#staff-details}

As a manager, open a person's row menu and choose **Edit** to change their names and telephone.
Their email is their login address, so only an admin can change it. The same restriction applies
to roles and account status.

## Account access {#account-access}

As an admin, you can add a person and send their invitation, resend an invitation, reset their
PIN or login, and disable or re-enable their account. Resetting a PIN clears it; the person
chooses its replacement. Resetting a login clears their credentials and sends a new invitation if
email is set up; for when Waitron refuses it or it changes nothing, see
[Common losses](data-protection.md#breach-losses). Disabling an account also deletes the person's
PIN, password, passkeys, two-factor settings, recovery codes and Google link. Re-enabling it sends a new invitation. Managers do not see these actions.

If Waitron cannot verify your passkey, you can retry or choose **Use your password** to sign in.
On the password screen, **I’ve forgotten my password** requests an email with a link to choose
a new password. The acknowledgement is the same for every address; it does not confirm that an
account exists or can sign in. Resetting a password does not enable a disabled account.

## Your own account {#own-account}

Open **Account settings** from the account menu to change your own sign-in details. Your own
email, password, PIN, passkeys and two-factor settings remain yours to manage.

## Download your data {#own-data}

Open **Account settings** from the account menu and, on **Your details**, press **Download**
beside **Copy of your data**. You get a ZIP file with your profile and sign-in details as `.json`
files. If the venue plans staff or records working time in Waitron, the download can also hold
your employment details, rota, absences, staff roles and attendance questions as `.json` files,
and your working-time record as a PDF and a `.csv` spreadsheet. There can be an `actions.json` too:
the whole sales already recorded whose void you authorised, the refunds you asked for, authorised
or recorded the outcome of, and the cash-drawer openings you made or authorised. There can be an
`adjustments.json` too: the voids, comps and discounts on a bill that you made giving a reason, or
approved for someone else.

A `README.txt` explains each file, who else receives the data, how long it is kept and your
rights. The download never holds a secret such as your PIN or password. For anything else about
your data, ask the venue.

## Download another person's data {#person-data}

As an admin, you can download another person's copy of their data, for example when someone who
has left asks for it. On **Users**, set **Status** to **All statuses** if the person
is disabled, open their row menu and choose **Download their data**. You get the same files the
person gets from **Copy of your data**, with its `README.txt` in the language the person chose,
or the venue's language if they have not chosen one. Managers do not see this action. Waitron
keeps no list of these requests, so note the request and your answer in the venue's own records.
For the one-month answer time and the venue's other duties, see
[Data protection](data-protection.md#who-does-what).

## Download an invoice customer's data {#invoice-customer-data}

When a customer asks what the venue holds about them, an admin can find their full invoices by
identifier and download them. On **Orders**, press **Find an invoice customer**. For a Spanish
tax number, keep **Spanish tax ID**, type the number and press **Find**. Letter case, spaces,
dots, hyphens and an ES at the start make no difference for that search. For another document,
choose its actual type and issuing country and enter the number exactly as recorded, including
spaces and letter case. The window lists the full invoices that match all three; press **Download their
data** to get a ZIP with a PDF copy of each invoice, an `invoices.json` file with the name, tax
number, document type and issuing country when present, address on each and every address the box emailed it to or tried to, and a
`README.txt` in the venue's language. Managers do not see this action. A booking holds no
tax number, so this search does not find bookings. Waitron keeps no list of these requests, so
note the request and your answer in the venue's own records. For the one-month answer time and the
venue's other duties, see [Data protection](data-protection.md#who-does-what).

## Delete a staff role {#delete-staff-role}

In the staff roles list, choose **Delete** from the role's row menu. The window shows
**Checking what changes…** while it reads the impact. Review **Work that ends** and
**Settings that are removed** when those sections appear before confirming the deletion.
