// Server-side caps on a single submission's recording, bounding the per-grade AI cost:
// Gemini bills video at ~260 tokens/sec, so an unbounded upload is an unbounded bill.
// The caps are generous enough for any real recitation, low enough that a runaway or
// forged upload can't send a huge media bill. `durationSec`/`sizeBytes` are
// client-reported (recorded via recordMedia), so this bounds the honest-but-huge and
// most abuse cases; hard byte enforcement at the R2/storage layer is a separate
// follow-up (a PUT presign can't carry a content-length limit).
export const MAX_MEDIA_DURATION_SEC = 300 // 5 minutes
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024 // 100 MB

// True when the reported media exceeds either cap. Null/absent values (e.g. a
// text-only or choice submission) never exceed — the caller stays media-agnostic.
export function mediaExceedsLimit(
  sizeBytes: number | null | undefined,
  durationSec: number | null | undefined,
): boolean {
  return (
    (sizeBytes != null && sizeBytes > MAX_MEDIA_BYTES) ||
    (durationSec != null && durationSec > MAX_MEDIA_DURATION_SEC)
  )
}
