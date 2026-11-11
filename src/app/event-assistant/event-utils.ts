import {
  Appointment,
  AppointmentSlot,
  Booking,
  EventConfiguration,
  Room,
  AvailabilityBlock,
  CateringPackage,
  EventUpgrade,
  ActivityOption,
} from './models';

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function emptyConfiguration(): EventConfiguration {
  return {
    name: '',
    type: 'Bedrijfsevenement',
    participants: 30,
    date: '',
    alternativeDate: '',
    startTime: '10:00',
    endTime: '16:00',
    durationHours: 6,
    budgetRange: '',
    budgetVatInclusive: true,
    selectedRoomId: '',
    selectedRoomName: '',
    additionalRooms: [],
    selectedActivities: [],
    gamingPreferences: [],
    vrPreferences: [],
    cateringSelections: [],
    selectedAddons: [],
    atmosphere: 'Modern & High-Tech',
    specialRequests: '',
    customerNotes: '',
  };
}
export function duration(start: string, end: string): number {
  const minutes = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  };
  return (minutes(end) - minutes(start)) / 60;
}
export function overlaps(
  start: string,
  end: string,
  otherStart: string,
  otherEnd: string,
): boolean {
  return start < otherEnd && end > otherStart;
}
export function bookingRoomIds(booking: Booking): string[] {
  return [booking.event.room.id, ...(booking.event.additionalRooms ?? []).map((room) => room.id)];
}
export function conflict(
  roomIds: string[],
  date: string,
  start: string,
  end: string,
  bookings: Booking[],
  blocks: AvailabilityBlock[],
  exceptId = '',
): boolean {
  return (
    blocks.some(
      (block) =>
        roomIds.includes(block.roomId) &&
        block.date === date &&
        overlaps(start, end, block.startTime, block.endTime),
    ) ||
    bookings.some(
      (booking) =>
        booking.id !== exceptId &&
        !['Cancelled', 'Refunded', 'Draft'].includes(booking.reservation.bookingStatus) &&
        booking.reservation.adminApprovalStatus !== 'Rejected' &&
        bookingRoomIds(booking).some((id) => roomIds.includes(id)) &&
        booking.event.date === date &&
        overlaps(start, end, booking.event.startTime, booking.event.endTime),
    )
  );
}
export function estimate(
  config: EventConfiguration,
  rooms: Room[],
  catering: CateringPackage[],
  upgrades: EventUpgrade[],
  activityOptions?: ActivityOption[],
) {
  const hours = Math.max(0, duration(config.startTime, config.endTime));
  const ids = [
    ...new Set(
      [config.selectedRoomId, ...config.additionalRooms.map((room) => room.id)].filter(Boolean),
    ),
  ];
  const chosenRooms = ids.map((id) => rooms.find((room) => room.id === id));
  const chosenCatering = config.cateringSelections.map((name) =>
    catering.find((item) => item.name === name),
  );
  const chosenUpgrades = config.selectedAddons.map((addon) =>
    upgrades.find((item) => item.id === addon.id),
  );
  const roomCost = chosenRooms.reduce((sum, room) => sum + (room?.baseHourlyRate ?? 0) * hours, 0);
  // Retain the original prototype's activity estimate; unknown catalogue prices stay on request.
  const activities = activityOptions
    ? config.selectedActivities.reduce(
        (sum, name) => sum + (activityOptions.find((item) => item.name === name)?.price ?? 0),
        0,
      )
    : config.selectedActivities.length * 250;
  const extras =
    chosenCatering.reduce(
      (sum, item) => sum + (item?.pricePerPerson ?? 0) * config.participants,
      0,
    ) + chosenUpgrades.reduce((sum, item) => sum + (item?.price ?? 0), 0);
  const subtotal = roomCost + activities + extras;
  const vat = Math.round(subtotal * 21) / 100;
  const onRequest =
    (!!activityOptions &&
      config.selectedActivities.some(
        (name) => activityOptions.find((item) => item.name === name)?.price == null,
      )) ||
    chosenRooms.some((room) => room?.baseHourlyRate == null) ||
    chosenCatering.some((item) => item?.pricePerPerson == null) ||
    chosenUpgrades.some((item) => item?.price == null);
  return {
    roomCost,
    activities,
    extras,
    subtotal,
    vat,
    total: Math.round((subtotal + vat) * 100) / 100,
    onRequest,
  };
}
export const ACTIVITIES = [
  {
    name: 'Esports Toernooi',
    description:
      'Competitieve toernooien in Rocket League, EA FC of Valorant op het grote stadiumpodium.',
    tag: 'Teambuilding',
  },
  {
    name: 'Sim Racing Masters',
    description: 'Professionele simulatoren met force feedback en echte circuits.',
    tag: 'Adrenaline',
  },
  {
    name: 'Virtual Reality Arena',
    description: 'Draadloze VR headsets voor groepsgevechten, beat battles en team adventures.',
    tag: 'Immersief',
  },
  {
    name: 'Japanese Arcade',
    description: 'Authentieke arcadekasten, dansmatten en retro machines.',
    tag: 'Fun & Casual',
  },
  {
    name: 'Streaming Studio Experience',
    description: 'Je eigen live uitzending met regiekamer, green screen en professionele audio.',
    tag: 'Content Creation',
  },
  {
    name: 'Nintendo Lounge',
    description: 'Mario Kart en Super Smash Bros op grote 4K displays.',
    tag: 'Toegankelijk',
  },
];

export const APPOINTMENT_SLOTS: readonly { startTime: string; endTime: string }[] = [
  { startTime: '10:00', endTime: '11:00' },
  { startTime: '11:30', endTime: '12:30' },
  { startTime: '14:00', endTime: '15:00' },
  { startTime: '15:30', endTime: '16:30' },
];

export function isValidIsoDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  );
}

export function isWeekdayDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

export function nextWeekday(from = new Date()): string {
  const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  while (candidate.getDay() === 0 || candidate.getDay() === 6) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return localDate(candidate);
}

export function appointmentConflict(
  date: string,
  start: string,
  end: string,
  appointments: Appointment[],
  blocks: AvailabilityBlock[],
  exceptId = '',
): boolean {
  return (
    blocks.some(
      (block) =>
        block.type === 'Closure' &&
        block.date === date &&
        overlaps(start, end, block.startTime, block.endTime),
    ) ||
    appointments.some(
      (appointment) =>
        appointment.id !== exceptId &&
        appointment.status !== 'cancelled' &&
        appointment.status !== 'rejected' &&
        appointment.date === date &&
        overlaps(start, end, appointment.startTime, appointment.endTime),
    )
  );
}

export function computeAppointmentSlots(
  date: string,
  appointments: Appointment[],
  blocks: AvailabilityBlock[],
  todayStr = localDate(),
): AppointmentSlot[] {
  const bookableDay = isValidIsoDate(date) && date >= todayStr && isWeekdayDate(date);
  return APPOINTMENT_SLOTS.map((slot) => ({
    startTime: slot.startTime,
    endTime: slot.endTime,
    available:
      bookableDay && !appointmentConflict(date, slot.startTime, slot.endTime, appointments, blocks),
  }));
}
