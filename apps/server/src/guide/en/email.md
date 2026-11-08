# Email

Before relying on email, send a test using your mail provider's settings. In the dashboard,
the test goes to your own account address. During setup, it goes to the administrator address
you entered.

## Set up a mail server {#set-up}

In Prepare or Live, open **Settings → Email**. As an admin, choose **Set up mail server** or
**Change mail server**, enter your provider's settings and send a test before saving. Enter fresh
login details when changing an authenticated server; Waitron never shows the saved password.
Managers can view the settings, but cannot save or remove them.

Mail sent through your saved server and the test on this page use your venue name alongside
the sender address. If the page says the saved sender address is not valid, choose
**Change mail server** and correct **Sender address** before testing again.

Before completing Prepare or Live setup, enter your mail server settings and send an accepted
test to the administrator address. Development setup can skip this step. Saving a mail server
sends invitations and password-reset links to real inboxes. Check the account delivery status on
this page and the invoice status in **Mail server**: development boxes keep invoice email locally
even when account email uses the saved server.

In Demo, use the **Email inbox** link in the top bar. Sign in as an admin to open captured messages.

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

As an admin, choose **Remove mail server** and read the confirmation. **Stop** keeps the settings.
Removing the server clears its saved login details too; enter them again if you set it up later.

In Prepare or Live, account links and invoice email cannot be sent until you configure a server
again; sales continue. On a development box, email
goes back to its test inbox. If the settings fail to reload after removal, retry loading them;
the removal has already succeeded.
