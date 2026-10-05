/**
 * A media library filename: the sha256 of the stored bytes in lowercase hex, then the extension of
 * the format they were sniffed as.
 */
export const MEDIA_FILENAME = /^[0-9a-f]{64}\.(jpg|png|webp)$/;
