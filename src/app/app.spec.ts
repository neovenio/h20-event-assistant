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
  it('handles a live room without image or rate and empty catering in the builder', async () => {
    const aula = {
      id: 'aula',
      name: 'Aula',
      description: 'Zaal',
      isActive: true,
      maxCapacity: 200,
      capacityDisplay: 'Tot 200 personen',
      capacityVerified: true,
      imageUrl: '',
      facilities: [],
      suitableFor: [],
    };
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
              json: async () => ({ rooms: [aula], catering: [], upgrades: [], activities: [] }),
            },
      ),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.store.rooms().length).toBe(1));
    await TestBed.inject(Router).navigateByUrl('/plan');
    await fixture.whenStable();
    const found = await vi.waitFor(() => {
      const el = fixture.debugElement.query(By.directive(EventBuilder));
      expect(el).toBeTruthy();
      return el;
    });
    const builder = found.componentInstance as EventBuilder;
    const show = async (step: number) => {
      builder.step.set(step);
      fixture.detectChanges();
      await fixture.whenStable();
      return found.nativeElement as HTMLElement;
    };
    let el = await show(3);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('Tarief op aanvraag');
    expect(el.textContent).not.toContain('/ uur');
    el = await show(4);
    expect(el.textContent).toContain('Er zijn nog geen upgrades gepubliceerd');
    el = await show(5);
    expect(el.textContent).toContain('Er is nog geen catering gepubliceerd');
    builder.config.selectedRoomId = 'aula';
    el = await show(7);
    const rooms = [...el.querySelectorAll('.totals div')].find((d) =>
      d.textContent?.includes('Zalen'),
    );
    expect(rooms?.textContent).toContain('Op aanvraag');
  });
  it('clears the previous customer notice and private link on logout', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    app.notice = 'Je aanvraag is ontvangen en wacht op beoordeling.';
    app.receipt = 'https://example.test/#request=r&token=t';
    app.logout();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(app.notice).toBe('');
    expect(app.receipt).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain('Persoonlijke aanvraaglink');
  });
});
