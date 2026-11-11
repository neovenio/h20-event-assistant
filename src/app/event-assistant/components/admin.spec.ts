import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Booking, INITIAL_BOOKINGS } from '../data/initial-data';
import { EventStore } from '../event-store';
import { Admin } from './admin';

function booking(id: string, change: Partial<Booking>, createdAt = new Date().toISOString()) {
  const base = JSON.parse(JSON.stringify(INITIAL_BOOKINGS[0])) as Booking;
  return {
    ...base,
    id,
    reference: `REF-${id}`,
    requestStatus: 'pending_review',
    reservation: { ...base.reservation, createdAt },
    ...change,
  } as Booking;
}

describe('Admin claim indicators', () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

  function render(bookings: Booking[]) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.inject(EventStore).bookings.set(bookings);
    const fixture = TestBed.createComponent(Admin);
    fixture.componentRef.setInput('section', 'bookings');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const rowFor = (host: HTMLElement, reference: string) =>
    [...host.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(reference))
      ?.textContent ?? '';

  it('flags failed AI explanations and stale incomplete claims, not healthy or fresh rows', () => {
    const host = render([
      booking('ok', {}),
      booking('legacy', { claimStatus: undefined, aiStatus: undefined }),
      booking('ai', { aiStatus: 'failed' }),
      booking('stale', { claimStatus: 'claiming' }, minutesAgo(11)),
      booking('fresh', { claimStatus: 'claiming' }, minutesAgo(2)),
      booking('rejected', { claimStatus: 'claiming', requestStatus: 'rejected' }, minutesAgo(30)),
    ]);
    expect(rowFor(host, 'REF-ai')).toContain('AI-uitleg ontbreekt');
    expect(rowFor(host, 'REF-ai')).not.toContain('Onvolledige aanvraag');
    expect(rowFor(host, 'REF-stale')).toContain('Onvolledige aanvraag');
    expect(rowFor(host, 'REF-stale')).not.toContain('AI-uitleg ontbreekt');
    for (const reference of ['REF-ok', 'REF-legacy', 'REF-fresh', 'REF-rejected']) {
      expect(rowFor(host, reference)).not.toContain('AI-uitleg ontbreekt');
      expect(rowFor(host, reference)).not.toContain('Onvolledige aanvraag');
    }
  });
});
