# Email

Before relying on email, send a test using your mail provider's settings. In the dashboard,
the test goes to your own account address. During setup, it goes to the administrator address
you entered.

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
