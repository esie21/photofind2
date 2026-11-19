// One place for money display: 10,000.00 (comma thousands, dot decimals, always 2 decimals).
// Pinned to en-US so it doesn't change with the viewer's browser locale.
export const formatMoney = (value: number | string | null | undefined): string =>
  (Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
