import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { vi } from 'vitest';
import { App } from './app';
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
