import { TestBed } from '@angular/core/testing';
import type { User } from 'firebase/auth';
import { vi } from 'vitest';
import { AuthService } from '../auth-service';
import { EventStore } from '../event-store';
import { emptyConfiguration } from '../event-utils';
import { Assistant } from './assistant';

describe('Assistant', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ n8nWebhookBaseUrl: '' }) }),
    );
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('works in local demo mode without signing in', async () => {
    const fixture = TestBed.createComponent(Assistant);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain(
      'Log in met je H20-account om met de live AI-assistent te chatten.',
    );

    await fixture.componentInstance.send('Teambuilding voor 30 personen');
    fixture.detectChanges();

    expect(fixture.componentInstance.messages().length).toBe(3);
    expect(fixture.componentInstance.plan()?.participants).toBe(30);
  });

  it('prompts for sign-in and blocks live chat requests when logged out in live mode', async () => {
    const store = TestBed.inject(EventStore);
    store.api.configure('https://example.test/webhook/h20');
    const requestSpy = vi.spyOn(store.api, 'request');

    const fixture = TestBed.createComponent(Assistant);
    let loginRequested = 0;
    fixture.componentInstance.requestLogin.subscribe(() => loginRequested++);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain(
      'Log in met je H20-account om met de live AI-assistent te chatten.',
    );
    const input = el.querySelector('#chat-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);

    const loginButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Inloggen om te chatten'),
    );
    expect(loginButton).toBeTruthy();
    loginButton!.click();
    expect(loginRequested).toBe(1);

    await fixture.componentInstance.send('Hallo');
    expect(loginRequested).toBe(2);
    expect(requestSpy).not.toHaveBeenCalled();
    expect(fixture.componentInstance.messages().length).toBe(1);
  });

  it('sends live chat requests when signed in during live mode', async () => {
    const store = TestBed.inject(EventStore);
    const auth = TestBed.inject(AuthService);
    store.api.configure('https://example.test/webhook/h20');
    auth.user.set({ uid: 'customer-1', email: 'klant@example.test' } as User);

    const suggested = { ...emptyConfiguration(), participants: 45, selectedRoomId: 'stadium' };
    const requestSpy = vi
      .spyOn(store.api, 'request')
      .mockResolvedValue({ reply: 'Ik raad het Stadium aan.', config: suggested });

    const fixture = TestBed.createComponent(Assistant);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain(
      'Log in met je H20-account om met de live AI-assistent te chatten.',
    );

    await fixture.componentInstance.send('Bedrijfsevent voor 45 personen');
    fixture.detectChanges();

    expect(requestSpy).toHaveBeenCalledWith('chat', {
      message: 'Bedrijfsevent voor 45 personen',
      currentEventConfig: null,
    });
    expect(fixture.componentInstance.messages().at(-1)?.text).toBe('Ik raad het Stadium aan.');
    expect(fixture.componentInstance.plan()?.participants).toBe(45);
  });
});
