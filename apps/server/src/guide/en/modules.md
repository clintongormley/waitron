# Modules

## Set up a card provider {#set-up}

Open **Modules** in Settings, or choose **Configure card providers** on **Card payments**.
The Card payments link shows every card provider, including those that still need setup.

Choose **Configure** in the provider's row menu, enter its credentials and choose **Save**.
Use **Cancel** to discard your changes. A configured provider can still refuse a payment;
check reader status and unfinished payments on **Card payments**.

The **Enabled**, **Disabled** and **All** filters show a module's state separately from its
configuration. **Add a module** shows disabled modules in the same list. Choose **All categories**
to see all optional modules.

## Turn a card provider on or off {#provider-state}

As an administrator, choose **Turn off** in the provider's row menu and confirm. Remove or
unpair its readers on **Card payments** first; a refusal names any readers still attached and
links you there. Turning it off keeps its credentials for earlier payments and refunds.

To add readers again, select **Disabled** or **All**, then choose **Turn on** and confirm. **Configured** tells you whether its
credentials are saved; it is separate from **Enabled**.

## Turn Bookings on or off {#bookings-state}

As an administrator, choose **Turn off** or **Turn on** in the Bookings row menu and confirm.
**Waiting for restart** means the change is saved. Open **Box status** in Settings and choose **Restart the box**
when you can pause service. Tills reconnect; check and resend any kitchen send interrupted by the restart.
Your saved bookings stay on this box when Bookings is off.

If the main box repeatedly fails to start, its recovery page offers **Switch Bookings off and start again**.
Open the secure address and enter an active administrator's password, or choose **Stop** to leave it unchanged.
An administrator without a password cannot use that recovery action.

## Turn Payments or Spanish workforce rules on or off {#module-state}

As an administrator, choose **Turn off** or **Turn on** in the module's row menu and confirm.
**Waiting for restart** means your choice is saved. Open **Box status** in Settings and choose
**Restart the box** when you can pause service. Check and resend any kitchen send interrupted by the restart.

Before turning Payments off, turn every card provider off, removing or unpairing its readers first.
After restarting, you can still take cash and enter cards taken on a separate terminal. Earlier
payments, refunds and payment checks remain available. To add readers again, turn Payments on,
restart, then turn the provider on.

With Spanish workforce rules off, you can still plan rotas and record working time. Spanish-rule
checks and the Spain time-record export are unavailable until you turn the module on and restart.
Your personal-data download keeps your clock records in `clock-entries.json`; its Spanish-format
`time-record.pdf` and `time-record.csv` files are omitted while the module is off.

## Check abandoned-order refunds {#abandoned-refunds}

If a customer leaves after a SumUp charge, open **Card payments** and check **Abandoned-order refunds**.
Waitron attempts one full refund when SumUp identifies the payment as yours, the amount matches and no refund exists.
A payment taken outside Waitron on the reader stays for you to check.

**Refund confirmed** means SumUp lists the full amount returned. For an unconfirmed payment, use its charge date, reference and amount to check it in SumUp before refunding there, so you do not return the money twice.
Check this list even if an earlier payment warning is still open in Alerts.
