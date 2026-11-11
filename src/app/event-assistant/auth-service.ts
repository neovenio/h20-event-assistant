import { Injectable, signal } from '@angular/core';
import type { Auth, User } from 'firebase/auth';
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(null);
  readonly staff = signal(false);
  /** Local demo only: opens the demo staff portal when no n8n backend is configured. */
  readonly demoStaff = signal(false);
  /** Set by the staff route guard so the shell can prompt for a login. */
  readonly accessDenied = signal(false);
  private claims: Promise<void> = Promise.resolve();
  private instance: Promise<Auth> | null = null;
  async restore(): Promise<void> {
    await this.auth();
  }
  private async auth(): Promise<Auth> {
    if (!this.instance)
      this.instance = this.initialize().catch((error) => {
        this.instance = null;
        throw error;
      });
    return this.instance;
  }
  private async initialize(): Promise<Auth> {
    const response = await fetch('/h20-runtime.json');
    const settings = await response.json();
    if (!settings.firebase?.apiKey)
      throw new Error('Firebase Authentication is nog niet geconfigureerd.');
    const [
      { initializeApp, getApps },
      { getAuth, onIdTokenChanged, browserSessionPersistence, setPersistence },
    ] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    const app =
      getApps().find((app) => app.name === 'h20-auth') ??
      initializeApp(settings.firebase, 'h20-auth');
    const auth = getAuth(app);
    await setPersistence(auth, browserSessionPersistence);
    onIdTokenChanged(auth, (user) => {
      this.user.set(user);
      this.staff.set(false);
      this.claims = (async () => {
        if (!user) return;
        try {
          const token = await user.getIdTokenResult();
          if (this.user() === user) this.staff.set(token.claims['staff'] === true);
        } catch {
          // Keep staff access disabled when the refreshed claims cannot be verified.
          if (this.user() === user) this.staff.set(false);
        }
      })();
    });
    await auth.authStateReady();
    await this.claims;
    return auth;
  }
  async signIn(email: string, password: string): Promise<void> {
    const auth = await this.auth();
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    const result = await signInWithEmailAndPassword(auth, email, password);
    this.user.set(result.user);
    this.staff.set((await result.user.getIdTokenResult()).claims['staff'] === true);
  }
  async register(email: string, password: string): Promise<void> {
    const auth = await this.auth();
    const { createUserWithEmailAndPassword } = await import('firebase/auth');
    const result = await createUserWithEmailAndPassword(auth, email, password);
    this.user.set(result.user);
    this.staff.set(false);
  }
  async token(): Promise<string> {
    const auth = await this.auth();
    if (!auth.currentUser) throw new Error('Log eerst in.');
    return auth.currentUser.getIdToken();
  }
  async resetPassword(email: string): Promise<void> {
    const auth = await this.auth();
    const { sendPasswordResetEmail } = await import('firebase/auth');
    await sendPasswordResetEmail(auth, email);
  }
  async logout(): Promise<void> {
    if (this.instance) {
      const { signOut } = await import('firebase/auth');
      await signOut(await this.instance);
    }
    this.user.set(null);
    this.staff.set(false);
    this.demoStaff.set(false);
  }
}
