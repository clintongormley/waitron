# Email

Before relying on email, send a test using your mail provider's settings. In the dashboard,
the test goes to your own account address. During setup, it goes to the administrator address
you entered.

Before saving or removing a mail server, confirm your sign-in in the shared window.
[Your confirmation](staff.md#account-access) lasts 15 minutes or until your session ends.

## Set up a mail server {#set-up}

Outside Demo, open **System → Email**. With box administration (Admin by default), choose
**Set up mail server** or **Change mail server**, enter your provider's settings and send a test
before saving. Enter fresh login details when changing an authenticated server; Waitron never
shows the saved password.
Managers can view the settings, but cannot save or remove them.

Mail sent through your saved server and the test on this page use your venue name alongside
the sender address. If the page says the saved sender address is not valid, choose
**Change mail server** and correct **Sender address** before testing again.

During Prepare or Live setup, enter your mail server settings and send a test to the administrator
address. Setup tests only a mail server that offers a username-and-password login. If yours takes mail
without a login, use one that has a login during setup, then switch to yours in **System → Email**,
where **Use authentication** can stay off. You can skip the mail server in development or when you
[choose Cloud for staff email during test setup](email.md#cloud-staff-email). If you use your own mail server, saving it
sends invitations and password-reset links to real inboxes. This page shows invoice email status:
development boxes keep invoice email locally even when account email uses a saved server or Cloud.

In Demo, use the **Email inbox** link in the top bar. Sign in as a Manager or Admin to open captured messages.

## Email the daily sales report {#daily-report}

In **System → Email**, turn on **Email the daily report**, choose recipients and save. Each
recipient needs an account email address and access to **Sales & takings**. Set up a mail server
on the same page so Waitron can deliver the report. To get the day's figures yourself, open
**Sales & takings** and select the day. Choose a printer and select **Print category sales**, or
select **Download for accountant (XLSX)** if you can export reports.

Waitron emails the most recently ended trading day's report after the automatic close completes.
You can also receive that report after a box restart. After a closure spanning several days, open
**Sales & takings** and select an earlier day to see its figures.

## Choose staff email during test setup {#cloud-staff-email}

In Prepare on a test box, sign in to Waitron Cloud and tick **Send staff email through Waitron
Cloud** on the email step. Leave the mail server blank and continue. Once the box restarts and
connects, Cloud can send staff invitations, password-reset links and email-change codes.

If you choose Cloud and leave the mail server blank, Cloud also sends account security notices,
role change notices and the warning to a staff member's previous address when someone else
changes it in **Users**. Managers with an email address can also receive box alerts about low
space, deleted backups, backup runs that stopped, rolled-back upgrades and clock corrections.
If you add your own mail server, Waitron uses it for those messages. To email customers, send the
daily report or receive other box alerts by email, add a mail server in **System → Email**.

If setup says it could not confirm Cloud staff email, open **System → Email** to add or check
the mail server you use for staff email.

## Account email through test Cloud {#cloud-account-email}

Invitations, password-reset links and email-change codes use your saved mail server. If you
leave the server blank and enable email through test Cloud, Cloud sends those messages.
In Demo outside development, enable Cloud email to send to the recipient's real inbox. Otherwise,
open Demo's **Email inbox**.

On a box configured for test filings, managers with an email address can receive certificate
expiry reminders through test Cloud when Cloud email is on and the box has no mail server.

Cloud account links lead back to your box. Open them on a network that can reach it. Cloud's
invitation does not list your roles or include the venue's optional privacy link. If an email
does not arrive, request a fresh link or code; an earlier message may still arrive later.
If you rely on Cloud email and it becomes unavailable, restore Cloud. Outside Demo, you can
also add a mail server in **System → Email**. If your saved mail settings are unusable,
invitations, password resets and email-change codes wait for working settings. Correct the
settings and send another test.

## Check the test result {#test-results}

An accepted test means the mail server took the message. Check your inbox, including junk mail.
If it is missing, check the recipient address and your mail provider's delivery information.

If the result says the mail server name was not found, check its spelling. For a certificate
refusal, use your provider's server name and a trusted certificate. If Waitron marks **Port**,
check the port in your provider's settings.

For an encryption refusal, follow the result's suggested encryption and port, then send another
test. Changing encryption leaves the port you entered in place, so change that too when needed.

If the server refuses the username or password, check both before testing again. For a timeout
or another refusal, check the port and encryption, then retry.

If setup asks you to test email, test again after changing the settings or administrator address.
Continue becomes available after the server accepts a test of those settings for that address.

## Remove a mail server {#remove}

With box administration (Admin by default), choose **Remove mail server** and read the confirmation. **Stop** keeps the settings.
Removing the server clears its saved login details too; enter them again if you set it up later.

Outside development, removing the server stops receipt email. If you have enabled test Cloud
email, Cloud can send [account email](email.md#cloud-account-email). Sales continue. On a
development box without Cloud email, check the test inbox. If the settings fail to reload after
removal, retry loading them. The removal has already succeeded.
