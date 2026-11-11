import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { vi } from 'vitest';
import { By } from '@angular/platform-browser';
import { App } from './app';
import { EventBuilder } from './event-assistant/components/event-builder';
import { emptyConfiguration } from './event-assistant/event-utils';
import { routes } from './app.routes';
import { AuthService } from './event-assistant/auth-service';
import { Booking } from './event-assistant/models';

const pages: [string, string][] = [
  ['/', 'Organiseer jouw perfecte evenement'],
  ['/my-proposals', 'Mijn voorstellen'],
  ['/knowledge', 'Kennisbank'],
  ['/rooms', 'Onze zalen & ruimtes'],
  ['/activities', 'Activiteiten & gaming experiences'],
  ['/catering', 'Catering op maat'],
];

describe('routing', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ n8nWebhookBaseUrl: '' }) }),
    );
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  async function open(url: string) {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl(url);
    await fixture.whenStable();
    return fixture;
  }

  it.each(pages)('renders the matching page for %s', async (url, heading) => {
    const fixture = await open(url);
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(heading);
  });

  it('opens the event builder on /plan and returns to the dashboard when dismissed', async () => {
    const fixture = await open('/plan');
    expect(fixture.nativeElement.querySelector('app-event-builder')).not.toBeNull();
    fixture.componentInstance.closeBuilder();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/');
    expect(fixture.nativeElement.querySelector('app-event-builder')).toBeNull();
  });

  async function builderState(fixture: ReturnType<typeof TestBed.createComponent<App>>) {
    await fixture.whenStable();
    const builder = fixture.debugElement.query(By.directive(EventBuilder))?.componentInstance;
    return { proposalId: builder?.proposalId(), initial: builder?.initial() };
  }

  it('opens a fresh builder from the nav after editing and closing a proposal', async () => {
    const fixture = await open('/my-proposals');
    const app = fixture.componentInstance;
    app.openBuilder({ ...emptyConfiguration(), participants: 42 }, 'proposal-x');
    await fixture.whenStable();
    expect((await builderState(fixture)).proposalId).toBe('proposal-x');
    app.closeBuilder();
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/plan');
    const state = await builderState(fixture);
    expect(state.proposalId).toBeNull();
    expect(state.initial).toBeNull();
  });

  it('opens a fresh builder from the nav after saving an edited proposal', async () => {
    const fixture = await open('/my-proposals');
    const app = fixture.componentInstance;
    app.openBuilder({ ...emptyConfiguration(), participants: 42 }, 'proposal-x');
    await fixture.whenStable();
    app.go('/my-proposals', 'Concept bewaard.');
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/plan');
    const state = await builderState(fixture);
    expect(state.proposalId).toBeNull();
    expect(state.initial).toBeNull();
  });

  describe('builder edit target and assistant plans', () => {
    const plan = () => ({ ...emptyConfiguration(), name: 'AI plan', participants: 77 });

    async function openEditing() {
      const fixture = await open('/my-proposals');
      const app = fixture.componentInstance;
      const saved = app.store.saveProposal({ ...emptyConfiguration(), name: 'X' });
      app.openBuilder(saved.config, saved.id);
      await fixture.whenStable();
      return { fixture, app, saved };
    }
    const builderOf = (fixture: ReturnType<typeof TestBed.createComponent<App>>) =>
      fixture.debugElement.query(By.directive(EventBuilder)).componentInstance as EventBuilder;

    it('keeps the edit target through book and dismiss, then updates in place', async () => {
      const { fixture, app, saved } = await openEditing();
      builderOf(fixture).config.participants = 55;
      app.startBooking(builderOf(fixture).config);
      await fixture.whenStable();
      app.dismissBooking();
      await fixture.whenStable();
      const builder = builderOf(fixture);
      expect(builder.proposalId()).toBe(saved.id);
      expect(builder.config.participants).toBe(55);
      builder.save();
      expect(app.store.proposals().length).toBe(1);
      expect(app.store.proposals()[0].id).toBe(saved.id);
      expect(app.store.proposals()[0].config.participants).toBe(55);
    });

    it('keeps a new concept new through book and dismiss', async () => {
      const fixture = await open('/plan');
      const app = fixture.componentInstance;
      app.startBooking(builderOf(fixture).config);
      await fixture.whenStable();
      app.dismissBooking();
      await fixture.whenStable();
      expect(builderOf(fixture).proposalId()).toBeNull();
      builderOf(fixture).save();
      expect(app.store.proposals().length).toBe(1);
    });

    it('replaces an unchanged open builder with an assistant plan and returns to step 1', async () => {
      const fixture = await open('/plan');
      const app = fixture.componentInstance;
      builderOf(fixture).step.set(4);
      app.assistantPlan(plan());
      await fixture.whenStable();
      expect(app.pendingPlan).toBeNull();
      expect(builderOf(fixture).config.participants).toBe(77);
      expect(builderOf(fixture).step()).toBe(1);
    });

    it('asks for confirmation when the builder has unsaved changes', async () => {
      const { fixture, app, saved } = await openEditing();
      builderOf(fixture).config.participants = 55;
      app.assistantPlan(plan());
      await fixture.whenStable();
      expect(app.pendingPlan).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Je huidige plan vervangen?');
      app.cancelPlan();
      await fixture.whenStable();
      expect(app.pendingPlan).toBeNull();
      expect(builderOf(fixture).config.participants).toBe(55);
      expect(builderOf(fixture).proposalId()).toBe(saved.id);
      app.assistantPlan(plan());
      app.confirmPlan();
      await fixture.whenStable();
      expect(builderOf(fixture).config.participants).toBe(77);
      expect(builderOf(fixture).step()).toBe(1);
    });

    it('saves an applied assistant plan as a new concept and leaves X unchanged', async () => {
      const { fixture, app, saved } = await openEditing();
      app.assistantPlan(plan());
      await fixture.whenStable();
      const builder = builderOf(fixture);
      expect(builder.proposalId()).toBeNull();
      builder.save();
      expect(app.store.proposals().length).toBe(2);
      expect(app.store.proposals().find((p) => p.id === saved.id)?.config.name).toBe('X');
    });
  });

  it('only shows the demo staff portal while no n8n backend is configured', async () => {
    const fixture = await open('/');
    const app = fixture.componentInstance;
    TestBed.inject(AuthService).demoStaff.set(true);
    expect(app.admin()).toBe(true);
    app.store.api.configure('https://example.test/webhook/h20');
    expect(app.admin()).toBe(false);
  });

  it('marks the current navigation item as active', async () => {
    const fixture = await open('/rooms');
    const active = fixture.nativeElement.querySelectorAll('.sidebar nav .active');
    expect(active.length).toBe(1);
    expect(active[0].getAttribute('aria-current')).toBe('page');
    expect(active[0].textContent).toContain('Zalen');
  });

  it('falls back to the dashboard for unknown paths', async () => {
    const fixture = await open('/does-not-exist');
    expect(TestBed.inject(Router).url).toBe('/');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Organiseer');
  });

  it('supports back and forward between visited pages', async () => {
    const fixture = await open('/rooms');
    const router = TestBed.inject(Router);
    router.initialNavigation(); // starts listening to popstate, as a bootstrapped app does
    await router.navigateByUrl('/catering');
    await fixture.whenStable();
    const location = TestBed.inject(Location);
    location.back();
    await vi.waitFor(() => expect(router.url).toBe('/rooms'));
    location.forward();
    await vi.waitFor(() => expect(router.url).toBe('/catering'));
  });

  it('opens a private receipt from the URL fragment on any route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ n8nWebhookBaseUrl: 'https://example.test/webhook/h20' }),
      }),
    );
    const fixture = TestBed.createComponent(App);
    const lookup = vi
      .spyOn(fixture.componentInstance.store, 'lookup')
      .mockResolvedValue({ id: 'abc' } as Booking);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/rooms#request=abc&token=s3cret');
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledWith('abc', 's3cret'));
    await vi.waitFor(() => expect(fixture.componentInstance.selectedBooking?.id).toBe('abc'));
    expect(router.parseUrl(router.url).fragment).toBe('request=abc&token=s3cret');
    expect(router.url.split('#')[0]).toBe('/rooms');
  });

  it('keeps the receipt fragment when an unknown path falls back', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/nope#request=abc&token=t');
    expect(router.parseUrl(router.url).fragment).toBe('request=abc&token=t');
  });
});

describe('staff guard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('blocks /admin for non-staff users and redirects to the dashboard', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin');
    expect(TestBed.inject(Router).url).toBe('/');
    expect(TestBed.inject(AuthService).accessDenied()).toBe(true);
  });

  it('keeps the receipt fragment when redirecting', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/logs#request=a&token=b');
    expect(TestBed.inject(Router).url).toBe('/#request=a&token=b');
  });

  it('allows /admin for staff and defaults to the bookings section', async () => {
    TestBed.inject(AuthService).staff.set(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin');
    expect(TestBed.inject(Router).url).toBe('/admin/bookings');
    await harness.navigateByUrl('/admin/logs');
    expect(TestBed.inject(Router).url).toBe('/admin/logs');
  });
});
