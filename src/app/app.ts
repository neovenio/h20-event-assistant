import { AuthService } from './event-assistant/auth-service';
import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OutputRef,
  OutputRefSubscription,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { PAGE_PATHS, pageForPath } from './app.routes';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { EventStore } from './event-assistant/event-store';
import { Booking, EventConfiguration, Room } from './event-assistant/models';
import { emptyConfiguration } from './event-assistant/event-utils';
import { EventBuilder } from './event-assistant/components/event-builder';
import { BookingForm } from './event-assistant/components/booking-form';
import { BookingDetail } from './event-assistant/components/booking-detail';
import { Modal } from './event-assistant/components/modal';
import { Assistant } from './event-assistant/components/assistant';
import { Icon } from './event-assistant/components/icon';
interface AdminPortal {
  selectBooking: OutputRef<Booking>;
  newBooking: OutputRef<void>;
  logout: OutputRef<void>;
}
interface BuilderHandle {
  baseline: string;
  dirty(): boolean;
}
@Component({
  selector: 'app-root',
  imports: [
    FormsModule,
    CurrencyPipe,
    DatePipe,
    EventBuilder,
    BookingForm,
    BookingDetail,
    Modal,
    Assistant,
    Icon,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnDestroy {
  readonly auth = inject(AuthService);
  authEmail = '';
  authPassword = '';
  registering = false;
  readonly store = inject(EventStore);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  private readonly urlTree = computed(() => this.router.parseUrl(this.url()));
  private readonly segments = computed(() =>
    (this.urlTree().root.children['primary']?.segments ?? []).map((segment) => segment.path),
  );
  readonly tab = computed(() => pageForPath(this.segments()[0]));
  /** The page rendered behind the event builder, which opens as an overlay on /plan. */
  readonly page = computed(() => (this.tab() === 'event-builder' ? 'dashboard' : this.tab()));
  readonly mobile = signal(false);
  readonly collapsed = signal(false);
  readonly admin = computed(
    () => this.auth.staff() || (!this.store.live() && this.auth.demoStaff()),
  );
  readonly path = PAGE_PATHS;
  readonly navigation = [
    { id: 'dashboard', label: 'Dashboard', icon: '▦' },
    { id: 'event-builder', label: 'Event Builder', icon: '＋' },
    { id: 'my-proposals', label: 'Mijn Voorstellen', icon: '▤' },
    { id: 'knowledge', label: 'Kennisbank', icon: '▧' },
    { id: 'rooms', label: 'Zalen', icon: '▥' },
    { id: 'activities', label: 'Activiteiten', icon: '⌘' },
    { id: 'catering', label: 'Catering', icon: '♧' },
  ] as const;
  readonly builder = signal(false);
  editingProposalId: string | null = null;
  builderConfig: EventConfiguration | null = null;
  bookingConfig: EventConfiguration | null = null;
  selectedRoom: Room | null = null;
  selectedBooking: Booking | null = null;
  chat = false;
  login = false;
  staffToken = '';
  loginError = '';
  loginBusy = false;
  notice = '';
  roomQuery = '';
  minCapacity = 0;
  receipt = '';
  builderKey = 0;
  builderBaseline: string | null = null;
  private bookingBaseline: string | null = null;
  replacePlan: { config: EventConfiguration | null } | null = null;
  private bookingProposalId: string | null = null;
  private readonly builderRef = viewChild<BuilderHandle>('builderRef');
  private builderRequested = false;
  private receiptReady = false;
  private openedReceipt = '';
  constructor() {
    effect(() => {
      if (this.tab() === 'event-builder') {
        // Entering /plan without openBuilder() (nav link, back/forward) starts a fresh concept.
        if (!this.builderRequested) this.resetBuilderState();
        this.builderRequested = false;
        this.builder.set(true);
      } else {
        this.builder.set(false);
        this.bookingConfig = null;
        this.replacePlan = null;
        this.builderRequested = false;
        this.resetBuilderState();
      }
    });
    effect(() => {
      if (!this.auth.accessDenied()) return;
      this.auth.accessDenied.set(false);
      if (this.auth.user()) this.notice = 'Je hebt geen toegang tot het medewerkersportaal.';
      else this.login = true;
      this.cdr.markForCheck();
    });
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => void this.openReceipt());
    afterNextRender(async () => {
      try {
        await this.auth.restore();
        if (this.auth.user() && this.store.live()) {
          const result = await this.store.api.request<{ bookings: Booking[] }>('my-requests');
          this.store.bookings.set(result.bookings);
          this.store.ownBookingIds.set(result.bookings.map((b) => b.id));
          // A hard refresh on /admin restores the staff session; load the staff data too.
          if (this.auth.staff()) await this.store.refreshAdmin();
        }
      } catch {
        /* Missing configuration keeps the local demo available. */
      }

      this.receiptReady = true;
      await this.openReceipt();
    });
  }
  /** Private receipts travel in the URL fragment only; it never reaches server logs. */
  private async openReceipt(): Promise<void> {
    if (!this.receiptReady) return;
    const params = new URLSearchParams(this.router.parseUrl(this.router.url).fragment ?? '');
    const id = params.get('request');
    const token = params.get('token');
    if (!id || !token || this.openedReceipt === `${id}#${token}`) return;
    this.openedReceipt = `${id}#${token}`;
    try {
      const response = await fetch('/h20-runtime.json');
      const config = await response.json();
      if (!config.n8nWebhookBaseUrl) throw new Error('De n8n-verbinding is nog niet ingesteld.');
      this.store.api.configure(config.n8nWebhookBaseUrl);
      this.selectedBooking = await this.store.lookup(id, token);
    } catch (error) {
      this.notice = error instanceof Error ? error.message : 'De aanvraag kon niet worden geopend.';
    }
    this.cdr.markForCheck();
  }
  get visibleRooms(): Room[] {
    return this.store
      .activeRooms()
      .filter(
        (room) =>
          room.name.toLowerCase().includes(this.roomQuery.toLowerCase()) &&
          (!this.minCapacity || !room.maxCapacity || room.maxCapacity >= this.minCapacity),
      );
  }
  openBuilder(config: EventConfiguration | null = null, proposalId: string | null = null): void {
    this.editingProposalId = proposalId;
    this.builderConfig = config;
    this.builderBaseline = null;
    this.builderRequested = true;
    this.builder.set(true);
    this.chat = false;
    void this.router.navigateByUrl('/' + PAGE_PATHS['event-builder']);
  }
  /** Assistant plan: replaces an open builder (after confirming unsaved edits) or opens one. */
  applyPlan(config: EventConfiguration | null): void {
    const builder = this.builderRef();
    this.bookingConfig = null;
    this.bookingProposalId = null;
    this.bookingBaseline = null;
    if (!this.builder() || !builder) return this.openBuilder(config);
    this.chat = false;
    if (builder.dirty()) this.replacePlan = { config };
    else this.replaceBuilder(config);
    this.cdr.markForCheck();
  }
  confirmReplace(accepted: boolean): void {
    const pending = this.replacePlan;
    this.replacePlan = null;
    if (accepted && pending) this.replaceBuilder(pending.config);
    this.cdr.markForCheck();
  }
  private replaceBuilder(config: EventConfiguration | null): void {
    this.editingProposalId = null;
    this.builderConfig = config;
    this.builderBaseline = null;
    this.builderKey++;
  }
  dismissBooking(): void {
    const config = this.bookingConfig;
    this.bookingConfig = null;
    this.openBuilder(config, this.bookingProposalId);
    this.builderBaseline = this.bookingBaseline;
  }
  private resetBuilderState(): void {
    this.editingProposalId = null;
    this.builderConfig = null;
    this.builderBaseline = null;
  }
  closeBuilder(): void {
    this.resetBuilderState();
    this.builder.set(false);
    if (this.tab() === 'event-builder') void this.router.navigateByUrl('/');
  }
  go(path: string, notice?: string): void {
    this.mobile.set(false);
    if (notice !== undefined) this.notice = notice;
    void this.router.navigateByUrl(path);
  }
  bookRoom(room: Room): void {
    this.selectedRoom = null;
    this.openBuilder({
      ...emptyConfiguration(),
      selectedRoomId: room.id,
      selectedRoomName: room.name,
    });
  }
  startBooking(config: EventConfiguration): void {
    this.builder.set(false);
    this.bookingProposalId = this.editingProposalId;
    this.bookingBaseline = this.builderRef()?.baseline ?? null;
    this.bookingConfig = config;
  }
  created(booking: Booking): void {
    this.bookingConfig = null;
    void this.router.navigateByUrl('/' + PAGE_PATHS['my-proposals']);
    this.notice = this.store.live()
      ? 'Je aanvraag is ontvangen en wacht op beoordeling. Bewaar je persoonlijke link hieronder.'
      : 'Je demoaanvraag is in deze browser opgeslagen. Er is niets verzonden.';
    this.receipt = this.store.live() ? this.store.receiptLink(booking.id) : '';
  }
  async signIn(): Promise<void> {
    this.auth.demoStaff.set(false);
    if (this.store.live()) {
      this.store.bookings.set([]);
      this.store.ownBookingIds.set([]);
    }
    this.loginBusy = true;
    this.loginError = '';
    try {
      if (this.registering) await this.auth.register(this.authEmail, this.authPassword);
      else await this.auth.signIn(this.authEmail, this.authPassword);
      this.authPassword = '';
      this.login = false;
      void this.router.navigateByUrl('/' + PAGE_PATHS['my-proposals']);
      if (this.store.live()) {
        const result = await this.store.api.request<{ bookings: Booking[] }>('my-requests');
        this.store.bookings.set(result.bookings);
        this.store.ownBookingIds.set(result.bookings.map((b) => b.id));
      }
      if (this.auth.staff() && this.store.live()) {
        await this.store.refreshAdmin();
        void this.router.navigateByUrl('/' + PAGE_PATHS.admin);
      }
    } catch {
      this.loginError =
        'Inloggen of ophalen van aanvragen is mislukt. Controleer je gegevens en de verbinding.';
      this.login = true;
    } finally {
      this.loginBusy = false;
    }
  }
  async resetPassword(): Promise<void> {
    this.loginBusy = true;
    try {
      await this.auth.resetPassword(this.authEmail);
      this.loginError = 'Als er een account bestaat, ontvang je een herstelbericht.';
    } catch {
      this.loginError = 'Het herstelverzoek kon niet worden verwerkt.';
    } finally {
      this.loginBusy = false;
    }
  }
  demoAdmin(): void {
    this.auth.demoStaff.set(true);
    this.login = false;
    void this.router.navigateByUrl('/' + PAGE_PATHS.admin);
  }
  private adminSubscriptions: OutputRefSubscription[] = [];
  attachAdmin(component: unknown): void {
    this.detachAdmin();
    const portal = component as AdminPortal;
    this.adminSubscriptions = [
      portal.selectBooking.subscribe((booking) => {
        this.selectedBooking = booking;
        this.cdr.markForCheck();
      }),
      portal.newBooking.subscribe(() => this.openBuilder()),
      portal.logout.subscribe(() => this.logout()),
    ];
  }
  detachAdmin(): void {
    for (const sub of this.adminSubscriptions) sub.unsubscribe();
    this.adminSubscriptions = [];
  }
  ngOnDestroy(): void {
    this.detachAdmin();
  }
  logout(): void {
    void this.auth.logout();
    this.store.logout();
    this.auth.demoStaff.set(false);
    void this.router.navigateByUrl('/');
  }
}
