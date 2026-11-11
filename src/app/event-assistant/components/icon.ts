import { Component, input } from '@angular/core';
@Component({
  selector: 'app-icon',
  template: `<svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path [attr.d]="paths[name()] || paths['dashboard']" />
  </svg>`,
  styles: ':host{display:inline-flex;align-items:center;vertical-align:middle}',
})
export class Icon {
  readonly name = input('dashboard');
  readonly paths: Record<string, string> = {
    dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    'event-builder': 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M12 13v5 M9.5 15.5h5',
    'my-proposals': 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
    knowledge: 'M12 5C8 3 5 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-6-1-10 1z M12 5v15',
    rooms: 'M4 21V3h16v18 M2 21h20 M8 7h2 M14 7h2 M8 11h2 M14 11h2 M10 21v-6h4v6',
    activities:
      'M7 7h10c3 0 5 9 3 10-2 1-4-3-5-3H9c-1 0-3 4-5 3-2-1 0-10 3-10z M7 9v4 M5 11h4 M16 10h.1 M18 12h.1',
    catering: 'M4 3v6c0 3 6 3 6 0V3 M7 3v18 M19 3c-4 2-4 8 0 9V3v18',
    admin: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
    menu: 'M3 6h18 M3 12h18 M3 18h18',
  };
}
