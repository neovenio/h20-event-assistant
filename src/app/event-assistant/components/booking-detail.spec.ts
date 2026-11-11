import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BookingDetail } from './booking-detail';
import { EventStore } from '../event-store';
import {
  INITIAL_BOOKINGS,
  INITIAL_CATERING_PACKAGES,
  INITIAL_EVENT_UPGRADES,
  INITIAL_ROOMS,
} from '../data/initial-data';
import { Booking } from '../models';

function decodeLatin1(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += String.fromCharCode(byte);
  }
  return out;
}

describe('BookingDetail PDF download and print', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  async function renderDetail(options: { live: boolean; admin?: boolean; booking?: Booking }) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url === '/h20-runtime.json') {
          return {
            ok: true,
            json: async () => ({
              n8nWebhookBaseUrl: options.live ? 'https://example.test/webhook/h20' : '',
            }),
          };
        }
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            rooms: INITIAL_ROOMS,
            catering: INITIAL_CATERING_PACKAGES,
            upgrades: INITIAL_EVENT_UPGRADES,
            activities: [{ name: 'Esports Toernooi', description: '', tag: 'Gaming', price: 400 }],
          }),
        };
      }),
    );

    await TestBed.configureTestingModule({
      imports: [BookingDetail],
    }).compileComponents();

    const booking = options.booking ?? structuredClone(INITIAL_BOOKINGS[0]);
    const store = TestBed.inject(EventStore);
    const fixture = TestBed.createComponent(BookingDetail);
    fixture.componentRef.setInput('value', booking);
    fixture.componentRef.setInput('admin', Boolean(options.admin));
    await fixture.whenStable();
    await vi.waitFor(() => expect(store.loading()).toBe(false));
    store.bookings.set([booking]);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, store, booking };
  }

  it('downloads a real PDF and triggers browser print in demo mode', async () => {
    const { fixture, store, booking } = await renderDetail({ live: false });
    expect(store.live()).toBe(false);

    let capturedBlob: Blob | undefined;
    let clickedDownload = '';
    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj) => {
      capturedBlob = obj as Blob;
      return 'blob:https://demo.h20.test/pdf';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedDownload = this.download;
      });

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('footer.modal-footer button'),
    ) as HTMLButtonElement[];
    const printBtn = buttons.find((btn) => btn.textContent?.trim() === 'Afdrukken');
    const pdfBtn = buttons.find((btn) => btn.textContent?.trim() === 'Download PDF');

    expect(printBtn).toBeDefined();
    expect(pdfBtn).toBeDefined();
    expect(pdfBtn!.classList.contains('primary')).toBe(true);

    pdfBtn!.click();
    await vi.waitFor(() => expect(anchorClickSpy).toHaveBeenCalledTimes(1));
    await fixture.whenStable();

    expect(fixture.componentInstance.downloadingPdf).toBe(false);
    expect(pdfBtn!.disabled).toBe(false);
    expect(clickedDownload).toBe(`H20-Conceptofferte-${booking.reference}.pdf`);
    expect(capturedBlob?.type).toBe('application/pdf');
    expect(revokeSpy).toHaveBeenCalledWith('blob:https://demo.h20.test/pdf');

    const pdfText = decodeLatin1(new Uint8Array(await capturedBlob!.arrayBuffer()));
    expect(pdfText.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdfText).toContain('Demogegevens, geen echte boeking of factuur.');
    expect(pdfText).toContain(booking.reference);

    // Verify existing browser print still works alongside PDF download
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    printBtn!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.invoice).toBe(true);
    await vi.waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });

  it('downloads a real PDF and triggers browser print in connected (live) mode while respecting privacy rules', async () => {
    const liveBooking: Booking = {
      ...structuredClone(INITIAL_BOOKINGS[0]),
      reference: 'H20-LIVE-9001',
      requestStatus: 'pending_review',
      explanation: 'Nog niet goedgekeurde AI concepttekst',
      reviewNotes: 'INTERNE REVIEW NOTITIE',
      planning: [
        {
          startTime: '09:00',
          endTime: '10:00',
          activity: 'INTERNE PLANNING REGIE',
          room: 'Stadium',
          materials: 'Geheim',
          responsible: 'Crew',
        },
      ],
    };

    const { fixture, store } = await renderDetail({
      live: true,
      admin: false,
      booking: liveBooking,
    });
    expect(store.live()).toBe(true);

    let capturedBlob: Blob | undefined;
    let clickedDownload = '';
    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj) => {
      capturedBlob = obj as Blob;
      return 'blob:https://live.h20.test/pdf';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedDownload = this.download;
      });

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('footer.modal-footer button'),
    ) as HTMLButtonElement[];
    const printBtn = buttons.find((btn) => btn.textContent?.trim() === 'Afdrukken')!;
    const pdfBtn = buttons.find((btn) => btn.textContent?.trim() === 'Download PDF')!;

    pdfBtn.click();
    await vi.waitFor(() => expect(anchorClickSpy).toHaveBeenCalledTimes(1));
    await fixture.whenStable();

    expect(clickedDownload).toBe('H20-Conceptofferte-H20-LIVE-9001.pdf');
    expect(revokeSpy).toHaveBeenCalledWith('blob:https://live.h20.test/pdf');

    const pdfText = decodeLatin1(new Uint8Array(await capturedBlob!.arrayBuffer()));
    expect(pdfText.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdfText).toContain('Pas definitief na overleg en akkoord op de offerte.');
    expect(pdfText).not.toContain('Nog niet goedgekeurde AI concepttekst');
    expect(pdfText).not.toContain('INTERNE REVIEW NOTITIE');
    expect(pdfText).not.toContain('INTERNE PLANNING REGIE');

    // Once approved, live customer PDF includes the approved proposal explanation
    store.bookings.set([{ ...liveBooking, requestStatus: 'approved' }]);
    fixture.detectChanges();
    pdfBtn.click();
    await vi.waitFor(() => expect(anchorClickSpy).toHaveBeenCalledTimes(2));

    const approvedPdfText = decodeLatin1(new Uint8Array(await capturedBlob!.arrayBuffer()));
    expect(approvedPdfText).toContain('Nog niet goedgekeurde AI concepttekst');
    expect(approvedPdfText).not.toContain('INTERNE REVIEW NOTITIE');

    // Browser print remains available in connected mode too
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    printBtn.click();
    await vi.waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });
});
