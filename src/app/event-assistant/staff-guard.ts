import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth-service';
import { EventStore } from './event-store';

/** Only staff may enter /admin. The local demo (no n8n connection) may open its demo portal. */
export const staffGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const store = inject(EventStore);
  const router = inject(Router);
  try {
    // After a hard refresh the Firebase session and staff claim are restored asynchronously.
    await auth.restore();
  } catch {
    /* Without Firebase configuration nobody is signed in. */
  }
  if (auth.staff() || (!store.live() && auth.demoStaff())) return true;
  auth.accessDenied.set(true);
  // Keep the URL fragment: it may carry a private request receipt.
  const home = router.parseUrl('/');
  home.fragment = router.parseUrl(state.url).fragment;
  return home;
};
