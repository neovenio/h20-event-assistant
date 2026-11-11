import { Component, computed, inject, input, output } from '@angular/core';
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
  readonly store = inject(EventStore);
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
  print(): void {
    this.invoice = true;
    setTimeout(() => window.print(), 0);
  }
}
