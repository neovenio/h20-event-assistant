import { Injectable, afterNextRender, computed, signal, inject } from '@angular/core';
import {
  INITIAL_ROOMS,
  INITIAL_BOOKINGS,
  INITIAL_AVAILABILITY_BLOCKS,
  INITIAL_ACTIVITY_LOGS,
  INITIAL_CATERING_PACKAGES,
  INITIAL_EVENT_UPGRADES,
} from './data/initial-data';
import {
  ActivityLog,
  AvailabilityBlock,
  Booking,
  CateringPackage,
  EventConfiguration,
  EventUpgrade,
  ProposalItem,
  Room,
  ActivityOption,
  ScrapedSource,
} from './models';
import { N8nClient } from './n8n-client';
import { ACTIVITIES, bookingRoomIds, conflict, duration, estimate, localDate } from './event-utils';

const STORAGE_KEY = 'h20-angular-demo-v1';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
interface DemoState {
  rooms: Room[];
  bookings: Booking[];
  blocks: AvailabilityBlock[];
  logs: ActivityLog[];
  catering: CateringPackage[];
  upgrades: EventUpgrade[];
  proposals: ProposalItem[];
  ownBookingIds: string[];
}

@Injectable({ providedIn: 'root' })
export class EventStore {
  readonly api = inject(N8nClient);
  readonly live = computed(() => !!this.api.baseUrl());
  readonly connectionError = signal('');
  readonly loading = signal(true);
  readonly activities = signal<ActivityOption[]>(ACTIVITIES);
  readonly sources = signal<ScrapedSource[]>([]);
  private pendingRequest: { signature: string; requestId: string; customerToken: string } | null =
    null;
  private receipts: Record<string, string> = {};
  readonly rooms = signal(clone(INITIAL_ROOMS));
  readonly bookings = signal(clone(INITIAL_BOOKINGS));
  readonly blocks = signal(clone(INITIAL_AVAILABILITY_BLOCKS));
  readonly logs = signal(clone(INITIAL_ACTIVITY_LOGS));
  readonly catering = signal(clone(INITIAL_CATERING_PACKAGES));
  readonly upgrades = signal(clone(INITIAL_EVENT_UPGRADES));
  readonly proposals = signal<ProposalItem[]>([]);
  readonly ownBookingIds = signal<string[]>([]);
  readonly storageWarning = signal('');
  readonly activeRooms = computed(() => this.rooms().filter((room) => room.isActive));
  readonly ownBookings = computed(() =>
    this.bookings().filter((booking) => this.ownBookingIds().includes(booking.id)),
  );
  private browserReady = false;

  constructor() {
    afterNextRender(async () => {
      this.browserReady = true;
      try {
        const response = await fetch('/h20-runtime.json');
        if (!response.ok) throw new Error('Runtime-instellingen konden niet worden geladen.');
        const settings = await response.json();
        if (settings.n8nWebhookBaseUrl) {
          this.api.configure(settings.n8nWebhookBaseUrl);
          this.activities.set([]);
          this.rooms.set([]);
          this.bookings.set([]);
          this.blocks.set([]);
          this.logs.set([]);
          this.catering.set([]);
          this.upgrades.set([]);
          await this.refreshCatalogue();
          this.loading.set(false);
          return;
        }
      } catch (error) {
        this.connectionError.set(
          error instanceof Error ? error.message : 'De verbinding is mislukt.',
        );
        if (this.live()) {
          this.loading.set(false);
          return;
        }
      }
      this.loading.set(false);
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const value = JSON.parse(raw) as DemoState;
        if (!this.validState(value)) throw new Error('Invalid saved demo');
        this.rooms.set(value.rooms);
        this.bookings.set(value.bookings);
        this.blocks.set(value.blocks);
        this.logs.set(value.logs);
        this.catering.set(value.catering);
        this.upgrades.set(value.upgrades);
        this.proposals.set(value.proposals);
        this.ownBookingIds.set(value.ownBookingIds);
      } catch {
        this.storageWarning.set(
          'Opgeslagen demogegevens konden niet worden geladen. Deze sessie gebruikt de voorbeeldgegevens.',
        );
      }
    });
  }
  private validState(value: DemoState): boolean {
    return (
      !!value &&
      [
        'rooms',
        'bookings',
        'blocks',
        'logs',
        'catering',
        'upgrades',
        'proposals',
        'ownBookingIds',
      ].every((key) => Array.isArray(value[key as keyof DemoState])) &&
      value.rooms.every((room) => typeof room.id === 'string' && Array.isArray(room.facilities)) &&
      value.bookings.every(
        (booking) =>
          !!booking.customer?.billingAddress &&
          !!booking.event?.room &&
          !!booking.reservation &&
          Array.isArray(booking.reservation.internalNotes) &&
          !!booking.financial &&
          !!booking.selections,
      ) &&
      value.proposals.every(
        (proposal) => !!proposal.config?.selectedActivities && !!proposal.config?.additionalRooms,
      )
    );
  }
  private persist(): void {
    if (!this.browserReady || this.live()) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          rooms: this.rooms(),
          bookings: this.bookings(),
          blocks: this.blocks(),
          logs: this.logs(),
          catering: this.catering(),
          upgrades: this.upgrades(),
          proposals: this.proposals(),
          ownBookingIds: this.ownBookingIds(),
        } satisfies DemoState),
      );
      this.storageWarning.set('');
    } catch {
      this.storageWarning.set(
        'Opslaan in deze browser is niet mogelijk. Wijzigingen blijven alleen in deze sessie bewaard.',
      );
    }
  }
  private log(action: string, relatedItem: string, previousValue = '', newValue = ''): void {
    this.logs.update((items) => [
      {
        id: this.id(),
        admin: 'Demo beheerder',
        action,
        previousValue,
        newValue,
        relatedItem,
        timestamp: new Date().toISOString(),
      },
      ...items,
    ]);
    this.persist();
  }
  async publishSource(source: ScrapedSource): Promise<void> {
    if (!source.suggestedItem) throw new Error('Deze bron heeft geen catalogusvoorstel.');
    await this.api.request(
      'save-catalogue',
      { kind: source.catalogueKind, item: { ...source.suggestedItem, isActive: true } },
      true,
    );
    await this.refreshAdmin();
  }
  async refreshCatalogue(): Promise<void> {
    const data = await this.api.request<{
      rooms: Room[];
      catering: CateringPackage[];
      upgrades: EventUpgrade[];
      activities: ActivityOption[];
    }>('catalogue');
    if (
      !Array.isArray(data.rooms) ||
      !Array.isArray(data.catering) ||
      !Array.isArray(data.upgrades)
    )
      throw new Error('De n8n-catalogus heeft een onverwacht formaat.');
    this.rooms.set(data.rooms);
    this.catering.set(data.catering);
    this.upgrades.set(data.upgrades);
    this.activities.set(data.activities ?? []);
    this.connectionError.set('');
  }
  async refreshAdmin(): Promise<void> {
    const data = await this.api.request<
      DemoState & { sources: ScrapedSource[]; activities: ActivityOption[] }
    >('snapshot', {}, true);
    if (
      ![data.bookings, data.blocks, data.logs, data.rooms, data.catering, data.upgrades].every(
        Array.isArray,
      )
    )
      throw new Error('Ongeldig antwoord van n8n.');
    this.bookings.set(data.bookings);
    this.blocks.set(data.blocks);
    this.logs.set(data.logs);
    this.rooms.set(data.rooms);
    this.catering.set(data.catering);
    this.upgrades.set(data.upgrades);
    this.sources.set(data.sources ?? []);
    this.activities.set(data.activities ?? []);
  }
  async login(token: string): Promise<void> {
    await this.api.login(token);
    await this.refreshAdmin();
  }
  logout(): void {
    this.api.logout();
    if (this.live()) {
      this.bookings.set([]);
      this.blocks.set([]);
      this.logs.set([]);
    }
  }
  receiptLink(id: string): string {
    return this.receipts[id]
      ? `${location.origin}/#request=${encodeURIComponent(id)}&token=${encodeURIComponent(this.receipts[id])}`
      : '';
  }
  async lookup(id: string, token: string): Promise<Booking> {
    const response = await this.api.request<{ booking: Booking }>('lookup', { id, token });
    return response.booking;
  }
  async saveReview(id: string, explanation: string, reviewNotes: string): Promise<void> {
    if (this.live()) {
      await this.api.request('review', { id, explanation, reviewNotes }, true);
      await this.refreshAdmin();
    } else {
      this.bookings.update((items) =>
        items.map((item) => (item.id === id ? { ...item, explanation, reviewNotes } : item)),
      );
      this.log('Voorstel aangepast', id);
    }
  }
  id(): string {
    return globalThis.crypto.randomUUID();
  }
  validate(config: EventConfiguration): string {
    if (!config.name.trim()) return 'Vul een naam voor je evenement in.';
    if (!Number.isInteger(config.participants) || config.participants < 1)
      return 'Vul een geldig aantal deelnemers in.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(config.date) || config.date < localDate())
      return 'Kies een datum vanaf vandaag.';
    if (
      !Number.isFinite(duration(config.startTime, config.endTime)) ||
      duration(config.startTime, config.endTime) <= 0
    )
      return 'De eindtijd moet na de begintijd liggen (op dezelfde dag).';
    const selected = this.rooms().find(
      (room) => room.id === config.selectedRoomId && room.isActive,
    );
    if (!selected) return 'Selecteer een beschikbare zaal.';
    if (selected.maxCapacity && config.participants > selected.maxCapacity)
      return 'Het aantal deelnemers overschrijdt de zaalcapaciteit.';
    if (
      config.additionalRooms.some(
        (additional) => !this.activeRooms().some((room) => room.id === additional.id),
      )
    )
      return 'Een extra zaal is niet meer actief.';
    if (
      conflict(
        [config.selectedRoomId, ...config.additionalRooms.map((room) => room.id)],
        config.date,
        config.startTime,
        config.endTime,
        this.bookings(),
        this.blocks(),
      )
    )
      return 'Deze zaal is in de demoplanning al bezet. Kies een andere datum, tijd of zaal.';
    return '';
  }
  saveProposal(config: EventConfiguration, id?: string): ProposalItem {
    const price = estimate(
      config,
      this.rooms(),
      this.catering(),
      this.upgrades(),
      this.live() ? this.activities() : undefined,
    );
    const proposal: ProposalItem = {
      id: id ?? this.id(),
      title: config.name || 'Nieuw evenement',
      config: clone(config),
      createdAt: new Date().toISOString(),
      estimatedPrice: price.total,
      vatAmount: price.vat,
      status: 'Draft',
    };
    this.proposals.update((items) => [
      proposal,
      ...items.filter((item) => item.id !== proposal.id),
    ]);
    this.persist();
    return proposal;
  }
  deleteProposal(id: string): void {
    this.proposals.update((items) => items.filter((item) => item.id !== id));
    this.persist();
  }
  async createBooking(config: EventConfiguration, customer: Booking['customer']): Promise<Booking> {
    const error = this.validate(config);
    if (error) throw new Error(error);
    if (!customer.fullName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))
      throw new Error('Vul je naam en een geldig e-mailadres in.');
    if (this.live()) {
      const signature = JSON.stringify({ config, customer });
      if (this.pendingRequest?.signature !== signature)
        this.pendingRequest = {
          signature,
          requestId: this.id(),
          customerToken: this.id() + this.id(),
        };
      const { requestId, customerToken } = this.pendingRequest;
      const result = await this.api.request<{ booking: Booking }>('event-request', {
        config,
        customer,
        requestId,
        customerToken,
      });
      this.receipts[result.booking.id] = customerToken;
      this.bookings.update((items) => [
        result.booking,
        ...items.filter((item) => item.id !== result.booking.id),
      ]);
      this.ownBookingIds.update((ids) => [...new Set([...ids, result.booking.id])]);
      this.pendingRequest = null;
      return result.booking;
    }
    const id = this.id();
    const reference = `DEMO-${id.slice(0, 8).toUpperCase()}`;
    const price = estimate(
      config,
      this.rooms(),
      this.catering(),
      this.upgrades(),
      this.live() ? this.activities() : undefined,
    );
    const booking: Booking = {
      id,
      reference,
      customer: clone(customer),
      event: {
        name: config.name,
        type: config.type,
        participants: config.participants,
        description: config.customerNotes,
        room: {
          id: config.selectedRoomId,
          name: this.rooms().find((room) => room.id === config.selectedRoomId)?.name ?? '',
        },
        additionalRooms: clone(config.additionalRooms),
        date: config.date,
        alternativeDate: config.alternativeDate,
        startTime: config.startTime,
        endTime: config.endTime,
        durationHours: duration(config.startTime, config.endTime),
      },
      selections: {
        activities: [...config.selectedActivities],
        gamingPreferences: [...config.gamingPreferences],
        vrPreferences: [...config.vrPreferences],
        cateringSelections: [...config.cateringSelections],
        addons: clone(config.selectedAddons),
        specialRequests: config.specialRequests,
        customerNotes: config.customerNotes,
      },
      financial: {
        totalPrice: price.total,
        vatAmount: price.vat,
        vatRate: 21,
        amountPaid: 0,
        outstandingAmount: price.total,
        paymentMethod: 'Niet betaald (demo)',
        paymentReference: '',
        paymentDate: '',
        refundStatus: 'None',
      },
      reservation: {
        bookingReference: reference,
        createdAt: new Date().toISOString(),
        bookingStatus: 'Awaiting Approval',
        availabilityVerified: false,
        adminApprovalStatus: 'Pending',
        internalNotes: [],
      },
    };
    this.bookings.update((items) => [booking, ...items]);
    this.ownBookingIds.update((ids) => [...ids, id]);
    this.log('Demoaanvraag aangemaakt', reference);
    return booking;
  }
  async changeStatus(id: string, action: 'approve' | 'reject' | 'cancel'): Promise<void> {
    if (this.live()) {
      await this.api.request('booking-status', { id, actionType: action }, true);
      await this.refreshAdmin();
      return;
    }
    const original = this.bookings().find((booking) => booking.id === id);
    if (!original) return;
    if (['Cancelled', 'Refunded'].includes(original.reservation.bookingStatus))
      throw new Error('Deze boeking is afgesloten.');
    const booking = clone(original);
    if (action === 'approve') {
      if (
        conflict(
          bookingRoomIds(booking),
          booking.event.date,
          booking.event.startTime,
          booking.event.endTime,
          this.bookings(),
          this.blocks(),
          id,
        )
      )
        throw new Error('Deze boeking overlapt een andere boeking of blokkade.');
      booking.reservation.adminApprovalStatus = 'Approved';
      booking.reservation.availabilityVerified = true;
      booking.reservation.bookingStatus =
        booking.financial.outstandingAmount > 0 ? 'Awaiting Payment' : 'Confirmed';
    } else {
      booking.reservation.bookingStatus = 'Cancelled';
      if (action === 'reject') booking.reservation.adminApprovalStatus = 'Rejected';
    }
    this.bookings.update((items) => items.map((item) => (item.id === id ? booking : item)));
    this.log(
      action,
      booking.reference,
      original.reservation.bookingStatus,
      booking.reservation.bookingStatus,
    );
  }
  async addNote(id: string, text: string): Promise<void> {
    if (this.live()) {
      await this.api.request('booking-note', { id, text }, true);
      await this.refreshAdmin();
      return;
    }
    if (!text.trim()) return;
    this.bookings.update((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              reservation: {
                ...item.reservation,
                internalNotes: [
                  ...item.reservation.internalNotes,
                  {
                    id: this.id(),
                    text: text.trim(),
                    author: 'Demo beheerder',
                    createdAt: new Date().toISOString(),
                  },
                ],
              },
            }
          : item,
      ),
    );
    this.log('Notitie toegevoegd', id);
  }
  async refund(id: string, amount: number, reason: string): Promise<void> {
    if (this.live()) throw new Error('Betalingen en restituties vallen buiten de conceptaanvraag.');
    const original = this.bookings().find((item) => item.id === id);
    if (!original) return;
    const remaining = original.financial.amountPaid - (original.financial.refundAmount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining || !reason.trim())
      throw new Error('Vul een reden en een geldig bedrag binnen het betaalde saldo in.');
    const booking = clone(original);
    const refunded = Math.round(((booking.financial.refundAmount ?? 0) + amount) * 100) / 100;
    booking.financial.refundAmount = refunded;
    booking.financial.refundReason = reason;
    booking.financial.refundStatus = refunded >= booking.financial.amountPaid ? 'Full' : 'Partial';
    if (booking.financial.refundStatus === 'Full') booking.reservation.bookingStatus = 'Refunded';
    this.bookings.update((items) => items.map((item) => (item.id === id ? booking : item)));
    this.log('Demorestitutie geregistreerd', booking.reference, '', String(amount));
  }
  async updateRoom(room: Room): Promise<void> {
    if (this.live()) {
      await this.api.request('save-catalogue', { kind: 'room', item: room }, true);
      await this.refreshAdmin();
      return;
    }
    if (
      !room.name.trim() ||
      (room.baseHourlyRate != null &&
        (!Number.isFinite(room.baseHourlyRate) || room.baseHourlyRate < 0)) ||
      (room.maxCapacity != null &&
        (!Number.isInteger(room.maxCapacity) || room.maxCapacity < room.minCapacity))
    )
      throw new Error('Controleer de zaalnaam, capaciteit en het uurtarief.');
    this.rooms.update((items) => items.map((item) => (item.id === room.id ? clone(room) : item)));
    this.log('Zaal bijgewerkt', room.name);
  }
  async saveCatering(item: CateringPackage): Promise<void> {
    if (this.live()) {
      await this.api.request('save-catalogue', { kind: 'catering', item }, true);
      await this.refreshAdmin();
      return;
    }
    if (
      !item.name.trim() ||
      (item.pricePerPerson != null &&
        (!Number.isFinite(item.pricePerPerson) || item.pricePerPerson < 0))
    )
      throw new Error('Controleer naam en prijs.');
    this.catering.update((items) => [clone(item), ...items.filter((old) => old.id !== item.id)]);
    this.log('Catering bijgewerkt', item.name);
  }
  async saveUpgrade(item: EventUpgrade): Promise<void> {
    if (this.live()) {
      await this.api.request('save-catalogue', { kind: 'upgrade', item }, true);
      await this.refreshAdmin();
      return;
    }
    if (
      !item.name.trim() ||
      (item.price != null && (!Number.isFinite(item.price) || item.price < 0))
    )
      throw new Error('Controleer naam en prijs.');
    this.upgrades.update((items) => [clone(item), ...items.filter((old) => old.id !== item.id)]);
    this.log('Upgrade bijgewerkt', item.name);
  }
  async deleteCatalogue(id: string, type: 'catering' | 'upgrade'): Promise<void> {
    if (this.live()) {
      await this.api.request('delete-catalogue', { id, kind: type }, true);
      await this.refreshAdmin();
      return;
    }
    if (type === 'catering')
      this.catering.update((items) => items.filter((item) => item.id !== id));
    else this.upgrades.update((items) => items.filter((item) => item.id !== id));
    this.log('Catalogusitem verwijderd', id);
  }
  async addBlock(data: Omit<AvailabilityBlock, 'id' | 'createdAt' | 'createdBy'>): Promise<void> {
    if (this.live()) {
      await this.api.request('add-block', { block: data }, true);
      await this.refreshAdmin();
      return;
    }
    if (
      !data.roomId ||
      !data.date ||
      !data.reason.trim() ||
      !(duration(data.startTime, data.endTime) > 0)
    )
      throw new Error('Vul zaal, datum, geldige tijden en een reden in.');
    if (
      conflict(
        [data.roomId],
        data.date,
        data.startTime,
        data.endTime,
        this.bookings(),
        this.blocks(),
      )
    )
      throw new Error('Deze blokkade overlapt een boeking of andere blokkade.');
    this.blocks.update((items) => [
      ...items,
      { ...data, id: this.id(), createdAt: new Date().toISOString(), createdBy: 'Demo beheerder' },
    ]);
    this.log('Blokkade aangemaakt', data.roomName);
  }
  async deleteBlock(id: string): Promise<void> {
    if (this.live()) {
      await this.api.request('delete-block', { id }, true);
      await this.refreshAdmin();
      return;
    }
    this.blocks.update((items) => items.filter((item) => item.id !== id));
    this.log('Blokkade verwijderd', id);
  }
}
