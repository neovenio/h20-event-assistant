import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ n8nWebhookBaseUrl: '' }) }),
    );
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });
  it('renders the event dashboard after hydration', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'Organiseer jouw perfecte evenement',
    );
    expect(fixture.nativeElement.textContent).toContain('Lokale demo');
  });
  it('navigates to the venue catalogue without a router or hosting rewrite change', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.navigate('rooms');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'Onze zalen & ruimtes',
    );
    expect(fixture.nativeElement.querySelectorAll('.card').length).toBeGreaterThan(0);
  });
  it('shows an empty live catalogue without replacing it with demo rooms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) =>
        url === '/h20-runtime.json'
          ? {
              ok: true,
              json: async () => ({ n8nWebhookBaseUrl: 'https://example.test/webhook/h20' }),
            }
          : {
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({ rooms: [], catering: [], upgrades: [], activities: [] }),
            },
      ),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.loading()).toBe(false));
    await fixture.whenStable();
    expect(fixture.componentInstance.store.live()).toBe(true);
    expect(fixture.componentInstance.store.rooms()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Er zijn nog geen zalen gepubliceerd.');
  });
});
