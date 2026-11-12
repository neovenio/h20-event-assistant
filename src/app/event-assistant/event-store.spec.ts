import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { INITIAL_ROOMS } from './data/initial-data';
import { EventStore } from './event-store';
import { Booking, EventConfiguration } from './models';

const room = { ...INITIAL_ROOMS[0], isActive: true, maxCapacity: 500 };
const config: EventConfiguration = {
  name: 'Teamdag',
  type: 'Bedrijfsevenement',
  participants: 20,
  date: '2099-03-10',
  startTime: '10:00',
  endTime: '14:00',
  durationHours: 4,
  budgetRange: '',
  budgetVatInclusive: true,
  selectedRoomId: room.id,
  selectedRoomName: room.name,
  additionalRooms: [],
  selectedActivities: [],
  gamingPreferences: [],
  vrPreferences: [],
  cateringSelections: [],
  selectedAddons: [],
  atmosphere: '',
  specialRequests: '',
  customerNotes: '',
};
const customer: Booking['customer'] = {
  fullName: 'Klant A',
  email: 'a@example.test',
  phone: '',
  company: '',
  billingAddress: { street: '', postalCode: '', city: '', country: '' },
};
const appointmentInput = {
  date: '2099-03-10',
  startTime: '10:00',
  format: 'online_intake' as const,
  customer: { fullName: 'Klant A', email: 'a@example.test' },
};

describe('EventStore logout', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ n8nWebhookBaseUrl: '' }) }),
    );
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('forgets private receipts, own request ids and pending retry ids of the previous account', async () => {
    const store = TestBed.inject(EventStore);
    store.api.configure('https://example.test/webhook/h20');
    store.rooms.set([room]);
    const requestSpy = vi.spyOn(store.api, 'request');
    requestSpy.mockImplementation(async (action: string, data?: Record<string, unknown>) => {
      if (action !== 'event-request') throw new Error('n8n reageert niet op tijd.');
      const booking = {
        id: data?.['requestId'],
        reference: 'H20-X',
        event: {
          room: { id: 'elsewhere', name: 'Elders' },
          additionalRooms: [],
          date: '2000-01-01',
          startTime: '10:00',
          endTime: '11:00',
        },
        reservation: { bookingStatus: 'Awaiting Approval' },
      };
      return { booking: booking as unknown as Booking };
    });

    const booking = await store.createBooking(config, customer);
    expect(store.receiptLink(booking.id)).not.toBe('');
    expect(store.ownBookingIds()).toEqual([booking.id]);

    // A timed-out request keeps its ids so a retry is idempotent...
    await expect(store.createAppointment(appointmentInput)).rejects.toThrow();
    await expect(
      store.createBooking({ ...config, name: 'Tweede' }, customer),
    ).resolves.toBeTruthy();
    requestSpy.mockClear();
    requestSpy.mockRejectedValue(new Error('n8n reageert niet op tijd.'));
    await expect(store.createBooking({ ...config, name: 'Derde' }, customer)).rejects.toThrow();
    await expect(store.createAppointment(appointmentInput)).rejects.toThrow();
    const before = requestSpy.mock.calls.map(
      (call) => (call[1] as { requestId: string }).requestId,
    );

    store.logout();

    // ...but never across accounts: after logout the same form submits as a new request.
    expect(store.receiptLink(booking.id)).toBe('');
    expect(store.ownBookingIds()).toEqual([]);
    requestSpy.mockClear();
    await expect(store.createBooking({ ...config, name: 'Derde' }, customer)).rejects.toThrow();
    await expect(store.createAppointment(appointmentInput)).rejects.toThrow();
    const after = requestSpy.mock.calls.map((call) => (call[1] as { requestId: string }).requestId);
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });
});
