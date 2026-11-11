import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from './auth-service';
import { N8nClient } from './n8n-client';
describe('n8n client', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { token: async () => 'test-token' } }],
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('rejects insecure remote URLs', () => {
    const client = TestBed.inject(N8nClient);
    expect(() => client.configure('http://remote.example.test/webhook/h20')).toThrow();
  });
  it('surfaces server errors instead of reporting a successful booking', async () => {
    const client = TestBed.inject(N8nClient);
    client.configure('https://example.test/webhook/h20');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Deze zaal is bezet.' }),
      }),
    );
    await expect(client.request('event-request')).rejects.toThrow('Deze zaal is bezet.');
  });
  it('requires successful server authentication and clears a rejected token', async () => {
    const client = TestBed.inject(N8nClient);
    client.configure('https://example.test/webhook/h20');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Unauthorized' }),
      }),
    );
    await expect(client.login('invalid')).rejects.toThrow();
    expect(client.authenticated()).toBe(false);
  });
  it('attaches Firebase Bearer token to chat requests while keeping catalogue public', async () => {
    const client = TestBed.inject(N8nClient);
    client.configure('https://example.test/webhook/h20');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ reply: 'Hallo', rooms: [], catering: [], upgrades: [], activities: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await client.request('catalogue');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    await client.request('chat', { message: 'Hallo' });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer test-token');
  });
  it('omits Authorization header for public appointment-slots action and includes it for book-appointment', async () => {
    const tokenSpy = vi.fn().mockResolvedValue('customer-jwt');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { token: tokenSpy } }],
    });
    const client = TestBed.inject(N8nClient);
    client.configure('https://example.test/webhook/h20');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ date: '2099-01-05', slots: [] }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await client.request('appointment-slots', { date: '2099-01-05' });
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBeUndefined();

    await client.request('book-appointment', { date: '2099-01-05' });
    expect(tokenSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[1][1].headers.Authorization).toBe('Bearer customer-jwt');
  });
});
