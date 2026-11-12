import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import type { User } from 'firebase/auth';
import { App } from './app';
import { EventBuilder } from './event-assistant/components/event-builder';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ n8nWebhookBaseUrl: '' }) }),
    );
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
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
  it('navigates to the venue catalogue through the router', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/rooms');
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
  it('explains an empty room step in the builder instead of showing nothing', async () => {
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
    await TestBed.inject(Router).navigateByUrl('/plan');
    await fixture.whenStable();
    const builder = await vi.waitFor(() => {
      const found = fixture.debugElement.query(By.directive(EventBuilder));
      expect(found).toBeTruthy();
      return found;
    });
    (builder.componentInstance as EventBuilder).step.set(3);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(builder.nativeElement.textContent).toContain('Er zijn nog geen zalen gepubliceerd');
  });
  it('shows the signed-in account instead of the login form', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    app.auth.user.set({ email: 'klant@example.test' } as User);
    app.auth.staff.set(false);
    app.login = true;
    fixture.detectChanges();
    await fixture.whenStable();
    let text = fixture.nativeElement.textContent as string;
    expect(text).toContain('klant@example.test');
    expect(text).toContain('geen medewerkersrechten');
    expect(fixture.nativeElement.querySelector('input[name="password"]')).toBeNull();
    app.auth.staff.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Naar medewerkersportaal');
    expect(text).not.toContain('geen medewerkersrechten');
  });
});
