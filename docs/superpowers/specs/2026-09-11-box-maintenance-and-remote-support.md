# Box maintenance credentials and remote support

Date: 2026-09-11

Status: discussion record and recommended direction, not an approved implementation spec.
The owner requested that this conversation be preserved. No account provisioning, support
service, or access policy is implemented by this document.

When you ship a preinstalled box, the restaurant should be able to plug it in and complete
Waitron setup without creating a Linux account. Keep the Waitron administrator login separate
from operating-system maintenance access. The owner should still have a documented way to
administer their hardware when the application is unavailable.

## Installation privileges and low ports

The installer and the installed server have separate permissions:

- `deploy/install.sh:5` documents running the bootstrap through `sudo bash`, but that does not
  establish how a particular box was installed. `deploy/prepare.sh:20` invokes commands directly
  as root or through `sudo -n` otherwise. `-n` means non-interactive: sudo does not prompt and
  fails if it requires a password. Passwordless policy or a valid cached authentication can
  permit the command [S1].
- The final `docker compose` commands at `deploy/prepare.sh:126` run without that wrapper.
  A non-root caller therefore also needs Docker access and a writable installation directory;
  internal sudo calls alone do not establish that the entire installation will succeed.
- `deploy/Dockerfile:90` grants Node `cap_net_bind_service`, the Linux permission to bind ports
  below 1024 [S2]. The image selects `USER waitron` at line 169. With host networking selected
  in `deploy/compose.yml:17`, this is the configured mechanism for binding the box's low ports,
  including 80 and 443. This discussion did not run a fresh container probe. The earlier
  experiment and its limits are recorded in the
  [container design's provenance](2026-09-08-node-containers-design.md#13-provenance).

Do not give an everyday restaurant account unrestricted passwordless sudo. Adding it to the
Docker group would also grant root-level privileges [S3]. Routine updates, diagnostics and
service restarts should eventually have specific maintenance controls.

## The owner's local maintenance account

Recommended starting point: create a Linux account named `maintenance` with ordinary,
password-required sudo. Give every box a separately generated password. Supply it to the owner
on a sealed card associated with the box's serial number:

```text
Waitron box: WT-001234
Maintenance username: maintenance
Maintenance password: <unique random passphrase>

Keep this somewhere secure.
This gives full administrative access to this box.
```

A proposal is six words selected independently using a cryptographically secure random
generator from a defined word list. The generator and word list still need choosing; a phrase
invented by a person is not this proposal.

Personalise each box after copying the standard OS image. Generate its password, create the
account, grant sudo, print the corresponding card, and verify login and escalation before
removing factory access. Never copy one working maintenance password into the fleet image.

For manual preparation on a standard Debian/Ubuntu sudo setup, the account commands are:

```bash
sudo adduser maintenance
sudo adduser maintenance sudo
```

The first command prompts for the account password; the second adds it to the sudo group [S4].
These are illustrative commands, not a tested Waitron provisioning procedure. An automated
provisioner could supply the generated password to `chpasswd` through standard input [S5],
with shell tracing disabled and no plaintext password in command arguments or installation logs.
The proposed acceptance check must also confirm that no additional sudo policy grants this
account passwordless access.

Give the owner the only retained plaintext copy and encourage them to save it in a password
manager. Keep it separate from the Waitron login and backup recovery key. Credential loss,
replacement cards, ownership transfer and reinstall remain procedures to design.

Leave direct root login and remote SSH access disabled by default. For local maintenance,
connect a keyboard and display, log in using the card, and use sudo when needed. This proposal
assumes hardware with a usable local console. It does not recover a machine whose OS cannot
boot, nor replace any disk-unlock credential required by an eventual encryption design.

## Owner-enabled remote support

The proposed restaurant flow is:

1. Contact support and enable access for a short period, for example 30 minutes.
2. See whether the request is for diagnostics or full administrative access before approving it.
3. See the connected technician and a control to end access.
4. Have expiry or cancellation disconnect existing sessions and remove temporary privileges.

Install the maintenance service directly on the host OS so its operation does not depend on
Docker or the Waitron application. That separation is a design requirement to test, not an
availability guarantee. When the application is broken, the owner needs an independent way to
approve access, such as a physical button or a local maintenance command. The choice is open.
An unauthenticated recovery page must not itself grant administrative access.

Use individual technician identities and temporary SSH credentials. A dedicated support
account could receive passwordless sudo during an explicitly approved administrative session;
the owner's maintenance password would not be shared with support. Record approval, technician
identity, session times and administrative activity. Credential issuance, identity verification,
recording and retention still need a concrete design. SSH alone does not implement this flow.

Removing an SSH credential prevents future authentication; expiry must additionally terminate
active access and account for processes or forwarding started by that session. Full root
access trusts the technician, who can alter the mechanism enforcing expiry. This proposal
does not claim to contain a malicious administrator or make their local logs tamper-proof.

## WireGuard, SSH and the reachable endpoint

WireGuard provides a private network connection; SSH authenticates the technician and supplies
the remote terminal. You can run SSH over WireGuard. A box behind a restaurant router can
initiate WireGuard traffic to a publicly reachable peer. Persistent keepalives retain the
router's network mapping so replies can continue arriving without restaurant port forwarding
[S6]. This requires the network to permit the relevant UDP traffic.

A reverse SSH tunnel is an alternative connection mechanism. The box opens an outbound SSH
connection and makes a service on the box reachable through a listening port at the remote end
[S7]. Configure that listener for access through the authenticated support entry point, not as
a public box SSH port. Either mechanism still needs separate permission to administer the box.

For a customer with a cloud instance, the proposed route reuses that instance:

```text
Restaurant box <-- WireGuard --> Customer's cloud instance <-- Technician
```

The existing [connectivity decision](2026-09-05-relay-decision.md) uses each venue's own cloud
instance and WireGuard, with an SSH fallback recorded in the backlog. This note does not reopen
that decision or propose a third-party overlay network.

For a customer with only a physical box, one option is a shared support endpoint:

```text
Restaurant box <-- WireGuard --> Waitron support server <-- Technician
```

Here, "endpoint" means a publicly reachable machine the box can contact. A shared support
server would provide maintenance connectivity without needing to host the customer's POS or
database. It would still handle support traffic and access metadata. Configure access so
technicians reach only authorised boxes and customer boxes cannot reach one another.

A dedicated server is not technically mandatory. The box could instead contact a technician's
computer with a reachable WireGuard endpoint, or the service could run on suitable existing
infrastructure. A stable public server is the recommended operational shape, not a protocol
requirement. The earlier conversational claim that another server "would be required" was too
strong.

Offering a shared support endpoint for customers without a cloud instance is a new service
decision. It is separate from the existing decision against a shared relay for normal product
traffic. Decide whether to offer it, who operates it, how boxes enrol, and how access is isolated
before implementing it. Do not infer approval from the request to save these notes.

If Linux cannot boot or the box has no working internet path, neither proposed remote route
can provide access. Local maintenance, physical recovery or a replacement box remains necessary
for those cases.

## Sources and evidence limits

External documentation consulted on 2026-09-11. Quotes below support the narrow paraphrases in
the text; recommendations about the product and support workflow are proposals. No deployed
box, generated credential or remote support session was tested for this discussion.

| ID | Source and its wording | What it supports |
| --- | --- | --- |
| S1 | [sudo manual](https://manpages.ubuntu.com/manpages/noble/man8/sudo.8.html): "Avoid prompting the user for input of any kind." and "Security policies may support credential caching" | Non-interactive sudo and cached authentication; the cache duration and applicable policy depend on configuration. |
| S2 | [Docker security](https://docs.docker.com/engine/security/): "they can just be granted the `net_bind_service` capability instead" | Low-port binding does not require running the whole server as root. |
| S3 | [Docker post-installation](https://docs.docker.com/engine/install/linux-postinstall/): "The `docker` group grants root-level privileges to the user." | Docker-group membership is administrative access. |
| S4 | [Ubuntu user management](https://ubuntu.com/server/docs/how-to/security/user-management/): "sudo adduser username groupname"; "the group `sudo` which is added to the file `/etc/sudoers` as an authorized `sudo` user" | Account creation, group membership and Ubuntu's sudo-group policy. |
| S5 | [chpasswd manual](https://manpages.ubuntu.com/manpages/focal/man8/chpasswd.8.html): "reads a list of user name and password pairs from standard input" | A batch password provisioner can supply the password over standard input. |
| S6 | [WireGuard quick start](https://www.wireguard.com/quickstart/#nat-and-firewall-traversal-persistence): "keep the NAT/firewall mapping valid, by periodically sending keepalive packets" | Keepalives preserve the mapping for a peer behind a router or firewall. |
| S7 | [OpenSSH `ssh -R`](https://man.openbsd.org/ssh#R): "connections to the given TCP port or Unix socket on the remote (server) host are to be forwarded to the local side" | A box-initiated SSH connection can carry incoming support connections. |
