import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    // The staff portal depends on a signed-in session, so it is never prerendered.
    // Firebase Hosting serves index.csr.html for it (see the rewrite in firebase.json).
    path: 'admin/**',
    renderMode: RenderMode.Client,
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
