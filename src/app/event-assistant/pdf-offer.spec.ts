import { vi } from 'vitest';
import {
  INITIAL_BOOKINGS,
  INITIAL_CATERING_PACKAGES,
  INITIAL_EVENT_UPGRADES,
  INITIAL_ROOMS,
} from './data/initial-data';
import { Booking } from './models';
import {
  OFFER_DISCLAIMER,
  buildOfferDocument,
  downloadOfferPdf,
  encodePdfLiteralString,
  encodeWinAnsi,
  renderOfferPdf,
} from './pdf-offer';

function decodeLatin1(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += String.fromCharCode(byte);
  }
  return out;
}

function containsSubarray(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe('pdf-offer', () => {
  const baseBooking = (): Booking => structuredClone(INITIAL_BOOKINGS[0]);

  describe('buildOfferDocument', () => {
    it('maps brand header, event details, customer details, priced & on-request line items, VAT totals, and disclaimer', () => {
      const booking = baseBooking();
      booking.event.additionalRooms = [
        { id: 'h20-lounge-cafe', name: 'H20 Lounge Café', price: 220 },
        { id: 'custom-room', name: 'VIP Deck', price: 0 },
      ];
      booking.selections.activities = ['Esports Toernooi', 'Custom VR Experience'];
      booking.selections.cateringSelections = ['Luxe Lunchbuffet', 'Networking Drinks Package'];
      booking.selections.addons = [
        {
          id: 'facility-led-screen',
          name: '50 m² High-Res LED Screen (Zaal Faciliteit)',
          price: 0,
        },
        { id: 'upg-host', name: 'Esports tournament host and guidance', price: 0 },
        { id: 'custom-dj', name: 'Custom DJ Show', price: 450 },
      ];

      const cateringWithPriced = [
        ...INITIAL_CATERING_PACKAGES,
        {
          ...INITIAL_CATERING_PACKAGES[0],
          id: 'cat-lunch-priced',
          name: 'Luxe Lunchbuffet',
          pricePerPerson: 18.5,
          priceDisplay: '€ 18,50 p.p.',
        },
      ];

      const doc = buildOfferDocument(booking, {
        live: false,
        rooms: INITIAL_ROOMS,
        catering: cateringWithPriced,
        upgrades: INITIAL_EVENT_UPGRADES,
        activities: [
          {
            name: 'Esports Toernooi',
            description: 'Toernooi',
            tag: 'Gaming',
            price: 350,
          },
          {
            name: 'Custom VR Experience',
            description: 'VR',
            tag: 'VR',
            price: null,
          },
        ],
      });

      expect(doc.brand).toBe('H20 EVENT LOCATIE');
      expect(doc.subtitle).toBe('CONCEPTOFFERTE');
      expect(doc.reference).toBe('H20-2026-0042');
      expect(doc.createdAt).toBe('28-10-2026');
      expect(doc.status).toBe('Confirmed');
      expect(doc.modeBanner).toContain('Demogegevens');

      expect(doc.event.name).toBe('KPN Annual Tech & Gaming Summit 2026');
      expect(doc.event.type).toBe('Bedrijfsevenement');
      expect(doc.event.date).toBe('18-11-2026');
      expect(doc.event.alternativeDate).toBe('25-11-2026');
      expect(doc.event.timeRange).toBe('09:30 – 17:30');
      expect(doc.event.durationHours).toBe(8);
      expect(doc.event.participants).toBe(280);
      expect(doc.event.mainRoom).toBe('Rabo Esports Stadium');
      expect(doc.event.additionalRooms).toEqual(['H20 Lounge Café', 'VIP Deck']);

      expect(doc.customer.fullName).toBe('Martijn van Dijk');
      expect(doc.customer.company).toBe('KPN Innovations B.V.');
      expect(doc.customer.email).toBe('m.vandijk@kpn-innovations.nl');
      expect(doc.customer.phone).toBe('+31 6 1234 5678');
      expect(doc.customer.billingAddress).toEqual({
        street: 'Maanplein 55',
        postalCode: '2516 CK',
        city: 'Den Haag',
        country: 'Nederland',
      });

      // Line items check
      const byLabel = Object.fromEntries(doc.lineItems.map((item) => [item.label, item]));
      expect(byLabel['Rabo Esports Stadium']).toMatchObject({
        amount: 650 * 8,
        onRequest: false,
      });
      expect(byLabel['H20 Lounge Café']).toMatchObject({
        amount: 220 * 8,
        onRequest: false,
      });
      expect(byLabel['VIP Deck']).toMatchObject({
        amount: null,
        onRequest: true,
      });
      expect(byLabel['Esports Toernooi']).toMatchObject({
        amount: 350,
        onRequest: false,
      });
      expect(byLabel['Custom VR Experience']).toMatchObject({
        amount: null,
        onRequest: true,
      });
      expect(byLabel['Luxe Lunchbuffet']).toMatchObject({
        amount: 18.5 * 280,
        onRequest: false,
      });
      expect(byLabel['Networking Drinks Package']).toMatchObject({
        amount: null,
        onRequest: true,
      });
      expect(byLabel['50 m² High-Res LED Screen (Zaal Faciliteit)']).toMatchObject({
        amount: 0,
        onRequest: false,
      });
      expect(byLabel['Esports tournament host and guidance']).toMatchObject({
        amount: null,
        onRequest: true,
      });
      expect(byLabel['Custom DJ Show']).toMatchObject({
        amount: 450,
        onRequest: false,
      });

      // Totals & on-request tracking
      expect(doc.totals.totalInclVat).toBe(12450);
      expect(doc.totals.vatAmount).toBe(2614.5);
      expect(doc.totals.subtotalExVat).toBe(9835.5);
      expect(doc.totals.vatRate).toBe(21);
      expect(doc.totals.hasOnRequest).toBe(true);
      expect(doc.totals.onRequestItems).toEqual([
        'VIP Deck',
        'Custom VR Experience',
        'Networking Drinks Package',
        'Esports tournament host and guidance',
      ]);

      expect(doc.disclaimer).toBe(OFFER_DISCLAIMER);
    });

    it('strips internalNotes, reviewNotes, planning, and unapproved live explanations', () => {
      const secretBooking: Booking = {
        ...baseBooking(),
        requestStatus: 'pending_review',
        explanation: 'Concept tekst die nog niet is vrijgegeven',
        reviewNotes: 'INTERNE REVIEW WAARSCHUWING GEHEIM',
        planning: [
          {
            startTime: '09:00',
            endTime: '10:00',
            activity: 'INTERNE CREW BRIEFING GEHEIM',
            room: 'Regiekamer',
            materials: 'Sleutelkluis code 9999',
            responsible: 'Hoofd Techniek',
          },
        ],
        reservation: {
          ...baseBooking().reservation,
          internalNotes: [
            {
              id: 'secret-note',
              text: 'STRIKT VERTROUWELIJKE INTERNE NOTITIE',
              author: 'Admin',
              createdAt: '2026-11-01',
            },
          ],
        },
      };

      // Customer in live mode with pending_review -> explanation omitted, all internal fields absent
      const pendingLiveDoc = buildOfferDocument(secretBooking, { live: true, admin: false });
      expect(pendingLiveDoc.modeBanner).toContain(
        'Pas definitief na overleg en akkoord op de offerte.',
      );
      expect(pendingLiveDoc.explanation).toBeUndefined();
      const pendingJson = JSON.stringify(pendingLiveDoc);
      expect(pendingJson).not.toContain('Concept tekst die nog niet is vrijgegeven');
      expect(pendingJson).not.toContain('STRIKT VERTROUWELIJKE INTERNE NOTITIE');
      expect(pendingJson).not.toContain('INTERNE REVIEW WAARSCHUWING GEHEIM');
      expect(pendingJson).not.toContain('INTERNE CREW BRIEFING GEHEIM');
      expect(pendingJson).not.toContain('Sleutelkluis code 9999');

      const pendingPdfText = decodeLatin1(renderOfferPdf(pendingLiveDoc));
      expect(pendingPdfText).not.toContain('STRIKT VERTROUWELIJKE INTERNE NOTITIE');
      expect(pendingPdfText).not.toContain('INTERNE REVIEW WAARSCHUWING GEHEIM');
      expect(pendingPdfText).not.toContain('INTERNE CREW BRIEFING GEHEIM');
      expect(pendingPdfText).not.toContain('Concept tekst die nog niet is vrijgegeven');

      // Approved live booking -> explanation included, internal fields still stripped
      const approvedLiveDoc = buildOfferDocument(
        { ...secretBooking, requestStatus: 'approved' },
        { live: true, admin: false },
      );
      expect(approvedLiveDoc.explanation).toBe('Concept tekst die nog niet is vrijgegeven');
      expect(JSON.stringify(approvedLiveDoc)).not.toContain(
        'STRIKT VERTROUWELIJKE INTERNE NOTITIE',
      );

      // Admin in live mode -> explanation included, internal notes/reviewNotes/planning STILL never in PDF
      const adminLiveDoc = buildOfferDocument(secretBooking, { live: true, admin: true });
      expect(adminLiveDoc.explanation).toBe('Concept tekst die nog niet is vrijgegeven');
      const adminPdfText = decodeLatin1(renderOfferPdf(adminLiveDoc));
      expect(adminPdfText).not.toContain('STRIKT VERTROUWELIJKE INTERNE NOTITIE');
      expect(adminPdfText).not.toContain('INTERNE REVIEW WAARSCHUWING GEHEIM');
      expect(adminPdfText).not.toContain('INTERNE CREW BRIEFING GEHEIM');

      // Demo mode -> explanation included
      const demoDoc = buildOfferDocument(secretBooking, { live: false, admin: false });
      expect(demoDoc.explanation).toBe('Concept tekst die nog niet is vrijgegeven');
    });
  });

  describe('WinAnsi encoding & PDF 1.4 binary generation', () => {
    it('encodes € and Dutch diacritics/punctuation to exact CP1252 bytes and escapes (, ), \\', () => {
      const sample = '€ëéèïöü·–—²';
      const bytes = Array.from(encodeWinAnsi(sample));
      expect(bytes).toEqual([
        0x80, // €
        0xeb, // ë
        0xe9, // é
        0xe8, // è
        0xef, // ï
        0xf6, // ö
        0xfc, // ü
        0xb7, // ·
        0x96, // –
        0x97, // —
        0xb2, // ²
      ]);

      const literal = decodeLatin1(encodePdfLiteralString('Prijs (incl. btw) \\ € 50'));
      expect(literal).toBe('(Prijs \\(incl. btw\\) \\\\ \x80 50)');
    });

    it('produces a valid PDF 1.4 document with exact xref byte offsets, stream lengths, and WinAnsi bytes', () => {
      const booking = baseBooking();
      booking.customer.company = 'Coöperatie Café (België) \\ B.V.';
      booking.event.name = '50 m² Arena — Één groot feest · reünie';

      const doc = buildOfferDocument(booking, {
        live: true,
        rooms: INITIAL_ROOMS,
        catering: INITIAL_CATERING_PACKAGES,
        upgrades: INITIAL_EVENT_UPGRADES,
      });
      const pdf = renderOfferPdf(doc);
      const raw = decodeLatin1(pdf);

      expect(raw.startsWith('%PDF-1.4\n')).toBe(true);
      expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(raw).toContain('/MediaBox [0 0 595.28 841.89]');
      expect(raw).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
      expect(raw).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding');

      // Contains CP1252 Euro sign (0x80) followed by space and formatted total "12.450,00"
      const expectedEuroTotal = Array.from(encodeWinAnsi('€ 12.450,00'));
      expect(containsSubarray(pdf, expectedEuroTotal)).toBe(true);

      // Contains escaped parentheses and backslash for customer company
      expect(raw).toContain('\\(Belgi\xeb\\) \\\\ B.V.');

      // Validate startxref points to exact byte offset of "xref\n"
      const startXrefMatch = /startxref\n(\d+)\n%%EOF/.exec(raw);
      expect(startXrefMatch).not.toBeNull();
      const xrefPos = Number(startXrefMatch![1]);
      expect(raw.slice(xrefPos, xrefPos + 5)).toBe('xref\n');

      // Validate every xref entry is exactly 20 bytes and points to the exact object header byte offset
      const trailerIdx = raw.indexOf('trailer\n', xrefPos);
      const xrefLines = raw.slice(xrefPos, trailerIdx).split('\n').filter(Boolean);
      const headerMatch = /^0 (\d+)$/.exec(xrefLines[1]);
      expect(headerMatch).not.toBeNull();
      const objectCount = Number(headerMatch![1]);
      expect(xrefLines.length).toBe(2 + objectCount);

      for (let i = 0; i < objectCount; i++) {
        const entryWithLf = `${xrefLines[2 + i]}\n`;
        expect(entryWithLf.length).toBe(20);
        if (i === 0) {
          expect(entryWithLf).toBe('0000000000 65535 f \n');
        } else {
          const offset = Number(entryWithLf.slice(0, 10));
          const expectedObjPrefix = `${i} 0 obj\n`;
          expect(raw.slice(offset, offset + expectedObjPrefix.length)).toBe(expectedObjPrefix);
        }
      }

      // Validate stream /Length matches exact byte count between "stream\n" and "endstream\n"
      const streamRegex = /<< \/Length (\d+) >>\nstream\n/g;
      let match: RegExpExecArray | null;
      let checkedStreams = 0;
      while ((match = streamRegex.exec(raw)) !== null) {
        const declaredLen = Number(match[1]);
        const streamStart = match.index + match[0].length;
        expect(raw.slice(streamStart + declaredLen, streamStart + declaredLen + 10)).toBe(
          'endstream\n',
        );
        checkedStreams++;
      }
      expect(checkedStreams).toBeGreaterThan(0);
    });

    it('paginates cleanly across multiple A4 pages on overflow and numbers each page', () => {
      const booking = baseBooking();
      booking.requestStatus = 'approved';
      booking.selections.activities = Array.from(
        { length: 35 },
        (_, i) => `Activiteit Onderdeel Nummer ${i + 1} met uitgebreide omschrijving`,
      );
      booking.explanation = Array.from(
        { length: 30 },
        (_, i) =>
          `Paragraaf ${i + 1}: Dit uitgebreide conceptvoorstel beschrijft de opbouw, techniek, ontvangst en hospitality in het Rabo Esports Stadium voor uw gasten.`,
      ).join('\n\n');

      const doc = buildOfferDocument(booking, {
        live: true,
        rooms: INITIAL_ROOMS,
        catering: INITIAL_CATERING_PACKAGES,
        upgrades: INITIAL_EVENT_UPGRADES,
      });
      const pdf = renderOfferPdf(doc);
      const raw = decodeLatin1(pdf);

      const countMatch = /\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/.exec(raw);
      expect(countMatch).not.toBeNull();
      const pageCount = Number(countMatch![1]);
      expect(pageCount).toBeGreaterThanOrEqual(2);

      expect(raw).toContain(`(Pagina 1 van ${pageCount})`);
      expect(raw).toContain(`(Pagina ${pageCount} van ${pageCount})`);
      expect(raw).toContain('(ONDERDEEL \\(VERVOLG\\))');
    });
  });

  describe('downloadOfferPdf', () => {
    afterEach(() => vi.restoreAllMocks());

    it('creates an application/pdf Blob, clicks <a download="H20-Conceptofferte-...">, and revokes the object URL', async () => {
      let capturedBlob: Blob | undefined;
      const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((obj) => {
        capturedBlob = obj as Blob;
        return 'blob:https://h20.test/offer-1';
      });
      const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

      let clickedDownload = '';
      let clickedHref = '';
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        clickedDownload = this.download;
        clickedHref = this.href;
      });

      const doc = buildOfferDocument(baseBooking(), {
        live: false,
        rooms: INITIAL_ROOMS,
      });
      downloadOfferPdf(doc);

      expect(createUrlSpy).toHaveBeenCalledTimes(1);
      expect(capturedBlob).toBeInstanceOf(Blob);
      expect(capturedBlob!.type).toBe('application/pdf');

      const bytes = new Uint8Array(await capturedBlob!.arrayBuffer());
      expect(decodeLatin1(bytes.subarray(0, 9))).toBe('%PDF-1.4\n');

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(clickedDownload).toBe('H20-Conceptofferte-H20-2026-0042.pdf');
      expect(clickedHref).toBe('blob:https://h20.test/offer-1');
      expect(revokeUrlSpy).toHaveBeenCalledWith('blob:https://h20.test/offer-1');
    });
  });
});
