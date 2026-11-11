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
});
