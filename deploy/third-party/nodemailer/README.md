# Nodemailer

Keep this copy of the installed `nodemailer@10.1.4` licence with the dependency upgrade.
Its package manifest declares `MIT-0`; the text comes from the published package's `LICENSE`:
[upstream licence](https://github.com/nodemailer/nodemailer/blob/v10.1.4/LICENSE).

The npm-notice generator returns no package notice for this version's CJS and ESM entries,
which sit below manifests declaring only their module type. The image copies this directory
to `/app/third-party/nodemailer/` through `deploy/Dockerfile`'s existing third-party copy.
Keep it until the general lookup fix has been checked against the emitted server notices.
