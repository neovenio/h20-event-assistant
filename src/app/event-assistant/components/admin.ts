import { Component, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { filter, map } from 'rxjs';
import { EventStore } from '../event-store';
import {
  Appointment,
  Booking,
  Room,
  CateringPackage,
  EventUpgrade,
  AvailabilityBlock,
  ScrapedSource,
} from '../models';
import { localDate } from '../event-utils';
import { Modal } from './modal';
import { Assistant } from './assistant';
const STALE_CLAIM_MS = 10 * 60 * 1000;
@Component({
  selector: 'app-admin',
  imports: [FormsModule, CurrencyPipe, DatePipe, Modal, Assistant, RouterLink, RouterLinkActive],
  templateUrl: './admin.html',
})
export class Admin {
  readonly store = inject(EventStore);
  readonly selectBooking = output<Booking>();
  readonly newBooking = output<void>();
  readonly logout = output<void>();
  /** Optional explicit sub-tab override; defaults to the active /admin/:section child route. */
  readonly section = input<string>();
  private readonly router = inject(Router, { optional: true });
  private readonly routeUrl = this.router
    ? toSignal(
        this.router.events.pipe(
          filter((event) => event instanceof NavigationEnd),
          map(() => this.router!.url),
        ),
        { initialValue: this.router.url },
      )
    : signal('');
  readonly activeSection = computed(() => {
    const explicit = this.section();
    if (explicit) return explicit;
    const url = this.routeUrl();
    if (!this.router || !url) return 'bookings';
    const segments = this.router.parseUrl(url).root.children['primary']?.segments ?? [];
    return segments[0]?.path === 'admin' ? (segments[1]?.path ?? 'bookings') : 'bookings';
  });
  readonly query = signal('');
  readonly status = signal('');
  readonly roomFilter = signal('');
  readonly selectedDate = signal(localDate());
  readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly tabs = [
    { id: 'bookings', label: 'Alle aanvragen' },
    { id: 'calendar', label: 'Kalender' },
    { id: 'availability', label: 'Beschikbaarheid & Afspraken' },
    { id: 'customers', label: 'Klanten' },
    { id: 'rooms', label: 'Zaalbeheer' },
    { id: 'catering', label: 'Catering & upgrades' },
    { id: 'ai', label: 'AI & verbinding' },
    { id: 'sources', label: 'Brongegevens' },
    { id: 'logs', label: 'Activiteitenlog' },
  ];
  readonly sortedAppointments = computed(() =>
    [...this.store.appointments()].sort((a, b) =>
      `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`),
    ),
  );
  staleAppointmentClaim(a: Appointment): boolean {
    return (
      a.claimStatus === 'claiming' &&
      a.status !== 'cancelled' &&
      a.status !== 'rejected' &&
      !!a.claimCreatedAt &&
      Date.now() - Date.parse(a.claimCreatedAt) > STALE_CLAIM_MS
    );
  }
  appointmentStatusLabel(status: Appointment['status']): string {
    switch (status) {
      case 'confirmed':
        return 'Bevestigd';
      case 'cancelled':
        return 'Geannuleerd';
      case 'rejected':
        return 'Afgewezen';
      default:
        return 'In afwachting';
    }
  }
  changeAppointment(id: string, action: 'confirm' | 'cancel'): void {
    void this.run(() => this.store.changeAppointmentStatus(id, action));
  }
  /** A claim that never reached its final write (see docs/adr/0001-slot-claims.md). */
  staleClaim(b: Booking): boolean {
    return (
      b.claimStatus === 'claiming' &&
      b.requestStatus !== 'rejected' &&
      !['Cancelled', 'Refunded', 'Draft'].includes(b.reservation.bookingStatus) &&
      !!b.claimCreatedAt &&
      Date.now() - Date.parse(b.claimCreatedAt) > STALE_CLAIM_MS
    );
  }
  readonly filtered = computed(() =>
    this.store
      .bookings()
      .filter(
        (b) =>
          (!this.query() ||
            `${b.reference} ${b.customer.fullName} ${b.customer.company} ${b.customer.email} ${b.event.name}`
              .toLowerCase()
              .includes(this.query().toLowerCase())) &&
          (!this.status() || b.reservation.bookingStatus === this.status()) &&
          (!this.roomFilter() || b.event.room.id === this.roomFilter()),
      )
      .sort((a, b) => a.event.date.localeCompare(b.event.date)),
  );
  readonly customers = computed(() => [
    ...new Map(this.store.bookings().map((b) => [b.customer.email, b.customer])).values(),
  ]);
  readonly days = computed(() => {
    const month = this.month();
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return {
        date: localDate(day),
        day: day.getDate(),
        current: day.getMonth() === month.getMonth(),
        bookings: this.store
          .bookings()
          .filter(
            (b) => b.event.date === localDate(day) && b.reservation.bookingStatus !== 'Cancelled',
          ),
        blocks: this.store.blocks().filter((b) => b.date === localDate(day)),
      };
    });
  });
  readonly dayBookings = computed(() =>
    this.store.bookings().filter((b) => b.event.date === this.selectedDate()),
  );
  editRoom: Room | null = null;
  editCatering: CateringPackage | null = null;
  editUpgrade: EventUpgrade | null = null;
  error = '';
  success = '';
  busy = false;
  block = {
    roomId: '',
    date: localDate(),
    startTime: '09:00',
    endTime: '17:00',
    reason: '',
    type: 'Admin Block' as AvailabilityBlock['type'],
  };
  readonly statuses = [
    'Draft',
    'Awaiting Availability',
    'Awaiting Approval',
    'Awaiting Payment',
    'Paid',
    'Confirmed',
    'Cancelled',
    'Refunded',
  ];
  publish(source: ScrapedSource): void {
    void this.run(() => this.store.publishSource(source));
  }
  async run(work: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      await work();
      this.success = 'Opgeslagen.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'De actie is mislukt.';
    } finally {
      this.busy = false;
    }
  }
  refresh(): void {
    if (this.store.live()) void this.run(() => this.store.refreshAdmin());
  }
  shiftMonth(change: number): void {
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() + change, 1));
  }
  customerBookings(email: string): Booking[] {
    return this.store.bookings().filter((b) => b.customer.email === email);
  }
  openRoom(room: Room): void {
    this.editRoom = JSON.parse(JSON.stringify(room));
  }
  saveRoom(): void {
    const room = this.editRoom;
    if (room)
      void this.run(async () => {
        await this.store.updateRoom(room);
        this.editRoom = null;
      });
  }
  createBlock(): void {
    void this.run(async () => {
      const room = this.store.rooms().find((r) => r.id === this.block.roomId);
      if (!room) throw new Error('Selecteer een zaal.');
      await this.store.addBlock({ ...this.block, roomName: room.name });
      this.block.reason = '';
    });
  }
  deleteBlock(id: string): void {
    void this.run(() => this.store.deleteBlock(id));
  }
  openCatering(item: CateringPackage): void {
    this.editCatering = { ...item };
  }
  openUpgrade(item: EventUpgrade): void {
    this.editUpgrade = { ...item };
  }
  newCatering(): void {
    this.editCatering = {
      id: this.store.id(),
      name: '',
      category: 'Breakfast and lunch',
      categoryDutch: 'Ontbijt & Lunch',
      description: '',
      pricePerPerson: null,
      priceDisplay: 'Prijs op aanvraag',
      status: 'Subject to Confirmation',
      isOfficialH20: false,
      isActive: true,
    };
  }
  newUpgrade(): void {
    this.editUpgrade = {
      id: this.store.id(),
      name: '',
      category: 'Event upgrade',
      description: '',
      price: null,
      priceDisplay: 'Prijs op aanvraag',
      status: 'Subject to Confirmation',
      isStandardFacility: false,
      requiresAvailabilityConfirmation: true,
      isActive: true,
    };
  }
  saveCatering(): void {
    const item = this.editCatering;
    if (item)
      void this.run(async () => {
        item.priceDisplay =
          item.pricePerPerson == null
            ? 'Prijs op aanvraag'
            : `€ ${item.pricePerPerson} per persoon`;
        await this.store.saveCatering(item);
        this.editCatering = null;
      });
  }
  saveUpgrade(): void {
    const item = this.editUpgrade;
    if (item)
      void this.run(async () => {
        item.priceDisplay = item.price == null ? 'Prijs op aanvraag' : `€ ${item.price}`;
        await this.store.saveUpgrade(item);
        this.editUpgrade = null;
      });
  }
  deleteItem(id: string, type: 'catering' | 'upgrade'): void {
    void this.run(() => this.store.deleteCatalogue(id, type));
  }
  exportCsv(): void {
    const rows = [
      ['Referentie', 'Evenement', 'Datum', 'Klant', 'Status', 'Indicatie EUR'],
      ...this.filtered().map((b) => [
        b.reference,
        b.event.name,
        b.event.date,
        b.customer.fullName,
        b.reservation.bookingStatus,
        String(b.financial.totalPrice),
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map(
            (value) =>
              '"' + (/^[=+@\-\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""') + '"',
          )
          .join(';'),
      )
      .join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'h20-aanvragen.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
