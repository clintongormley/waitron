# Email

Before relying on email, send a test using your mail provider's settings. In the dashboard,
the test goes to your own account address. During setup, it goes to the administrator address
you entered.

Before saving or removing a mail server, confirm your sign-in in the shared window.
[Your confirmation](staff.md#account-access) lasts 15 minutes or until your session ends.

## Set up a mail server {#set-up}

In Prepare or Live, open **System → Email**. With box administration (Admin by default), choose **Set up mail server** or
**Change mail server**, enter your provider's settings and send a test before saving. Enter fresh
login details when changing an authenticated server; Waitron never shows the saved password.
Managers can view the settings, but cannot save or remove them.

Mail sent through your saved server and the test on this page use your venue name alongside
the sender address. If the page says the saved sender address is not valid, choose
**Change mail server** and correct **Sender address** before testing again.

Before completing Prepare or Live setup, enter your mail server settings and send an accepted
test to the administrator address. Development setup can skip this step. If you use your own mail server, saving it
sends invitations and password-reset links to real inboxes. This page shows invoice email status:
development boxes keep invoice email locally even when account email uses a saved server or Cloud.

In Demo, use the **Email inbox** link in the top bar. Sign in as a Manager or Admin to open captured messages.

## Account email through test Cloud {#cloud-account-email}

When you pair your box with the test Cloud and enable its email relay, invitations,
password-reset links and email-change codes use Cloud, including in Demo. Check the recipient's
real inbox rather than Demo's Email inbox. Keep a mail server configured for receipts and other
notices, and for completing Prepare or Live setup.

Cloud account links lead back to your box. Open them on a network that can reach it. Cloud's
invitation does not list your roles or include the venue's optional privacy link. If an email
does not arrive, request a fresh link or code; an earlier message may still arrive later.
Turning the relay off restores your normal mail-server or Demo-capture route for new sends.

## Check the test result {#test-results}

An accepted test means the mail server took the message. Check your inbox, including junk mail.
If it is missing, check the recipient address and your mail provider's delivery information.

If the result says the mail server name was not found, check its spelling. For a certificate
refusal, use your provider's server name and a trusted certificate. If Waitron marks **Port**,
check the port in your provider's settings.

For an encryption refusal, follow the result's suggested encryption and port, then send another
test. Changing encryption leaves the port you entered in place, so change that too when needed.

If the server needs a login, enter both the username and password. On the dashboard, turn on
**Use authentication** first. If it refuses them, check both before testing again. For a timeout
or another refusal, check the port and encryption, then retry.

If setup asks you to test email, test again after changing the settings or administrator address.
Continue becomes available after the server accepts a test of those settings for that address.

## Remove a mail server {#remove}

With box administration (Admin by default), choose **Remove mail server** and read the confirmation. **Stop** keeps the settings.
Removing the server clears its saved login details too; enter them again if you set it up later.

In Prepare or Live, receipts and notices need a configured server. Account links can still use
an enabled test Cloud relay; otherwise they also wait for a server. Sales continue. On a development box, email
goes back to its test inbox. If the settings fail to reload after removal, retry loading them;
the removal has already succeeded.
