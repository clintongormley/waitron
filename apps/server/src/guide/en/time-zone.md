# Confirm the venue time zone

## When trading is stopped {#stopped}

If the venue's saved time zone is missing or invalid, Waitron stops trading before starting its payment and invoice work. Sign in to the dashboard. You can still sign out; a manager with permission to configure the venue can confirm its time zone.

## Choose and confirm {#confirm}

Choose the time zone for the venue's location. The suggestion comes from its saved country and province; check it rather than assuming it is correct. Nothing is selected or confirmed for you.

Check the local date and time, the UTC offset in minutes and the business date. The business date can be yesterday before your retained day changeover. For example, at 01:30 on 15 October with a 06:00 changeover, the business date is 14 October.

Confirm that the selected time zone is correct, then choose **Save**. This preserves the day changeover and its scheduled changes. A clock or schedule refusal must be resolved separately.

## After saving {#restart}

Waitron saves the zone and requests a restart. Trading stays stopped until startup checks pass. Choose **Reload** after the restart. If the page cannot read the latest status, choose **Check status**; a successful save stays saved.

If the save reply is lost, the page checks the saved status before offering another save. A zone already saved does not need a second confirmation. Old invoices and payment facts keep their recorded dates and amounts.

## Receipt dates {#receipts}

Your receipt and its reprints show the date and time recorded when the invoice was issued. A later zone change does not change that date or the invoice date in its QR code.
