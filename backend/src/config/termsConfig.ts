/**
 * Which version of the Terms & Conditions is currently in force.
 *
 * users.terms_accepted_at records *when* somebody agreed, which on its own says nothing
 * about *what* they agreed to. Every time the document was edited, the whole user base
 * silently became "accepted" against text that no longer existed, and there was no way
 * to tell who had seen which version - or to ask anyone to look again.
 *
 * Dated rather than numbered so the stored value is legible on its own: a row reading
 * '2026-08-10' says exactly which document that person accepted, and matches the
 * "Last updated" line they would have seen at the top of it.
 *
 * Mirrored in src/constants/terms.ts for the frontend, and it must match the
 * LAST_UPDATED date rendered by src/components/TermsContent.tsx. Changing the terms
 * means changing all three: bump this, and every user is asked to accept again.
 */
export const CURRENT_TERMS_VERSION = '2026-08-28';

/**
 * The version in force before the current one.
 *
 * Used once, to backfill users who accepted under the old regime and have no version
 * recorded at all. Assuming the previous version for them is the only honest reading:
 * they did accept something, and it was that document - what they have not seen is the
 * current one, which is exactly what the re-acceptance prompt is for.
 */
export const PREVIOUS_TERMS_VERSION = '2026-08-10';

/**
 * Whether this user has to accept the terms again.
 *
 * A NULL version means an account created before versioning existed and never
 * backfilled - treated as out of date rather than up to date, so the failure mode is a
 * prompt the user did not strictly need rather than a silent gap in the record.
 */
export function needsTermsAcceptance(storedVersion: unknown): boolean {
  return String(storedVersion ?? '') !== CURRENT_TERMS_VERSION;
}
