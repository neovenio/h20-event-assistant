import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe } from '@angular/common';
import { EventConfiguration, Booking } from '../models';
import { EventStore } from '../event-store';
import { estimate } from '../event-utils';
import { Modal } from './modal';
@Component({
  selector: 'app-booking-form',
  imports: [FormsModule, CurrencyPipe, Modal],
  template: ` <app-modal heading="Evenementaanvraag" (dismissed)="dismissed.emit()"
    ><p>{{ config().name }} · {{ config().date }} · {{ config().participants }} personen</p>
    <p>
      Bekende kosten: {{ price.total | currency: 'EUR' }}
      {{ price.onRequest ? '+ opties op aanvraag' : '' }}
    </p>
    <form #form="ngForm" (ngSubmit)="submit()">
      <div class="form-grid">
        <label
          >Naam<input
            name="fullName"
            [(ngModel)]="customer.fullName"
            required
            maxlength="120"
            autocomplete="name" /></label
        ><label
          >E-mail<input
            name="email"
            type="email"
            [(ngModel)]="customer.email"
            required
            email
            autocomplete="email" /></label
        ><label
          >Telefoon<input
            name="phone"
            type="tel"
            [(ngModel)]="customer.phone"
            autocomplete="tel" /></label
        ><label
          >Bedrijf<input
            name="company"
            [(ngModel)]="customer.company"
            autocomplete="organization" /></label
        ><label class="full"
          >Straat en huisnummer<input
            name="street"
            [(ngModel)]="customer.billingAddress.street"
            autocomplete="street-address" /></label
        ><label
          >Postcode<input
            name="postcode"
            [(ngModel)]="customer.billingAddress.postalCode"
            autocomplete="postal-code" /></label
        ><label
          >Plaats<input
            name="city"
            [(ngModel)]="customer.billingAddress.city"
            autocomplete="address-level2"
        /></label>
      </div>
      <p class="notice">
        {{
          store.live()
            ? 'Je aanvraag wordt naar het H20-team gestuurd voor beoordeling. Er wordt nog niets definitief geboekt of betaald.'
            : 'Demo: deze aanvraag wordt alleen in deze browser bewaard. Gebruik fictieve contactgegevens; er wordt niets verzonden of betaald.'
        }}
      </p>
      <label class="check"
        ><input name="consent" type="checkbox" [(ngModel)]="consent" required /> Ik ga akkoord met
        het verwerken van deze gegevens voor mijn aanvraag.</label
      >
      @if (error) {
        <p class="error" role="alert">{{ error }}</p>
      }
      <footer class="modal-footer">
        <button type="button" (click)="dismissed.emit()">Terug</button
        ><button class="primary" type="submit" [disabled]="form.invalid || !consent || busy">
          {{ busy ? 'Bezig…' : store.live() ? 'Aanvraag indienen' : 'Demoaanvraag opslaan' }}
        </button>
      </footer>
    </form></app-modal
  >`,
})
export class BookingForm {
  readonly store = inject(EventStore);
  readonly config = input.required<EventConfiguration>();
  readonly dismissed = output<void>();
  readonly created = output<Booking>();
  customer: Booking['customer'] = {
    fullName: '',
    email: '',
    phone: '',
    company: '',
    billingAddress: { street: '', postalCode: '', city: '', country: 'Nederland' },
  };
  consent = false;
  busy = false;
  error = '';
  get price() {
    return estimate(
      this.config(),
      this.store.rooms(),
      this.store.catering(),
      this.store.upgrades(),
      this.store.live() ? this.store.activities() : undefined,
    );
  }
  async submit(): Promise<void> {
    if (!this.consent || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      this.created.emit(await this.store.createBooking(this.config(), this.customer));
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'De aanvraag kon niet worden opgeslagen.';
    } finally {
      this.busy = false;
    }
  }
}
