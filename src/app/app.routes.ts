import { Routes } from '@angular/router';
import { staffGuard } from './event-assistant/staff-guard';

/** Page ids mapped to their route path. The app shell renders the page that matches the URL. */
export const PAGE_PATHS = {
  dashboard: '',
  'event-builder': 'plan',
  'my-proposals': 'my-proposals',
  knowledge: 'knowledge',
  rooms: 'rooms',
  activities: 'activities',
  catering: 'catering',
  admin: 'admin',
} as const;

export type Page = keyof typeof PAGE_PATHS;

export const ADMIN_SECTIONS = [
  'bookings',
  'calendar',
  'availability',
  'customers',
  'rooms',
  'catering',
  'ai',
  'sources',
  'logs',
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export function pageForPath(path: string | undefined): Page {
  return (
    (Object.keys(PAGE_PATHS) as Page[]).find((page) => PAGE_PATHS[page] === (path ?? '')) ??
    'dashboard'
  );
}

// The shell (App) renders every page itself, so routes carry no components.
export const routes: Routes = [
  { path: '', pathMatch: 'full', children: [] },
  ...(
    ['event-builder', 'my-proposals', 'knowledge', 'rooms', 'activities', 'catering'] as const
  ).map((page) => ({ path: PAGE_PATHS[page], children: [] })),
  {
    path: PAGE_PATHS.admin,
    canActivate: [staffGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: ADMIN_SECTIONS[0] },
      ...ADMIN_SECTIONS.map((section) => ({ path: section, children: [] })),
      { path: '**', redirectTo: ADMIN_SECTIONS[0] },
    ],
  },
  { path: '**', redirectTo: '' },
];
