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
    const proposals = (fixture: ReturnType<typeof TestBed.createComponent<App>>) =>
      fixture.componentInstance.store.proposals();
    const builderOf = (fixture: ReturnType<typeof TestBed.createComponent<App>>) =>
      fixture.debugElement.query(By.directive(EventBuilder)).componentInstance as EventBuilder;
    const valid = () => ({ ...emptyConfiguration(), name: 'Teamdag', date: '2999-01-01' });
    const confirmText = (fixture: ReturnType<typeof TestBed.createComponent<App>>) =>
      fixture.nativeElement.querySelector('.confirm-replace')?.textContent ?? '';

    async function editX() {
      const fixture = await open('/my-proposals');
      const app = fixture.componentInstance;
      const x = app.store.saveProposal({ ...valid(), name: 'X' });
      app.openBuilder({ ...x.config }, x.id);
      await fixture.whenStable();
      return { fixture, app, x };
    }

    it('keeps the edit target when the booking form is dismissed', async () => {
      const { fixture, app, x } = await editX();
      const before = proposals(fixture).length;
      app.startBooking(builderOf(fixture).config);
      await fixture.whenStable();
      app.dismissBooking();
      await fixture.whenStable();
      expect(builderOf(fixture).proposalId()).toBe(x.id);
      builderOf(fixture).config.name = 'X2';
      builderOf(fixture).save();
      expect(proposals(fixture).length).toBe(before);
      expect(proposals(fixture).find((p) => p.id === x.id)?.config.name).toBe('X2');
    });

    it('stays a new concept when a new concept is booked and dismissed', async () => {
      const fixture = await open('/plan');
      const app = fixture.componentInstance;
      const before = proposals(fixture).length;
      app.startBooking(valid());
      await fixture.whenStable();
      app.dismissBooking();
      await fixture.whenStable();
      expect(builderOf(fixture).proposalId()).toBeNull();
      builderOf(fixture).save();
      expect(proposals(fixture).length).toBe(before + 1);
    });

    it('replaces an unchanged builder config with an assistant plan and resets to step 1', async () => {
      const fixture = await open('/plan');
      const app = fixture.componentInstance;
      builderOf(fixture).step.set(3);
      app.applyPlan({ ...emptyConfiguration(), participants: 77 });
      await fixture.whenStable();
      expect(builderOf(fixture).config.participants).toBe(77);
      expect(builderOf(fixture).step()).toBe(1);
      expect(confirmText(fixture)).toBe('');
    });

    it('asks for confirmation before replacing edited work, and confirming replaces it', async () => {
      const fixture = await open('/plan');
      const app = fixture.componentInstance;
      builderOf(fixture).config.name = 'Mijn werk';
      app.applyPlan({ ...emptyConfiguration(), participants: 77 });
      await fixture.whenStable();
      expect(confirmText(fixture)).toContain('Je huidige plan vervangen?');
      expect(builderOf(fixture).config.name).toBe('Mijn werk');
      app.confirmReplace(true);
      await fixture.whenStable();
      expect(builderOf(fixture).config.participants).toBe(77);
      expect(builderOf(fixture).config.name).toBe('');
      expect(confirmText(fixture)).toBe('');
    });

    it('keeps config and edit target when the replacement is cancelled', async () => {
      const { fixture, app, x } = await editX();
      builderOf(fixture).config.name = 'Mijn werk';
      app.applyPlan({ ...emptyConfiguration(), participants: 77 });
      await fixture.whenStable();
      app.confirmReplace(false);
      await fixture.whenStable();
      expect(builderOf(fixture).config.name).toBe('Mijn werk');
      expect(builderOf(fixture).proposalId()).toBe(x.id);
      expect(confirmText(fixture)).toBe('');
    });

    it('saves an applied assistant plan as a new concept and leaves X unchanged', async () => {
      const { fixture, app, x } = await editX();
      const before = proposals(fixture).length;
      app.applyPlan({ ...valid(), name: 'AI plan' });
      await fixture.whenStable();
      expect(builderOf(fixture).proposalId()).toBeNull();
      builderOf(fixture).save();
      expect(proposals(fixture).length).toBe(before + 1);
      expect(proposals(fixture).find((p) => p.id === x.id)?.config.name).toBe('X');
    });

    it('opens the builder with the plan when it is not open yet', async () => {
      const fixture = await open('/');
      fixture.componentInstance.applyPlan({ ...emptyConfiguration(), participants: 55 });
      await fixture.whenStable();
      expect(builderOf(fixture).config.participants).toBe(55);
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
