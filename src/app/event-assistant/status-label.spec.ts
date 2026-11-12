import { statusLabel } from './status-label';

describe('statusLabel', () => {
  it('shows Dutch labels for request status codes', () => {
    expect(statusLabel('pending_review')).toBe('In beoordeling');
    expect(statusLabel('approved')).toBe('Goedgekeurd');
    expect(statusLabel('rejected')).toBe('Afgewezen');
    expect(statusLabel('cancelled')).toBe('Geannuleerd');
  });
  it('keeps unknown or already readable values', () => {
    expect(statusLabel('Awaiting Approval')).toBe('Awaiting Approval');
    expect(statusLabel(undefined)).toBe('');
  });
});
