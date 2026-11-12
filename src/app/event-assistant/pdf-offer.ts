import { duration } from './event-utils';
import { ActivityOption, Booking, CateringPackage, EventUpgrade, Room } from './models';

export const OFFER_DISCLAIMER =
  'Conceptvoorstel: prijzen, btw en beschikbaarheid worden door H20 gecontroleerd. Opties op aanvraag zijn niet in het totaalbedrag inbegrepen. Dit document is geen definitieve offerte, reservering of betaalverzoek.';

export interface OfferContext {
  live: boolean;
  admin?: boolean;
  rooms?: Room[];
  catering?: CateringPackage[];
  upgrades?: EventUpgrade[];
  activities?: ActivityOption[];
}

export interface OfferLineItem {
  label: string;
  detail: string;
  amount: number | null;
  onRequest: boolean;
}

export interface OfferDocument {
  brand: string;
  subtitle: string;
  reference: string;
  createdAt: string;
  status: string;
  modeBanner: string;
  event: {
    name: string;
    type: string;
    date: string;
    alternativeDate?: string;
    timeRange: string;
    durationHours: number;
    participants: number;
    mainRoom: string;
    additionalRooms: string[];
    specialRequests?: string;
    customerNotes?: string;
  };
  customer: {
    fullName: string;
    company: string;
    email: string;
    phone: string;
    billingAddress: {
      street: string;
      postalCode: string;
      city: string;
      country: string;
    };
  };
  lineItems: OfferLineItem[];
  totals: {
    subtotalExVat: number;
    vatRate: number;
    vatAmount: number;
    totalInclVat: number;
    hasOnRequest: boolean;
    onRequestItems: string[];
  };
  explanation?: string;
  disclaimer: string;
}

const CP1252_EXTENDED: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // ‘
  0x2019: 0x92, // ’
  0x201c: 0x93, // “
  0x201d: 0x94, // ”
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
};

function roundCents(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function formatEuro(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const sign = safe < 0 ? '-' : '';
  const [whole, cents] = Math.abs(safe).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}€ ${grouped},${cents}`;
}

export function formatDateDdMmYyyy(value: string): string {
  const trimmed = (value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return trimmed || '—';
}

function formatHours(hours: number): string {
  const formatted = Number.isInteger(hours)
    ? String(hours)
    : String(roundCents(hours)).replace('.', ',');
  return `${formatted} uur`;
}

export function buildOfferDocument(booking: Booking, context: OfferContext): OfferDocument {
  const computedHours = duration(booking.event.startTime, booking.event.endTime);
  const hours =
    Number.isFinite(booking.event.durationHours) && booking.event.durationHours > 0
      ? booking.event.durationHours
      : Number.isFinite(computedHours) && computedHours > 0
        ? computedHours
        : 0;

  const lineItems: OfferLineItem[] = [];

  const mainCatRoom =
    context.rooms?.find((room) => room.id === booking.event.room.id) ??
    context.rooms?.find((room) => room.name === booking.event.room.name);
  const mainRoomLabel = booking.event.room.name || mainCatRoom?.name || 'Hoofdzaal';
  if (mainCatRoom?.baseHourlyRate != null && Number.isFinite(mainCatRoom.baseHourlyRate)) {
    lineItems.push({
      label: mainRoomLabel,
      detail: `Hoofdzaal · ${formatHours(hours)} × ${formatEuro(mainCatRoom.baseHourlyRate)}/uur`,
      amount: roundCents(mainCatRoom.baseHourlyRate * hours),
      onRequest: false,
    });
  } else {
    lineItems.push({
      label: mainRoomLabel,
      detail: `Hoofdzaal · ${formatHours(hours)} · Op aanvraag`,
      amount: null,
      onRequest: true,
    });
  }

  for (const extra of booking.event.additionalRooms ?? []) {
    const extraCatRoom =
      context.rooms?.find((room) => room.id === extra.id) ??
      context.rooms?.find((room) => room.name === extra.name);
    const knownHourlyRate =
      extraCatRoom?.baseHourlyRate != null && Number.isFinite(extraCatRoom.baseHourlyRate)
        ? extraCatRoom.baseHourlyRate
        : extra.price != null && Number.isFinite(extra.price) && extra.price > 0
          ? extra.price
          : null;
    if (knownHourlyRate != null) {
      lineItems.push({
        label: extra.name || extraCatRoom?.name || 'Extra ruimte',
        detail: `Extra ruimte · ${formatHours(hours)} × ${formatEuro(knownHourlyRate)}/uur`,
        amount: roundCents(knownHourlyRate * hours),
        onRequest: false,
      });
    } else {
      lineItems.push({
        label: extra.name || extraCatRoom?.name || 'Extra ruimte',
        detail: `Extra ruimte · ${formatHours(hours)} · Op aanvraag`,
        amount: null,
        onRequest: true,
      });
    }
  }

  for (const activityName of booking.selections.activities) {
    const catActivity = context.activities?.find((item) => item.name === activityName);
    if (catActivity?.price != null && Number.isFinite(catActivity.price)) {
      lineItems.push({
        label: activityName,
        detail: 'Activiteit',
        amount: roundCents(catActivity.price),
        onRequest: false,
      });
    } else {
      lineItems.push({
        label: activityName,
        detail: 'Activiteit · Op aanvraag',
        amount: null,
        onRequest: true,
      });
    }
  }

  const participants = booking.event.participants;
  for (const cateringName of booking.selections.cateringSelections) {
    const catPackage = context.catering?.find((item) => item.name === cateringName);
    if (catPackage?.pricePerPerson != null && Number.isFinite(catPackage.pricePerPerson)) {
      lineItems.push({
        label: cateringName,
        detail: `Catering · ${participants} pers. × ${formatEuro(catPackage.pricePerPerson)} p.p.`,
        amount: roundCents(catPackage.pricePerPerson * participants),
        onRequest: false,
      });
    } else {
      lineItems.push({
        label: cateringName,
        detail: `Catering (${participants} pers.) · Op aanvraag`,
        amount: null,
        onRequest: true,
      });
    }
  }

  for (const addon of booking.selections.addons ?? []) {
    const catUpgrade =
      context.upgrades?.find((item) => item.id === addon.id) ??
      context.upgrades?.find((item) => item.name === addon.name);
    const knownAddonPrice = catUpgrade
      ? catUpgrade.price != null && Number.isFinite(catUpgrade.price)
        ? catUpgrade.price
        : addon.price != null && Number.isFinite(addon.price) && addon.price > 0
          ? addon.price
          : null
      : addon.price != null && Number.isFinite(addon.price) && addon.price > 0
        ? addon.price
        : null;
    if (knownAddonPrice != null) {
      lineItems.push({
        label: addon.name || catUpgrade?.name || 'Upgrade',
        detail:
          knownAddonPrice === 0 && catUpgrade?.isStandardFacility
            ? 'Upgrade · Standaard zaalfaciliteit'
            : 'Upgrade / extra optie',
        amount: roundCents(knownAddonPrice),
        onRequest: false,
      });
    } else {
      lineItems.push({
        label: addon.name || catUpgrade?.name || 'Upgrade',
        detail: 'Upgrade / extra optie · Op aanvraag',
        amount: null,
        onRequest: true,
      });
    }
  }

  const totalInclVat = roundCents(booking.financial.totalPrice);
  const vatAmount = roundCents(booking.financial.vatAmount);
  const subtotalExVat = roundCents(booking.financial.totalPrice - booking.financial.vatAmount);
  const onRequestItems = lineItems.filter((item) => item.onRequest).map((item) => item.label);

  const rawExplanation = booking.explanation?.trim() ?? '';
  const includeExplanation =
    rawExplanation.length > 0 &&
    Boolean(context.admin || !context.live || booking.requestStatus === 'approved');

  const specialRequests = booking.selections.specialRequests?.trim() || undefined;
  const customerNotes = booking.selections.customerNotes?.trim() || undefined;
  const alternativeDate = booking.event.alternativeDate?.trim()
    ? formatDateDdMmYyyy(booking.event.alternativeDate)
    : undefined;

  return {
    brand: 'H20 EVENT LOCATIE',
    subtitle: 'CONCEPTOFFERTE',
    reference: booking.reference,
    createdAt: formatDateDdMmYyyy(booking.reservation.createdAt),
    status: booking.requestStatus || booking.reservation.bookingStatus,
    modeBanner: context.live
      ? 'Conceptaanvraag · Pas definitief na overleg en akkoord op de offerte.'
      : 'Conceptaanvraag · Demogegevens, geen echte boeking of factuur.',
    event: {
      name: booking.event.name,
      type: booking.event.type,
      date: formatDateDdMmYyyy(booking.event.date),
      ...(alternativeDate ? { alternativeDate } : {}),
      timeRange: `${booking.event.startTime} – ${booking.event.endTime}`,
      durationHours: hours,
      participants: booking.event.participants,
      mainRoom: mainRoomLabel,
      additionalRooms: (booking.event.additionalRooms ?? []).map((room) => room.name),
      ...(specialRequests ? { specialRequests } : {}),
      ...(customerNotes ? { customerNotes } : {}),
    },
    customer: {
      fullName: booking.customer.fullName,
      company: booking.customer.company,
      email: booking.customer.email,
      phone: booking.customer.phone,
      billingAddress: {
        street: booking.customer.billingAddress.street,
        postalCode: booking.customer.billingAddress.postalCode,
        city: booking.customer.billingAddress.city,
        country: booking.customer.billingAddress.country,
      },
    },
    lineItems,
    totals: {
      subtotalExVat,
      vatRate: booking.financial.vatRate,
      vatAmount,
      totalInclVat,
      hasOnRequest: onRequestItems.length > 0,
      onRequestItems,
    },
    ...(includeExplanation ? { explanation: rawExplanation } : {}),
    disclaimer: OFFER_DISCLAIMER,
  };
}

/** Encodes a Unicode string into single-byte Windows-1252 (PDF /WinAnsiEncoding) bytes. */
export function encodeWinAnsi(text: string): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0x3f;
    if (code === 0x09 || code === 0x00a0) {
      bytes.push(0x20);
    } else if (code >= 0x20 && code <= 0x7e) {
      bytes.push(code);
    } else if (code >= 0xa1 && code <= 0xff) {
      bytes.push(code);
    } else if (code in CP1252_EXTENDED) {
      bytes.push(CP1252_EXTENDED[code]);
    } else if (code === 0x2212) {
      bytes.push(0x2d); // Unicode minus -> '-'
    } else if (code >= 0x20) {
      bytes.push(0x3f); // '?'
    }
  }
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

/** Encodes a Unicode string as a PDF literal string `(...)` with CP1252 bytes and PDF escapes. */
export function encodePdfLiteralString(text: string): Uint8Array<ArrayBuffer> {
  const raw = encodeWinAnsi(text);
  const escaped: number[] = [0x28]; // '('
  for (const b of raw) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) {
      escaped.push(0x5c, b);
    } else {
      escaped.push(b);
    }
  }
  escaped.push(0x29); // ')'
  const out = new Uint8Array(escaped.length);
  out.set(escaped);
  return out;
}

class ByteBuffer {
  private buf = new Uint8Array(8192);
  private pos = 0;

  get length(): number {
    return this.pos;
  }

  private ensure(extra: number): void {
    if (this.pos + extra <= this.buf.length) return;
    let next = this.buf.length * 2;
    while (next < this.pos + extra) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(this.buf.subarray(0, this.pos));
    this.buf = grown;
  }

  writeAscii(str: string): void {
    this.ensure(str.length);
    for (let i = 0; i < str.length; i++) {
      this.buf[this.pos++] = str.charCodeAt(i) & 0x7f;
    }
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  toUint8Array(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.pos);
    out.set(this.buf.subarray(0, this.pos));
    return out;
  }
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 42;
const CONTENT_W = PAGE_W - MARGIN_X * 2; // 511.28
const BOTTOM_LIMIT = 64;

type Rgb = readonly [number, number, number];

const COLOR_BLACK: Rgb = [0, 0, 0];
const COLOR_WHITE: Rgb = [1, 1, 1];
const COLOR_MAGENTA: Rgb = [0.882, 0.004, 0.294]; // #E1014B
const COLOR_CYAN: Rgb = [0.373, 0.761, 0.824]; // #5FC2D2
const COLOR_CYAN_TINT: Rgb = [0.933, 0.976, 0.984];
const COLOR_DARK: Rgb = [0.07, 0.09, 0.13];
const COLOR_MUTED: Rgb = [0.36, 0.41, 0.48];
const COLOR_HEADER_MUTED: Rgb = [0.78, 0.82, 0.87];
const COLOR_PANEL_BG: Rgb = [0.98, 0.985, 0.992];
const COLOR_ROW_ALT: Rgb = [0.969, 0.976, 0.986];
const COLOR_BORDER: Rgb = [0.84, 0.87, 0.91];
const COLOR_DISCLAIMER_BG: Rgb = [0.992, 0.969, 0.976];

function fmt(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function charWidthUnits(ch: string): number {
  if ("ilI.,:;'!| ".includes(ch)) return 278;
  if ('()[]{}fjt-`'.includes(ch)) return 333;
  if ('r"/*'.includes(ch)) return 389;
  if ('sckvxyzJ?'.includes(ch)) return 500;
  if ('mw%'.includes(ch)) return 800;
  if ('MW@'.includes(ch)) return 920;
  if (ch >= 'A' && ch <= 'Z') return 690;
  return 560;
}

function measureTextWidth(text: string, fontSize: number, bold = false): number {
  let units = 0;
  for (const ch of text) {
    units += charWidthUnits(ch);
  }
  return (units / 1000) * fontSize * (bold ? 1.06 : 1);
}

function wrapText(text: string, maxWidth: number, fontSize: number, bold = false): string[] {
  const normalized = (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.replace(/\t/g, ' ').trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }
    const words = trimmed.split(/\s+/);
    let current = '';

    const pushLongWord = (word: string) => {
      let chunk = '';
      for (const ch of word) {
        const next = chunk + ch;
        if (chunk && measureTextWidth(next, fontSize, bold) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk = next;
        }
      }
      current = chunk;
    };

    for (const word of words) {
      if (!current) {
        if (measureTextWidth(word, fontSize, bold) <= maxWidth) {
          current = word;
        } else {
          pushLongWord(word);
        }
      } else {
        const candidate = `${current} ${word}`;
        if (measureTextWidth(candidate, fontSize, bold) <= maxWidth) {
          current = candidate;
        } else {
          lines.push(current);
          if (measureTextWidth(word, fontSize, bold) <= maxWidth) {
            current = word;
          } else {
            pushLongWord(word);
          }
        }
      }
    }
    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

class PdfPageCanvas {
  readonly stream = new ByteBuffer();

  fillRect(x: number, y: number, w: number, h: number, color: Rgb): void {
    this.stream.writeAscii(
      `${fmt(color[0])} ${fmt(color[1])} ${fmt(color[2])} rg ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re f\n`,
    );
  }

  strokeRect(x: number, y: number, w: number, h: number, color: Rgb, lineWidth = 0.6): void {
    this.stream.writeAscii(
      `${fmt(lineWidth)} w ${fmt(color[0])} ${fmt(color[1])} ${fmt(color[2])} RG ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re S\n`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, lineWidth = 0.6): void {
    this.stream.writeAscii(
      `${fmt(lineWidth)} w ${fmt(color[0])} ${fmt(color[1])} ${fmt(color[2])} RG ${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S\n`,
    );
  }

  text(
    value: string,
    x: number,
    y: number,
    options: { size: number; bold?: boolean; color?: Rgb; align?: 'left' | 'right' },
  ): void {
    if (!value) return;
    const bold = Boolean(options.bold);
    const color = options.color ?? COLOR_DARK;
    const drawX = options.align === 'right' ? x - measureTextWidth(value, options.size, bold) : x;
    this.stream.writeAscii(
      `BT /${bold ? 'F2' : 'F1'} ${fmt(options.size)} Tf ${fmt(color[0])} ${fmt(color[1])} ${fmt(color[2])} rg 1 0 0 1 ${fmt(drawX)} ${fmt(y)} Tm `,
    );
    this.stream.writeBytes(encodePdfLiteralString(value));
    this.stream.writeAscii(' Tj ET\n');
  }
}

export function renderOfferPdf(doc: OfferDocument): Uint8Array<ArrayBuffer> {
  const pages: PdfPageCanvas[] = [];
  let page!: PdfPageCanvas;
  let cursorY = 0;
  const rightEdge = MARGIN_X + CONTENT_W;

  const drawFirstHeader = (canvas: PdfPageCanvas): number => {
    const barH = 88;
    const barY = PAGE_H - barH;
    canvas.fillRect(0, barY, PAGE_W, barH, COLOR_BLACK);
    canvas.fillRect(0, barY - 4, PAGE_W, 4, COLOR_MAGENTA);

    canvas.text(doc.brand, MARGIN_X, PAGE_H - 36, {
      size: 18,
      bold: true,
      color: COLOR_WHITE,
    });
    canvas.text(doc.subtitle, MARGIN_X, PAGE_H - 54, {
      size: 10,
      bold: true,
      color: COLOR_CYAN,
    });
    canvas.text('H20 Esports Campus · Purmerend', MARGIN_X, PAGE_H - 70, {
      size: 8.5,
      color: COLOR_HEADER_MUTED,
    });

    canvas.text(`Referentie: ${doc.reference}`, rightEdge, PAGE_H - 34, {
      size: 10,
      bold: true,
      color: COLOR_WHITE,
      align: 'right',
    });
    canvas.text(`Datum: ${doc.createdAt}`, rightEdge, PAGE_H - 50, {
      size: 9,
      color: COLOR_HEADER_MUTED,
      align: 'right',
    });
    canvas.text(`Status: ${doc.status}`, rightEdge, PAGE_H - 66, {
      size: 9,
      bold: true,
      color: COLOR_CYAN,
      align: 'right',
    });

    return barY - 20;
  };

  const drawContinuationHeader = (canvas: PdfPageCanvas): number => {
    const barH = 44;
    const barY = PAGE_H - barH;
    canvas.fillRect(0, barY, PAGE_W, barH, COLOR_BLACK);
    canvas.fillRect(0, barY - 3, PAGE_W, 3, COLOR_MAGENTA);
    canvas.text(`${doc.brand} · ${doc.subtitle}`, MARGIN_X, PAGE_H - 27, {
      size: 10,
      bold: true,
      color: COLOR_WHITE,
    });
    canvas.text(`Referentie: ${doc.reference}`, rightEdge, PAGE_H - 27, {
      size: 9,
      color: COLOR_CYAN,
      align: 'right',
    });
    return barY - 20;
  };

  const addPage = (): void => {
    page = new PdfPageCanvas();
    pages.push(page);
    cursorY = pages.length === 1 ? drawFirstHeader(page) : drawContinuationHeader(page);
  };

  const ensureSpace = (neededHeight: number): void => {
    if (cursorY - neededHeight < BOTTOM_LIMIT) {
      addPage();
    }
  };

  const drawSectionHeading = (title: string): void => {
    ensureSpace(26);
    page.fillRect(MARGIN_X, cursorY - 11, 3.5, 13, COLOR_CYAN);
    page.text(title, MARGIN_X + 10, cursorY - 9, {
      size: 10,
      bold: true,
      color: COLOR_BLACK,
    });
    cursorY -= 20;
  };

  addPage();

  // Mode banner
  const bannerLines = wrapText(doc.modeBanner, CONTENT_W - 24, 9, true);
  const bannerH = bannerLines.length * 13 + 12;
  ensureSpace(bannerH);
  page.fillRect(MARGIN_X, cursorY - bannerH, CONTENT_W, bannerH, COLOR_CYAN_TINT);
  page.strokeRect(MARGIN_X, cursorY - bannerH, CONTENT_W, bannerH, COLOR_CYAN, 0.7);
  page.fillRect(MARGIN_X, cursorY - bannerH, 4, bannerH, COLOR_CYAN);
  let bannerTextY = cursorY - 15;
  for (const line of bannerLines) {
    page.text(line, MARGIN_X + 12, bannerTextY, {
      size: 9,
      bold: true,
      color: COLOR_DARK,
    });
    bannerTextY -= 13;
  }
  cursorY -= bannerH + 16;

  // Two-column details: Event & Customer
  const colGap = 16;
  const colW = (CONTENT_W - colGap) / 2;
  const innerW = colW - 22;

  interface DetailEntry {
    label: string;
    lines: string[];
  }

  const buildEntries = (pairs: [string, string | undefined][]): DetailEntry[] =>
    pairs
      .filter((pair): pair is [string, string] => Boolean(pair[1]?.trim()))
      .map(([label, value]) => ({
        label,
        lines: wrapText(value, innerW, 9),
      }));

  const roomsValue =
    doc.event.additionalRooms.length > 0
      ? `${doc.event.mainRoom} (+ ${doc.event.additionalRooms.join(', ')})`
      : doc.event.mainRoom;

  const eventEntries = buildEntries([
    ['Evenement', doc.event.name],
    ['Type & groep', `${doc.event.type} · ${doc.event.participants} personen`],
    [
      'Datum',
      doc.event.alternativeDate
        ? `${doc.event.date} (alt: ${doc.event.alternativeDate})`
        : doc.event.date,
    ],
    ['Tijd & duur', `${doc.event.timeRange} (${formatHours(doc.event.durationHours)})`],
    ['Ruimte(s)', roomsValue],
  ]);

  const addressParts = [
    doc.customer.billingAddress.street,
    `${doc.customer.billingAddress.postalCode} ${doc.customer.billingAddress.city}`.trim(),
    doc.customer.billingAddress.country,
  ].filter((part) => part.trim().length > 0);

  const customerEntries = buildEntries([
    ['Contactpersoon', doc.customer.fullName],
    ['Organisatie', doc.customer.company],
    ['E-mail', doc.customer.email],
    ['Telefoon', doc.customer.phone],
    ['Factuuradres', addressParts.join(', ') || '—'],
  ]);

  const measureCardHeight = (entries: DetailEntry[]): number =>
    30 + entries.reduce((sum, entry) => sum + 11 + entry.lines.length * 12 + 4, 0);

  const cardH = Math.max(measureCardHeight(eventEntries), measureCardHeight(customerEntries));
  ensureSpace(cardH);

  const drawDetailCard = (x: number, heading: string, entries: DetailEntry[]): void => {
    const topY = cursorY;
    page.fillRect(x, topY - cardH, colW, cardH, COLOR_PANEL_BG);
    page.strokeRect(x, topY - cardH, colW, cardH, COLOR_BORDER, 0.6);
    page.fillRect(x, topY - 3, colW, 3, COLOR_CYAN);
    page.text(heading, x + 11, topY - 18, { size: 9.5, bold: true, color: COLOR_BLACK });
    let y = topY - 33;
    for (const entry of entries) {
      page.text(entry.label.toUpperCase(), x + 11, y, {
        size: 7.5,
        bold: true,
        color: COLOR_MUTED,
      });
      y -= 11;
      for (const line of entry.lines) {
        page.text(line, x + 11, y, { size: 9, color: COLOR_DARK });
        y -= 12;
      }
      y -= 4;
    }
  };

  drawDetailCard(MARGIN_X, 'EVENEMENTGEGEVENS', eventEntries);
  drawDetailCard(MARGIN_X + colW + colGap, 'CONTACT & FACTURATIE', customerEntries);
  cursorY -= cardH + 16;

  // Optional customer wishes / notes
  if (doc.event.specialRequests || doc.event.customerNotes) {
    drawSectionHeading('WENSEN & OPMERKINGEN KLANT');
    const noteBlocks = [
      doc.event.specialRequests ? `Speciale wensen: ${doc.event.specialRequests}` : '',
      doc.event.customerNotes ? `Opmerkingen: ${doc.event.customerNotes}` : '',
    ].filter(Boolean);
    for (const block of noteBlocks) {
      const lines = wrapText(block, CONTENT_W - 12, 9);
      for (const line of lines) {
        ensureSpace(14);
        page.text(line, MARGIN_X + 6, cursorY - 10, { size: 9, color: COLOR_DARK });
        cursorY -= 13;
      }
      cursorY -= 4;
    }
    cursorY -= 6;
  }

  // Line items table
  const colLabelW = 192;
  const colDetailW = 195;
  const drawTableHeader = (continued = false): void => {
    const headerH = 22;
    ensureSpace(headerH + 24);
    page.fillRect(MARGIN_X, cursorY - headerH, CONTENT_W, headerH, COLOR_BLACK);
    page.text(continued ? 'ONDERDEEL (VERVOLG)' : 'ONDERDEEL', MARGIN_X + 8, cursorY - 14, {
      size: 8,
      bold: true,
      color: COLOR_WHITE,
    });
    page.text('SPECIFICATIE', MARGIN_X + colLabelW + 8, cursorY - 14, {
      size: 8,
      bold: true,
      color: COLOR_WHITE,
    });
    page.text('BEDRAG (EXCL. BTW)', rightEdge - 8, cursorY - 14, {
      size: 8,
      bold: true,
      color: COLOR_CYAN,
      align: 'right',
    });
    cursorY -= headerH;
  };

  drawSectionHeading('KOSTENOVERZICHT (CONCEPT)');
  drawTableHeader(false);

  doc.lineItems.forEach((item, index) => {
    const labelLines = wrapText(item.label, colLabelW - 14, 9, true);
    const detailLines = wrapText(item.detail, colDetailW - 14, 8.5, false);
    const lineCount = Math.max(labelLines.length, detailLines.length, 1);
    const rowH = lineCount * 12 + 10;

    if (cursorY - rowH < BOTTOM_LIMIT) {
      addPage();
      drawTableHeader(true);
    }

    const rowBottom = cursorY - rowH;
    if (index % 2 === 1) {
      page.fillRect(MARGIN_X, rowBottom, CONTENT_W, rowH, COLOR_ROW_ALT);
    }
    page.line(MARGIN_X, rowBottom, rightEdge, rowBottom, COLOR_BORDER, 0.5);

    let ly = cursorY - 14;
    for (const line of labelLines) {
      page.text(line, MARGIN_X + 8, ly, { size: 9, bold: true, color: COLOR_DARK });
      ly -= 12;
    }

    let dy = cursorY - 14;
    for (const line of detailLines) {
      page.text(line, MARGIN_X + colLabelW + 8, dy, { size: 8.5, color: COLOR_MUTED });
      dy -= 12;
    }

    const amountText =
      item.onRequest || item.amount == null ? 'Op aanvraag' : formatEuro(item.amount);
    page.text(amountText, rightEdge - 8, cursorY - 14, {
      size: 9,
      bold: true,
      color: item.onRequest ? COLOR_MAGENTA : COLOR_BLACK,
      align: 'right',
    });

    cursorY = rowBottom;
  });

  cursorY -= 12;

  // Totals block
  const totalsW = 272;
  const totalsX = rightEdge - totalsW;
  ensureSpace(74);

  page.fillRect(totalsX, cursorY - 68, totalsW, 68, COLOR_PANEL_BG);
  page.strokeRect(totalsX, cursorY - 68, totalsW, 68, COLOR_BORDER, 0.6);

  page.text('Subtotaal bekende kosten (excl. btw)', totalsX + 10, cursorY - 16, {
    size: 8.5,
    color: COLOR_MUTED,
  });
  page.text(formatEuro(doc.totals.subtotalExVat), rightEdge - 10, cursorY - 16, {
    size: 9,
    bold: true,
    color: COLOR_DARK,
    align: 'right',
  });

  page.text(`Btw (${doc.totals.vatRate}%, indicatief)`, totalsX + 10, cursorY - 32, {
    size: 8.5,
    color: COLOR_MUTED,
  });
  page.text(formatEuro(doc.totals.vatAmount), rightEdge - 10, cursorY - 32, {
    size: 9,
    bold: true,
    color: COLOR_DARK,
    align: 'right',
  });

  page.line(totalsX + 10, cursorY - 42, rightEdge - 10, cursorY - 42, COLOR_MAGENTA, 1.1);

  page.text('Totaal bekende kosten (incl. btw)', totalsX + 10, cursorY - 57, {
    size: 9.5,
    bold: true,
    color: COLOR_BLACK,
  });
  page.text(formatEuro(doc.totals.totalInclVat), rightEdge - 10, cursorY - 57, {
    size: 10.5,
    bold: true,
    color: COLOR_MAGENTA,
    align: 'right',
  });

  cursorY -= 80;

  // Explicit list of 'Op aanvraag' items when present
  if (doc.totals.hasOnRequest) {
    const onReqSummary = `Op aanvraag (niet in totaalbedrag inbegrepen): ${doc.totals.onRequestItems.join(', ')}`;
    const onReqLines = wrapText(onReqSummary, CONTENT_W - 20, 8.5, true);
    let idx = 0;
    while (idx < onReqLines.length) {
      if (cursorY - 26 < BOTTOM_LIMIT) addPage();
      const maxFit = Math.max(1, Math.floor((cursorY - BOTTOM_LIMIT - 12) / 12));
      const chunk = onReqLines.slice(idx, idx + maxFit);
      const onReqH = chunk.length * 12 + 12;
      page.fillRect(MARGIN_X, cursorY - onReqH, CONTENT_W, onReqH, COLOR_DISCLAIMER_BG);
      page.fillRect(MARGIN_X, cursorY - onReqH, 3.5, onReqH, COLOR_MAGENTA);
      let oy = cursorY - 14;
      for (const line of chunk) {
        page.text(line, MARGIN_X + 11, oy, { size: 8.5, bold: true, color: COLOR_DARK });
        oy -= 12;
      }
      cursorY -= onReqH + 14;
      idx += chunk.length;
    }
  }

  // Optional approved / staff / demo proposal explanation
  if (doc.explanation) {
    drawSectionHeading('VOORSTEL');
    const explanationLines = wrapText(doc.explanation, CONTENT_W - 12, 9.5, false);
    for (const line of explanationLines) {
      if (!line) {
        cursorY -= 7;
        continue;
      }
      ensureSpace(14);
      page.text(line, MARGIN_X + 6, cursorY - 10, { size: 9.5, color: COLOR_DARK });
      cursorY -= 13;
    }
    cursorY -= 12;
  }

  // Mandatory indicative-price disclaimer
  const disclaimerLines = wrapText(doc.disclaimer, CONTENT_W - 24, 8.5, false);
  const disclaimerH = disclaimerLines.length * 12 + 14;
  ensureSpace(disclaimerH);
  page.fillRect(MARGIN_X, cursorY - disclaimerH, CONTENT_W, disclaimerH, COLOR_PANEL_BG);
  page.strokeRect(MARGIN_X, cursorY - disclaimerH, CONTENT_W, disclaimerH, COLOR_BORDER, 0.6);
  page.fillRect(MARGIN_X, cursorY - disclaimerH, 3.5, disclaimerH, COLOR_MAGENTA);
  let discY = cursorY - 14;
  for (const line of disclaimerLines) {
    page.text(line, MARGIN_X + 12, discY, { size: 8.5, color: COLOR_DARK });
    discY -= 12;
  }
  cursorY -= disclaimerH;

  // Footers with page numbers across all pages
  const totalPages = pages.length;
  pages.forEach((canvas, idx) => {
    canvas.line(MARGIN_X, 46, rightEdge, 46, COLOR_BORDER, 0.5);
    canvas.text(`H20 Event Locatie · ${doc.reference} · Conceptofferte`, MARGIN_X, 32, {
      size: 8,
      color: COLOR_MUTED,
    });
    canvas.text(`Pagina ${idx + 1} van ${totalPages}`, rightEdge, 32, {
      size: 8,
      bold: true,
      color: COLOR_MUTED,
      align: 'right',
    });
  });

  // Assemble PDF 1.4 binary file with exact byte offsets
  const out = new ByteBuffer();
  out.writeAscii('%PDF-1.4\n');
  out.writeBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const totalObjects = 4 + totalPages * 2;
  const offsets = new Array<number>(totalObjects + 1).fill(0);

  const writeObj = (id: number, body: string | ((buf: ByteBuffer) => void)): void => {
    offsets[id] = out.length;
    out.writeAscii(`${id} 0 obj\n`);
    if (typeof body === 'string') {
      out.writeAscii(body);
      if (!body.endsWith('\n')) out.writeAscii('\n');
    } else {
      body(out);
    }
    out.writeAscii('endobj\n');
  };

  const kidsRefs = pages.map((_, idx) => `${5 + idx * 2} 0 R`).join(' ');

  writeObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  writeObj(2, `<< /Type /Pages /Kids [${kidsRefs}] /Count ${totalPages} >>`);
  writeObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  writeObj(
    4,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  pages.forEach((canvas, idx) => {
    const pageObjId = 5 + idx * 2;
    const contentObjId = 6 + idx * 2;
    const streamBytes = canvas.stream.toUint8Array();

    writeObj(
      pageObjId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(PAGE_W)} ${fmt(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`,
    );
    writeObj(contentObjId, (buf) => {
      buf.writeAscii(`<< /Length ${streamBytes.length} >>\nstream\n`);
      buf.writeBytes(streamBytes);
      buf.writeAscii('endstream\n');
    });
  });

  const xrefOffset = out.length;
  out.writeAscii(`xref\n0 ${totalObjects + 1}\n`);
  out.writeAscii('0000000000 65535 f \n');
  for (let id = 1; id <= totalObjects; id++) {
    out.writeAscii(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  out.writeAscii(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return out.toUint8Array();
}

export function downloadOfferPdf(doc: OfferDocument): void {
  const bytes = renderOfferPdf(doc);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const safeReference = (doc.reference || 'concept').replace(/[^A-Za-z0-9._-]+/g, '-');
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `H20-Conceptofferte-${safeReference}.pdf`;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
