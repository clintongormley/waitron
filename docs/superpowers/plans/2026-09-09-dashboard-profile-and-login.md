# Dashboard profile and login implementation

1. Reproduce the login layout, cancellation and recovery issues in browser tests, then implement
   full cancellation, the wider form, alternative-action placement and resend countdown.
2. Test and add server reset spacing and a password adapter over the existing PIN backoff policy.
3. Test session-scoped profile reads and writes in Identity and the server, including tenant,
   current-credential and credential-ownership checks. Keep each logical change in one transaction.
4. Add the profile API client and accessible forms, then expose the profile from every authenticated
   banner and support its URL for every role.
5. Run changed-package coverage and the repository gate. Record remote Turnstile and incomplete
   core navigation permission filtering in the backlog. Finish-branch remains a separate owner action.
