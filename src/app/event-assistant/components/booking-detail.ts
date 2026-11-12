import { ChangeDetectorRef, Component, computed, inject, input, output } from '@angular/core';
import { statusLabel } from '../status-label';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EventStore } from '../event-store';
import { Booking } from '../models';
import { Modal } from './modal';
@Component({
  selector: 'app-booking-detail',
  imports: [Modal, CurrencyPipe, DatePipe, FormsModule],
  templateUrl: './booking-detail.html',
})
export class BookingDetail {
  readonly statusLabel = statusLabel;
  readonly store = inject(EventStore);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly value = input.required<Booking>();
  readonly admin = input(false);
  readonly dismissed = output<void>();
  readonly booking = computed(
    () => this.store.bookings().find((item) => item.id === this.value().id) ?? this.value(),
  );
  note = '';
  refundAmount = 0;
  refundReason = '';
  error = '';
  busy = false;
  downloadingPdf = false;
  invoice = false;
  reviewText = '';
  editing = false;
  async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await action();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Wijzigen mislukt.';
    } finally {
      this.busy = false;
    }
  }
  status(action: 'approve' | 'reject' | 'cancel'): void {
    void this.run(() => this.store.changeStatus(this.booking().id, action));
  }
  addNote(): void {
    void this.run(async () => {
      await this.store.addNote(this.booking().id, this.note);
      this.note = '';
    });
  }
  refund(): void {
    void this.run(async () => {
      await this.store.refund(this.booking().id, this.refundAmount, this.refundReason);
      this.refundAmount = 0;
      this.refundReason = '';
    });
  }
  saveReview(): void {
    void this.run(async () => {
      await this.store.saveReview(
        this.booking().id,
        this.reviewText,
        this.booking().reviewNotes ?? '',
      );
      this.editing = false;
    });
  }
  async downloadPdf(): Promise<void> {
    if (this.downloadingPdf) return;
    this.downloadingPdf = true;
    this.error = '';
    try {
      const { buildOfferDocument, downloadOfferPdf } = await import('../pdf-offer');
      const doc = buildOfferDocument(this.booking(), {
        live: this.store.live(),
        admin: this.admin(),
        rooms: this.store.rooms(),
        catering: this.store.catering(),
        upgrades: this.store.upgrades(),
        activities: this.store.activities(),
      });
      downloadOfferPdf(doc);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'PDF downloaden is mislukt.';
    } finally {
      this.downloadingPdf = false;
      this.cdr.markForCheck();
    }
  }
  print(): void {
    this.invoice = true;
    setTimeout(() => window.print(), 0);
  }
}
