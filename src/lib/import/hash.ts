/**
 * A fingerprint of the uploaded file.
 *
 * WHAT IT IS FOR: noticing that this is the same book again. A learner who
 * uploads `Der Prozess.epub` twice gets told so, with a link to the copy they
 * already have — and is then allowed to proceed anyway, because "I want a second
 * copy" is a legitimate thing to want and a hash is not a policy.
 *
 * WHAT IT IS NOT FOR: identity. The import's id is its identity. Two different
 * files with the same content are the same book; the same book in two formats is
 * two hashes. Neither fact is load-bearing anywhere.
 *
 * SHA-256 via Web Crypto rather than `node:crypto`, so the same function runs in
 * the browser (hashing before upload, so the duplicate warning arrives before
 * the 40 MB does) and in a server action.
 */

/** Hex SHA-256 of the bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // A fresh ArrayBuffer: `bytes.buffer` may be a slice of a larger allocation,
  // which would hash the wrong region.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
