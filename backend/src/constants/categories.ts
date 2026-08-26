// Mirrors src/constants/categories.ts on the frontend. The backend is a separate
// deployable (see railway.json) with no shared build step with the frontend, so this
// list has to be kept in sync by hand - if you add/rename an option on one side,
// update the other too. Whatever's here is the allowlist routes/services.ts and
// routes/users.ts check a submitted `category` against; providers.ts's category
// filter and stats queries match stored values with exact string equality, so a
// category that drifts between the two lists (a typo, different casing) would
// silently become unfindable rather than erroring anywhere.
export const CATEGORY_OPTIONS = [
  'Photography',
  'Videography',
  'Makeup Artist',
  'Design',
  'Event Organizer',
  'Wedding Photography',
  'Portrait Photography',
  'Event Photography',
  'Commercial Photography',
  'Other',
];
