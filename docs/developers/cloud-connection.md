# Connect a venue to Waitron Cloud

The Cloud services screen in Settings connects this installation to a Cloud
organisation and legal business. You need a local manager with `system.manage` and
a Cloud account with permission to register venues for that business.

Choose **Connect to Cloud**, then **Open Cloud**. Enter the code shown locally and
approve the business in Cloud. Return to Waitron, choose **Check connection**, check
the organisation and business, then choose **Connect this venue**. The server checks
your local permission and its primary role again before signing the final request.

Connected means the installation is registered. Remote access and backups remain
unconfigured until their service setup is implemented. No account or Cloud call is
added to the sale path.

## Configure the Cloud destination

Set `WAITRON_CLOUD_ORIGIN` to the exact portal origin, for example
`https://cloud.example.com`, without a trailing slash. HTTPS is required. A development
server with `WAITRON_ENV=dev` can use HTTP on `127.0.0.1`, `localhost` or `::1`.
Without this setting, the screen reports that Cloud services are unavailable.

The server derives the local venue from its provisioned location. Production maps
to Cloud's production environment; development and preproduction map to test.
Browser input cannot select the destination, installation key or local venue.

`cloud-connection.json` lives under `WAITRON_STATE_DIR` and contains the installation's
private key. Run one server process per node state directory. Requests within that
process share a write gate. Writes use a fresh mode-0600 temporary file, sync it,
rename it and sync the directory before sending the first request to Cloud. Restart
and lost-reply tests exercise reuse of the saved key and request. These tests do not
simulate a power loss.

Keep this file out of replacement restores. The current secret/configuration capture
uses named file lists and does not include it. A managed replacement must obtain a
fresh Cloud identity while retaining the venue's identity; that lifecycle is separate
from pairing. Corrupt state fails closed instead of silently generating another key.

If a request expires or becomes unavailable, choose **Start again**. Waitron checks
Cloud before replacing the request. If Cloud has already completed it, Waitron recovers
that result. Network failures retain the current operation for a deliberate retry.

## Run the integration proof

The Cloud repository owns the local runner. Build this checkout's dashboard with
`pnpm --filter @waitron/dashboard build`, then set `WAITRON_CHECKOUT` to its absolute
path when following [Cloud's local-pairing guide](https://github.com/waitron-io/waitron-cloud/blob/main/docs/local-pairing.md).

The runner starts two actual Waitron servers through
`apps/server/scripts/cloud-integration-fixture.ts`, each with disposable SQLite files,
plus the Cloud API and browser. It verifies the two approval screens, a server restart,
a lost committed reply and rejection of crossed installation proofs. The fixture uses
demo mode and does not configure fiscal/payment providers or create invoices.

The local Cloud write routes accept only the configured management origin. Open the
screen at `WAITRON_MANAGEMENT_ORIGIN`; the later remote-access integration must
configure its staff hostname consistently. An automatic status read leaves your
session idle time unchanged. Clicking Check connection counts as your activity.
