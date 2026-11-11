import { AuthService } from './auth-service';
import { Injectable, signal, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class N8nClient {
  readonly auth = inject(AuthService);
  readonly baseUrl = signal('');
  readonly authenticated = signal(false);
  configure(url: string): void {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
    )
      throw new Error('Gebruik een HTTPS n8n-webhook-URL.');
    this.baseUrl.set(url.replace(/\/$/, ''));
  }
  async request<T>(action: string, data: Record<string, unknown> = {}, admin = false): Promise<T> {
    if (!this.baseUrl()) throw new Error('De n8n-verbinding is nog niet ingesteld.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(`${this.baseUrl()}/${admin ? 'admin' : 'public'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(admin || !['catalogue', 'chat'].includes(action)
            ? { Authorization: `Bearer ${await this.auth.token()}` }
            : {}),
        },
        body: JSON.stringify({ action, ...data }),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json'))
        throw new Error('n8n gaf geen JSON terug. Controleer de gepubliceerde webhook-URL.');
      const result = await response.json();
      if (!response.ok || result.error)
        throw new Error(result.error || `n8n-verzoek mislukt (${response.status}).`);
      return result as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError')
        throw new Error(
          'n8n reageert niet op tijd. Probeer opnieuw; de aanvraag gebruikt hetzelfde referentienummer.',
          { cause: error },
        );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  async login(_token: string): Promise<void> {
    void _token;
    try {
      await this.request('session', {}, true);
      this.authenticated.set(true);
    } catch (error) {
      this.logout();
      throw error;
    }
  }
  logout(): void {
    this.authenticated.set(false);
  }
}
