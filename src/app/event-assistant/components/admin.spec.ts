import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Admin } from './admin';
import { EventStore } from '../event-store';
import { INITIAL_BOOKINGS } from '../data/initial-data';
import { Booking } from '../models';

describe('admin booking list claim indicators', () => {
  const base = INITIAL_BOOKINGS[0];
  const row = (id: string, extra: Partial<Booking>): Booking => ({
    ...structuredClone(base),
    id,
    reference: `REF-${id}`,
    ...extra,
  });

  function render(bookings: Booking[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ n8nWebhookBaseUrl: '' }) }),
    );
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.inject(EventStore).bookings.set(bookings);
    const fixture = TestBed.createComponent(Admin);
    fixture.componentRef.setInput('section', 'bookings');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  afterEach(() => vi.unstubAllGlobals());

  it('shows "AI-uitleg ontbreekt" for bookings whose AI text failed', () => {
    const el = render([
      row('a', { aiStatus: 'failed' }),
      row('b', { aiStatus: 'ok' }),
      row('c', {}),
    ]);
    const flagged = el.querySelectorAll('[data-indicator="ai-missing"]');
    expect(flagged.length).toBe(1);
    expect(flagged[0].textContent).toContain('AI-uitleg ontbreekt');
    expect(el.querySelector('[data-indicator="incomplete"]')).toBeNull();
  });

  it('shows "Onvolledige aanvraag" only for claims still claiming after 10 minutes', () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const el = render([
      row('stale', { claimStatus: 'claiming', claimCreatedAt: ago(11) }),
      row('fresh', { claimStatus: 'claiming', claimCreatedAt: ago(2) }),
      row('held', { claimStatus: 'held', claimCreatedAt: ago(60) }),
      row('rejected', {
        claimStatus: 'claiming',
        claimCreatedAt: ago(60),
        requestStatus: 'rejected',
      }),
    ]);
    const flagged = el.querySelectorAll('[data-indicator="incomplete"]');
    expect(flagged.length).toBe(1);
    expect(flagged[0].textContent).toContain('Onvolledige aanvraag');
  });
});
