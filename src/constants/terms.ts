/**
 * The version of the Terms & Conditions this build renders.
 *
 * Mirrors CURRENT_TERMS_VERSION in backend/src/config/termsConfig.ts, which is the
 * authority - the server decides whether a user is up to date, and stamps whichever
 * version it is serving when they accept. This copy exists so the document can show
 * which version it is, and so the two can be checked against each other by eye.
 *
 * Changing the terms means changing three things together: this constant, the backend
 * one, and LAST_UPDATED in src/components/TermsContent.tsx. Bumping the backend value
 * is what asks every existing user to accept again.
 */
export const CURRENT_TERMS_VERSION = '2026-08-28';
