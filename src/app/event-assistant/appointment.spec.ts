import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Admin } from './components/admin';
import { AppointmentModal } from './components/appointment-modal';
import {
  INITIAL_ACTIVITY_LOGS,
  INITIAL_AVAILABILITY_BLOCKS,
  INITIAL_BOOKINGS,
  INITIAL_CATERING_PACKAGES,
  INITIAL_EVENT_UPGRADES,
  INITIAL_ROOMS,
} from './data/initial-data';
import { EventStore } from './event-store';

describe('in-app appointment booking (#17)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ n8nWebhookBaseUrl: '' }) }),
    );
    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('calculates weekday vs weekend slots and respects Closure blocks without blocking on Maintenance', async () => {
    const store = TestBed.inject(EventStore);
    store.blocks.set([
      {
        id: 'closure-1',
        roomId: INITIAL_ROOMS[0].id,
        roomName: INITIAL_ROOMS[0].name,
        date: '2099-01-05', // Monday
        startTime: '11:00',
        endTime: '13:00',
        reason: 'Nieuwjaarssluiting',
        type: 'Closure',
        createdAt: '2099-01-01T09:00:00Z',
        createdBy: 'Beheer',
      },
      {
        id: 'maint-1',
        roomId: INITIAL_ROOMS[0].id,
        roomName: INITIAL_ROOMS[0].name,
        date: '2099-01-05',
        startTime: '10:00',
        endTime: '11:00',
        reason: 'Zaalonderhoud',
        type: 'Maintenance',
        createdAt: '2099-01-01T09:00:00Z',
        createdBy: 'Beheer',
      },
    ]);

    const mondaySlots = await store.getAppointmentSlots('2099-01-05');
    expect(mondaySlots).toEqual([
      { startTime: '10:00', endTime: '11:00', available: true },
      { startTime: '11:30', endTime: '12:30', available: false },
      { startTime: '14:00', endTime: '15:00', available: true },
      { startTime: '15:30', endTime: '16:30', available: true },
    ]);

    const saturdaySlots = await store.getAppointmentSlots('2099-01-03');
    expect(saturdaySlots.every((slot) => !slot.available)).toBe(true);

    const pastSlots = await store.getAppointmentSlots('2020-01-06');
    expect(pastSlots.every((slot) => !slot.available)).toBe(true);
  });

  it('books a verified appointment in demo mode and rejects double-booking the same slot', async () => {
    const store = TestBed.inject(EventStore);
    store.blocks.set([]);

    const appointment = await store.createAppointment({
      date: '2099-01-05',
      startTime: '14:00',
      format: 'location_tour',
      customer: {
        fullName: 'Noor Bakker',
        email: 'noor@example.test',
        phone: '0611223344',
        company: 'Pixel Events',
      },
      notes: 'Graag het Rabo Esports Stadium bekijken.',
    });

    expect(appointment.reference).toMatch(/^AF-[A-F0-9]{8}$/);
    expect(appointment.status).toBe('pending');
    expect(appointment.endTime).toBe('15:00');
    expect(store.ownAppointments().map((item) => item.id)).toEqual([appointment.id]);

    const updatedSlots = await store.getAppointmentSlots('2099-01-05');
    expect(updatedSlots.find((slot) => slot.startTime === '14:00')?.available).toBe(false);

    await expect(
      store.createAppointment({
        date: '2099-01-05',
        startTime: '14:00',
        format: 'online_intake',
        customer: { fullName: 'Tweede Klant', email: 'tweede@example.test' },
      }),
    ).rejects.toThrow('Dit tijdslot is niet meer beschikbaar');
  });

  it('allows staff to confirm or cancel appointments and re-checks conflicts before confirming', async () => {
    const store = TestBed.inject(EventStore);
    store.blocks.set([]);

    const first = await store.createAppointment({
      date: '2099-01-05',
      startTime: '10:00',
      format: 'online_intake',
      customer: { fullName: 'Eva Visser', email: 'eva@example.test' },
    });

    await store.changeAppointmentStatus(first.id, 'confirm');
    expect(store.appointments()[0].status).toBe('confirmed');

    const second = await store.createAppointment({
      date: '2099-01-05',
      startTime: '15:30',
      format: 'location_tour',
      customer: { fullName: 'Milan Smit', email: 'milan@example.test' },
    });

    // Add a venue Closure overlapping second appointment before staff confirms
    store.blocks.set([
      {
        id: 'closure-late',
        roomId: INITIAL_ROOMS[0].id,
        roomName: INITIAL_ROOMS[0].name,
        date: '2099-01-05',
        startTime: '15:00',
        endTime: '17:00',
        reason: 'Spoedsluiting',
        type: 'Closure',
        createdAt: '2099-01-01T10:00:00Z',
        createdBy: 'Beheer',
      },
    ]);

    await expect(store.changeAppointmentStatus(second.id, 'confirm')).rejects.toThrow('overlapt');

    // Cancelling first appointment frees its 10:00-11:00 slot
    await store.changeAppointmentStatus(first.id, 'cancel');
    expect(store.appointments().find((item) => item.id === first.id)?.status).toBe('cancelled');
    const slots = await store.getAppointmentSlots('2099-01-05');
    expect(slots.find((slot) => slot.startTime === '10:00')?.available).toBe(true);
  });

  it('loads legacy localStorage demo state without appointments cleanly', async () => {
    localStorage.setItem(
      'h20-angular-demo-v1',
      JSON.stringify({
        rooms: INITIAL_ROOMS,
        bookings: INITIAL_BOOKINGS,
        blocks: INITIAL_AVAILABILITY_BLOCKS,
        logs: INITIAL_ACTIVITY_LOGS,
        catering: INITIAL_CATERING_PACKAGES,
        upgrades: INITIAL_EVENT_UPGRADES,
        proposals: [],
        ownBookingIds: [],
      }),
    );

    const fixture = TestBed.createComponent(Admin);
    await fixture.whenStable();
    const store = TestBed.inject(EventStore);
    expect(store.storageWarning()).toBe('');
    expect(store.appointments()).toEqual([]);
  });

  it('renders AppointmentModal slots, validates fields after interaction, and books an appointment through the UI', async () => {
    HTMLDialogElement.prototype.showModal ??= function () {
      this.setAttribute('open', '');
    };
    const fixture = TestBed.createComponent(AppointmentModal);
    const modal = fixture.componentInstance;
    await modal.loadSlots('2099-01-05');
    fixture.detectChanges();
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('input[name="slot"]').length).toBe(4);
    expect(modal.selectedSlot).toBe('10:00');

    const form = el.querySelector('form') as HTMLFormElement;
    const nameInput = el.querySelector('#appt-name') as HTMLInputElement;
    const emailInput = el.querySelector('#appt-email') as HTMLInputElement;

    // Submitting while empty marks required fields aria-invalid="true" and blocks submission
    await modal.submit(form);
    expect(nameInput.getAttribute('aria-invalid')).toBe('true');
    expect(nameInput.getAttribute('aria-describedby')).toContain('appt-name-error');

    // Entering valid values clears aria-invalid and allows booking
    nameInput.value = 'Sanne Jansen';
    nameInput.dispatchEvent(new Event('input'));
    emailInput.value = 'sanne@example.test';
    emailInput.dispatchEvent(new Event('input'));
    modal.format = 'online_intake';
    fixture.detectChanges();
    await fixture.whenStable();

    expect(nameInput.getAttribute('aria-invalid')).toBe('false');
    await modal.submit(form);
    fixture.detectChanges();

    expect(modal.confirmed()?.reference).toMatch(/^AF-/);
    expect(el.textContent).toContain('Je afspraakverzoek staat genoteerd');
  });

  it('renders incoming appointments in Admin availability section with Bevestigen and Annuleren controls', async () => {
    const store = TestBed.inject(EventStore);
    store.blocks.set([]);
    const created = await store.createAppointment({
      date: '2099-01-05',
      startTime: '11:30',
      format: 'location_tour',
      customer: { fullName: 'Bram Kuiper', email: 'bram@example.test', company: 'H20 Partner' },
    });

    const fixture = TestBed.createComponent(Admin);
    fixture.componentRef.setInput('section', 'availability');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Beschikbaarheid & Afspraken');
    expect(el.textContent).toContain(created.reference);

    const confirmBtn = el.querySelector(
      `button[aria-label="Bevestigen ${created.reference}"]`,
    ) as HTMLButtonElement | null;
    expect(confirmBtn).not.toBeNull();
    confirmBtn?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.appointments()[0].status).toBe('confirmed');
    expect(el.textContent).toContain('Bevestigd');
  });

  it('uses connected n8n endpoints for getAppointmentSlots and createAppointment when live', async () => {
    const store = TestBed.inject(EventStore);
    store.api.configure('https://example.test/webhook/h20');
    const requestSpy = vi
      .spyOn(store.api, 'request')
      .mockResolvedValueOnce({
        date: '2099-01-05',
        slots: [{ startTime: '10:00', endTime: '11:00', available: true }],
      })
      .mockResolvedValueOnce({
        appointment: {
          id: '11111111-2222-3333-4444-555555555555',
          reference: 'AF-11111111',
          status: 'pending',
          date: '2099-01-05',
          startTime: '10:00',
          endTime: '11:00',
          format: 'online_intake',
          customer: {
            fullName: 'Live Klant',
            email: 'live@example.test',
            phone: '',
            company: '',
          },
          notes: '',
          createdAt: '2099-01-01T12:00:00Z',
        },
      });

    const slots = await store.getAppointmentSlots('2099-01-05');
    expect(slots).toEqual([{ startTime: '10:00', endTime: '11:00', available: true }]);
    expect(requestSpy).toHaveBeenNthCalledWith(1, 'appointment-slots', { date: '2099-01-05' });

    const created = await store.createAppointment({
      date: '2099-01-05',
      startTime: '10:00',
      format: 'online_intake',
      customer: { fullName: 'Live Klant', email: 'live@example.test' },
    });
    expect(created.reference).toBe('AF-11111111');
    expect(store.ownAppointments().map((item) => item.id)).toEqual([
      '11111111-2222-3333-4444-555555555555',
    ]);
    expect(requestSpy.mock.calls[1][0]).toBe('book-appointment');
    expect((requestSpy.mock.calls[1][1] as { requestId: string }).requestId).toMatch(
      /^[a-f0-9-]{36}$/,
    );
  });
});
