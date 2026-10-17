# Stripe Node SDK

This directory carries the licence from `stripe@23.0.0`, published under MIT:
[upstream licence](https://github.com/stripe/stripe-node/blob/v23.0.0/LICENSE).

Keep this copy with the SDK upgrade. The installed SDK's `esm/` and `cjs/` directories contain
package manifests declaring only their module type. The current npm-notice generator stops at
those manifests, so calls using those SDK module paths produce no Stripe notice. This copy is
included by the image's `deploy/third-party/` copy (`deploy/Dockerfile`).
