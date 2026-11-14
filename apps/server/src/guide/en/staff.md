# Users

Use **Users** to keep your team's details and access roles up to date. Access roles decide what
each person may do; job roles put them on the rota and on the devices that take that job.

## Names and contact details {#staff-details}

As a manager, open a person's row menu and choose **Edit** to change their names and telephone.
Their email is their login address. Changing someone else's address needs an extra permission, which only Admin holds by default.

## Account access {#account-access}

Keep at least one active admin who can sign in to the dashboard with a password, Google or a
passkey. A PIN alone only gives access to the till.

Managers can add a person and send their invitation, resend an invitation, reset their
PIN or login, and disable or re-enable their account. Resetting a PIN clears it; the person
chooses its replacement. Resetting a login clears their credentials and sends a new invitation if
email is set up; for when Waitron refuses it or it changes nothing, see
[Common losses](data-protection.md#breach-losses). Disabling an account also deletes the person's
PIN, password, passkeys, two-factor settings, recovery codes and Google link. Re-enabling it sends a new invitation. You can change another person's sign-in only when you
hold every permission they hold.

In **Access roles — what they may do**, choose the roles a person needs and press **Save access
roles**. You can give or remove a role only when you hold all its permissions; locked roles stay
visible. A person with **No access role** can still sign in and use their own pages. Role changes
leave invitation and password-reset links usable. Save names and contact details separately.

To configure delivery of these links, open [Email settings](email.md#set-up). If an invitation does not arrive within a few minutes, check the recipient’s junk mail and Email settings before resending: only the newest link works. If a retry says nothing changed, wait a minute before trying again.

If Waitron cannot verify your passkey, you can retry or choose **Use your password** to sign in.
On the password screen, **I’ve forgotten my password** requests an email with a link to choose
a new password. The acknowledgement is the same for every address; it does not confirm that an
account exists or can sign in. Resetting a password does not enable a disabled account.

Waitron asks you to sign in again before you invite someone, resend an invitation, reset their
login, disable or re-enable their account, or change an email, role or account status in **Users**.
This includes changing your own email in **Users**. Creating, copying, editing or deleting an
access role also needs this confirmation. Names, telephone numbers and PIN resets do not need
this confirmation. You also confirm before you change backups, download recovery files, show the
recovery key, or export configuration or another staff member's data. The same window
covers connecting or disconnecting payment providers, changing the mail server or Cloud
connection, turning on remote access, preparing a replacement box, installing a tax certificate,
changing the legal name and removing a server. Use your password or passkey, plus an
authenticator or recovery code if your account uses one. The
confirmation covers these actions in this browser for 15 minutes, or until your session ends.
Choose **Cancel** to leave the action undone. If the disk is full, open **Box status** and use
**Free** to make room before confirming. See [Free space on the box](box-status.md#free-space).

## Access roles {#access-roles}

Choose access roles for what each person needs to do, rather than for their job title. Their
permissions combine: someone with both Waiter and Accountant access roles can do what either
role allows. Job roles are separate; they put people on the rota and device sign-in screens
and grant no permissions.

Open **Access roles** under **Team** to create a role for a job such as Accountant. Choose
**Add access role**, enter a name, tick its permissions and press **Save**. Open an existing role
to change its ticks. Use **Copy role** to start from its permissions with a new name. To remove
a custom role, choose **Delete role** and check how many people will lose it before confirming.
You can change or copy only roles whose permissions you hold.

Turn on **Help** in the dashboard banner, then open a permission’s bubble to check what it
allows before ticking it. Staff, Supervisor and Manager are built-in starting points whose
permissions you can change. Admin always has everything, including permissions added later; its ticks are locked.
Built-in roles cannot be renamed or deleted.

Give people their roles in **Users**, under **Access roles — what they may do**, and save
there. Creating a role does not assign it to anyone. Keep at least one active Admin who can
sign in to the dashboard.

## Your own account {#own-account}

Open **Account settings** from the account menu to change your own sign-in details, even when
the sidebar only offers **My schedule** and **Orders**. Your own email, password, PIN, passkeys
and two-factor settings remain yours to manage.

These changes use the same 15-minute confirmation as other protected actions. If you use an
authenticator, enter its current code for each sign-in change; a recovery code cannot replace it.
You can set a password with **Add** if you normally sign in with a passkey.

You can also change your name, display name, phone and language, and link Google in **Security** where it is available.

To confirm a new email address, enter the code sent there. If email is not set up, use the email status’s settings link or **Sign in as an administrator** action; then return to your own account, re-enter the new address in **Your details** and save. If the code does not arrive within a few minutes, re-enter the new address and save: only the newest code works.

In **Security**, choose **Add passkey** beside **Passkeys**.
Follow your password manager’s prompt to add it.

If your venue has a staff address for access from outside, sign in there with your usual email
and password. To use a passkey at that address, open **Account settings** there and add one,
even if you already use a passkey at the venue's local address.

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

In the staff roles list, choose **Delete** from the role's row menu. Check how many people
hold it and which device profiles have no other visible job selected, then confirm. This removes their memberships and the role's staffing blocks.
Existing shifts keep the role's name. To assign new shifts, choose another role.

## Job roles per person {#job-roles}

To put someone on the rota and the sign-in list of devices that take their job, open their editor in **Users**, choose their **Job roles** and press
**Save job roles**. You need permission to manage the schedule. These tags save separately from
the person's details. If someone changes them while you edit, press **Reload** to see their latest
roles before choosing again.

## Who can sign in on a device {#device-profile-sign-in}

Open **Device profiles** and edit the profile used by the device. Under **Who can sign in**,
select its job roles and save. For example, select Waiter for a handheld used by your waiting staff.
Everyone holding a selected job can sign in; their permissions still decide what they can do.
Leave every job unticked to let nobody sign in. When you add a profile, it starts with every current
job selected. Copying a profile keeps its selections. When you add a job later, select it on the
profiles where its holders need to sign in.

## Hours and breaks {#hours}

Use **Start break** and **End break** for a pause during your shift. Use **Clock out** when your work ends.

When a recorded time is wrong or missing, choose **Fix my hours** from your name's menu. On a
handheld, open **More** if your name is there. The option appears when clocking is available.
Choose the **Date**, then **Fix time** beside an entry, or **Clock in**, **Clock out**, **Start
break** or **End break** to add a missing entry. You can also add a missing clock-in and clock-out
or both ends of a break together.

Enter the actual dates and times and a **Reason**, then choose **Save** to record your request.
Ask another supervisor, manager or administrator to choose **Approve with a PIN**, select their
name and enter their PIN. As an administrator, you can approve your own request. Check **My hours**
for the request's progress.
