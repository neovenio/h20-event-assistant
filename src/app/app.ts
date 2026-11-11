import { AuthService } from './event-assistant/auth-service';
import { Component, afterNextRender, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { Admin } from './event-assistant/components/admin';
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
    Admin,
    Icon,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly auth = inject(AuthService);
  authEmail = '';
  authPassword = '';
  registering = false;
  readonly store = inject(EventStore);
  readonly tab = signal('dashboard');
  readonly mobile = signal(false);
  readonly collapsed = signal(false);
  readonly admin = signal(false);
  readonly navigation = [
    { id: 'dashboard', label: 'Dashboard', icon: '▦' },
    { id: 'event-builder', label: 'Event Builder', icon: '＋' },
    { id: 'my-proposals', label: 'Mijn Voorstellen', icon: '▤' },
    { id: 'knowledge', label: 'Kennisbank', icon: '▧' },
    { id: 'rooms', label: 'Zalen', icon: '▥' },
    { id: 'activities', label: 'Activiteiten', icon: '⌘' },
    { id: 'catering', label: 'Catering', icon: '♧' },
  ];
  builder = false;
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
  constructor() {
    afterNextRender(async () => {
      try {
        await this.auth.restore();
        if (this.auth.user() && this.store.live()) {
          const result = await this.store.api.request<{ bookings: Booking[] }>('my-requests');
          this.store.bookings.set(result.bookings);
          this.store.ownBookingIds.set(result.bookings.map((b) => b.id));
        }
      } catch {
        /* Missing configuration keeps the local demo available. */
      }

      const params = new URLSearchParams(location.hash.slice(1));
      const id = params.get('request');
      const token = params.get('token');
      if (id && token) {
        try {
          const response = await fetch('/h20-runtime.json');
          const config = await response.json();
          if (!config.n8nWebhookBaseUrl)
            throw new Error('De n8n-verbinding is nog niet ingesteld.');
          this.store.api.configure(config.n8nWebhookBaseUrl);
          this.selectedBooking = await this.store.lookup(id, token);
        } catch (error) {
          this.notice =
            error instanceof Error ? error.message : 'De aanvraag kon niet worden geopend.';
        }
      }
    });
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
  navigate(id: string): void {
    this.mobile.set(false);
    if (id === 'event-builder') this.openBuilder();
    else this.tab.set(id);
  }
  openBuilder(config: EventConfiguration | null = null, proposalId: string | null = null): void {
    this.editingProposalId = proposalId;
    this.builderConfig = config;
    this.builder = true;
    this.chat = false;
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
    this.builder = false;
    this.bookingConfig = config;
  }
  created(booking: Booking): void {
    this.bookingConfig = null;
    this.tab.set('my-proposals');
    this.notice = this.store.live()
      ? 'Je aanvraag is ontvangen en wacht op beoordeling. Bewaar je persoonlijke link hieronder.'
      : 'Je demoaanvraag is in deze browser opgeslagen. Er is niets verzonden.';
    this.receipt = this.store.live() ? this.store.receiptLink(booking.id) : '';
  }
  async signIn(): Promise<void> {
    this.admin.set(false);
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
      this.tab.set('my-proposals');
      if (this.store.live()) {
        const result = await this.store.api.request<{ bookings: Booking[] }>('my-requests');
        this.store.bookings.set(result.bookings);
        this.store.ownBookingIds.set(result.bookings.map((b) => b.id));
      }
      if (this.auth.staff() && this.store.live()) {
        await this.store.refreshAdmin();
        this.admin.set(true);
        this.tab.set('admin');
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
    this.admin.set(true);
    this.login = false;
    this.tab.set('admin');
  }
  logout(): void {
    void this.auth.logout();
    this.store.logout();
    this.admin.set(false);
    this.tab.set('dashboard');
  }
}
