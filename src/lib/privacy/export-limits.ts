const MEBIBYTE = 1024 * 1024;

// The current envelope keeps plaintext, base64 and AES-GCM buffers in memory.
// These conservative bounds are required until exports use chunked encryption.
export const MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES = 32 * MEBIBYTE;
export const MAX_PRIVACY_EXPORT_STRUCTURED_JSON_BYTES = 16 * MEBIBYTE;
export const MAX_PRIVACY_EXPORT_STORED_BYTES = 64 * MEBIBYTE;
export const MAX_PRIVACY_EXPORT_MEDIA_BYTES = 12 * MEBIBYTE;
export const MAX_PRIVACY_EXPORT_MEDIA_ROWS = 2_000;
export const PRIVACY_EXPORT_OBJECT_READ_TIMEOUT_MS = 30_000;
export const PRIVACY_EXPORT_DOWNLOAD_MAX_DURATION_MS = 10 * 60_000;
