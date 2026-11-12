const LABELS: Record<string, string> = {
  pending_review: 'In beoordeling',
  approved: 'Goedgekeurd',
  rejected: 'Afgewezen',
  cancelled: 'Geannuleerd',
};
/** Customer- and staff-facing label for a request status code; unknown values pass through. */
export function statusLabel(status: string | null | undefined): string {
  return status ? (LABELS[status] ?? status) : '';
}
