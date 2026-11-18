# Backups

Use **Backups** in the dashboard to choose where you keep copies and to prepare what you need if the box fails. Keep a copy outside the box so a lost box does not take your only backup with it.

## Recovery pack {#recovery-pack}

Choose **Make recovery pack** and complete the sign-in it asks for. Use **Download PDF** or **Open to print**, then keep the pack locked away, off the box.

Check this card after changing backup settings or keys. Follow its instructions to make a new pack and keep any older packs it still names. For a lost or exposed pack, follow [Common losses](data-protection.md#breach-losses). For emergency start, see [Check emergency start in Cloud](servers.md#cloud-emergency).

## Configuration export {#configuration-export}

To reuse your setup for a new venue, enter and confirm an export passphrase of at least 12 characters, then choose **Download configuration export**. Keep the downloaded file and its passphrase somewhere safe. To recover this venue from a backup instead, follow [Recover from backup](backup-recovery.md#source).

## Scheduled backups {#archives}

You can keep copies in a folder on the box or in an S3-compatible bucket. For a bucket, enter its connection details.

Choose the days and time, then set how many backups to keep and how old they may be. Leave **Let the box choose** selected if you want backups after close and the day's reports. Save the recovery key as described below, then choose **Turn on backups**.

If you can choose **Waitron Cloud**, select **Every day** so Cloud can receive backups on your venue's schedule. Waitron Cloud decides when its old copies expire.

Once backups are on, use **Change destination or schedule** and **Save changes** to adjust them. Check the last backup shown for each destination and act on any failure shown there.

If Cloud becomes unavailable, open **Change destination or schedule** and choose **Remove Waitron Cloud**. Keep a folder or bucket selected and save your changes.

## Keep your keys {#keys}

Use **Copy** or **Download key file** to keep the recovery key somewhere safe outside the box. Tick **I have saved this key somewhere safe** once you have done so.

When you change the recovery key, use **Show the current key** to save the old key too. Keep older keys and packs for the backups you still hold. See [Prove access to the selected backup](backup-recovery.md#proof) for what you need when restoring.

## Continuous copy to your bucket {#bucket-copy}

Demo does not offer this copy.

In **Continuous copy to your bucket**, enter your bucket's connection details. Choose **Test**, then **Save and turn on**. Check **Last confirmed copy** and **Changes not yet in the bucket** to see how recent your copy is.

Use **Change bucket** to update the connection. If you need to restore the copy on another box, follow [Choose your copy](backup-recovery.md#source).
