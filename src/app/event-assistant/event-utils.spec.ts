import {
  INITIAL_ROOMS,
  INITIAL_BOOKINGS,
  INITIAL_CATERING_PACKAGES,
  INITIAL_EVENT_UPGRADES,
} from './data/initial-data';
import { conflict, duration, emptyConfiguration, estimate } from './event-utils';

describe('event planning calculations', () => {
  it('keeps on-request catering separate from the known total', () => {
    const config = {
      ...emptyConfiguration(),
      selectedRoomId: INITIAL_ROOMS[0].id,
      cateringSelections: [INITIAL_CATERING_PACKAGES[0].name],
    };
    const result = estimate(
      config,
      INITIAL_ROOMS,
      INITIAL_CATERING_PACKAGES,
      INITIAL_EVENT_UPGRADES,
    );
    expect(result.onRequest).toBe(true);
    expect(result.total).toBe((INITIAL_ROOMS[0].baseHourlyRate ?? 0) * 6 * 1.21);
  });
  it('uses published activity prices in live mode, leaving unknown prices on request', () => {
    const config = {
      ...emptyConfiguration(),
      selectedRoomId: INITIAL_ROOMS[0].id,
      selectedActivities: ['VR'],
    };
    const result = estimate(
      config,
      INITIAL_ROOMS,
      [],
      [],
      [{ name: 'VR', description: '', tag: '', price: null }],
    );
    expect(result.activities).toBe(0);
    expect(result.onRequest).toBe(true);
  });
  it('uses actual times and does not charge a room twice', () => {
    const room = INITIAL_ROOMS[0];
    const config = {
      ...emptyConfiguration(),
      selectedRoomId: room.id,
      startTime: '09:30',
      endTime: '11:00',
      additionalRooms: [{ id: room.id, name: room.name, price: 1 }],
    };
    expect(estimate(config, INITIAL_ROOMS, [], []).roomCost).toBe((room.baseHourlyRate ?? 0) * 1.5);
    expect(duration('11:00', '10:00')).toBeLessThan(0);
  });
  it('allows adjacent slots and rejects overlap on additional rooms', () => {
    const booking = JSON.parse(JSON.stringify(INITIAL_BOOKINGS[0]));
    booking.reservation.bookingStatus = 'Confirmed';
    booking.reservation.adminApprovalStatus = 'Approved';
    booking.event.additionalRooms = [{ id: 'extra', name: 'Extra' }];
    expect(
      conflict(
        ['extra'],
        booking.event.date,
        booking.event.startTime,
        booking.event.endTime,
        [booking],
        [],
      ),
    ).toBe(true);
    expect(
      conflict(['extra'], booking.event.date, booking.event.endTime, '23:59', [booking], []),
    ).toBe(false);
    expect(
      conflict(
        ['extra'],
        booking.event.date,
        booking.event.startTime,
        booking.event.endTime,
        [booking],
        [],
        booking.id,
      ),
    ).toBe(false);
  });
});
