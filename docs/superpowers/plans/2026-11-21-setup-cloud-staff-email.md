# Choose Cloud staff email during test setup

In fresh Prepare on a configured HTTPS test box, an installer with a provisional Cloud registration can tick **Send staff email through Waitron Cloud**. The choice takes effect at Provision. Leave it unticked to use your mail server. Prepare requires a tested mail server for invoices and notices.

The owner chose the checkbox only (“Tick box, as proposed”, Lane K questions.md, 21 November 10:34). The watcher corrected the example about guest mail at 10:38 and chose the staff-only text that matches version 1. Claude reviewed commit 1e5b3c5731. The watcher cleared this Prepare-first pilot and kept the mail server required in Lane D questions.md on 21 November at 15:22. Lane K's 13:40 handoff pins the [Cloud #1353 contract](https://github.com/waitron-io/waitron-cloud/blob/322451c5dfe60c2f9e92fe3e5181a59e3b7d4954/docs/transactional-email-relay-contract.md#choose-staff-email-in-test-setup).

- In the setup email screen and app, use the existing cookie-and-tab availability check for the unchecked choice. Carry the draft to Provision. Keep the usual mail server test.
- In the provision route, setup Cloud sign-in, Cloud client and email exchange, reuse the provisional binding and lease. Provision sends the signed choice before Cloud files the venue. On an uncertain reply, read signed configuration once. Carry a confirmed grant into the installed connection as `emailRelayEnabled: true`. The existing sender reads the grant and routes invitations, password resets and email changes.
- When Cloud staff email cannot be confirmed, the completed setup page says “Waitron Cloud staff email could not be confirmed. Your mail server settings were saved.” It links to the Email guide's staff email section. Update that guide, Servers, A987 and A1438.

**Checks.** Browser tests cover the choice, the existing mail test and the finish notice. Keep eligibility in the address binding tests. The provision test covers the bound choice and fallback, and the Cloud email tests cover the signed envelope, refusals and lost-reply order. In disposable Cloud #1353 with Mailpit, finish Prepare and check the three staff deliveries. Look at the checkbox in both languages and themes at phone and desktop widths.

**Estimate.** 150–250 production lines and 100–180 test and support lines. Development setup, guest email and hosted qualification are separate.
