import { Component, computed, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../auth-service';
import { EventStore } from '../event-store';
import { isValidIsoDate, isWeekdayDate, localDate, nextWeekday } from '../event-utils';
import { Appointment, AppointmentFormat, AppointmentSlot } from '../models';
import { Modal } from './modal';

@Component({
  selector: 'app-appointment-modal',
  imports: [FormsModule, DatePipe, Modal],
  template: `
    <app-modal heading="Plan rondleiding of intake" (dismissed)="dismissed.emit()">
      @if (confirmed(); as booked) {
        <div class="panel confirmation" role="status">
          <span class="badge">Aanvraag ontvangen</span>
          <h3>Je afspraakverzoek staat genoteerd</h3>
          <p>
            Referentie: <strong>{{ booked.reference }}</strong>
          </p>
          <p>
            {{
              booked.format === 'location_tour' ? 'Rondleiding op locatie' : 'Online intakegesprek'
            }}
            · {{ booked.date | date: 'dd-MM-yyyy' }} · {{ booked.startTime }}–{{ booked.endTime }}
          </p>
          <p class="muted">
            {{
              store.live()
                ? 'Status: In afwachting van bevestiging door een H20-medewerker.'
                : 'Demo: deze afspraak is lokaal in deze browser opgeslagen. Er is niets verzonden.'
            }}
          </p>
          <footer class="modal-footer">
            <button type="button" (click)="dismissed.emit()">Sluiten</button>
            <button type="button" class="primary" (click)="created.emit(booked)">
              Bekijk in Mijn voorstellen
            </button>
          </footer>
        </div>
      } @else {
        <p>
          Plan een rondleiding op locatie in Purmerend of een online intakegesprek met het H20-team
          op een geverifieerd beschikbaar tijdslot.
        </p>
        @if (store.live() && !auth.user()) {
          <div class="notice login-prompt" role="status">
            <span>
              Je kunt alvast de beschikbare tijdsloten bekijken. Log in met je H20-account om de
              afspraak vast te leggen.
            </span>
            <button type="button" (click)="requestLogin.emit()">Inloggen / account</button>
          </div>
        }
        <form #formEl (ngSubmit)="submit(formEl)">
          <fieldset class="choice-group">
            <legend>Kies afspraakvorm *</legend>
            <div class="slot-grid">
              <div class="radio-card" [class.selected]="format === 'location_tour'">
                <input
                  type="radio"
                  id="appt-format-tour"
                  name="format"
                  value="location_tour"
                  [(ngModel)]="format"
                  required
                />
                <label for="appt-format-tour">
                  <strong>Rondleiding op locatie</strong>
                  <span>Bekijk de zalen en faciliteiten in Purmerend</span>
                </label>
              </div>
              <div class="radio-card" [class.selected]="format === 'online_intake'">
                <input
                  type="radio"
                  id="appt-format-online"
                  name="format"
                  value="online_intake"
                  [(ngModel)]="format"
                  required
                />
                <label for="appt-format-online">
                  <strong>Online intakegesprek</strong>
                  <span>Bespreek wensen en opzet via videocall</span>
                </label>
              </div>
            </div>
          </fieldset>

          <div class="field">
            <label for="appt-date">Datum *</label>
            <span id="appt-date-hint" class="hint">
              Standaard beschikbaar op werkdagen (maandag t/m vrijdag).
            </span>
            <input
              type="date"
              id="appt-date"
              name="date"
              [min]="minDate"
              [ngModel]="date()"
              (ngModelChange)="loadSlots($event)"
              aria-describedby="appt-date-hint"
              aria-invalid="false"
              required
            />
          </div>

          @if (isWeekendSelection()) {
            <p class="notice" role="status">
              Op zaterdag en zondag zijn er geen standaard intaketijdsloten. Kies een werkdag
              (maandag t/m vrijdag).
            </p>
          }

          <fieldset class="choice-group">
            <legend>Geverifieerde tijdsloten *</legend>
            @if (loadingSlots()) {
              <progress aria-label="Beschikbare tijdsloten laden"></progress>
            }
            <div class="slot-grid">
              @for (slot of slots(); track slot.startTime; let i = $index) {
                <div
                  class="radio-card"
                  [class.selected]="selectedSlot === slot.startTime && slot.available"
                  [class.unavailable]="!slot.available"
                >
                  <input
                    type="radio"
                    [id]="'appt-slot-' + i"
                    name="slot"
                    [value]="slot.startTime"
                    [(ngModel)]="selectedSlot"
                    [disabled]="!slot.available"
                    required
                  />
                  <label [for]="'appt-slot-' + i">
                    <strong>{{ slot.startTime }} – {{ slot.endTime }}</strong>
                    <span>{{ slot.available ? 'Beschikbaar' : 'Niet beschikbaar' }}</span>
                  </label>
                </div>
              }
            </div>
            @if (
              !loadingSlots() && slots().length && !hasAvailableSlot() && !isWeekendSelection()
            ) {
              <p class="notice" role="status">
                Alle tijdsloten op deze datum zijn bezet of gesloten. Kies een andere werkdag.
              </p>
            }
          </fieldset>

          <div class="form-grid">
            <div class="field">
              <label for="appt-name">Naam *</label>
              <input
                type="text"
                id="appt-name"
                name="fullName"
                [(ngModel)]="customer.fullName"
                autocomplete="name"
                maxlength="120"
                required
                aria-invalid="false"
                data-error="appt-name-error"
                (blur)="markTouched($event)"
                (input)="clearIfValid($event)"
              />
              <span id="appt-name-error" class="error-msg">Vul je volledige naam in.</span>
            </div>
            <div class="field">
              <label for="appt-email">E-mailadres *</label>
              <span id="appt-email-hint" class="hint">Bijvoorbeeld naam&#64;bedrijf.nl</span>
              <input
                type="email"
                id="appt-email"
                name="email"
                [(ngModel)]="customer.email"
                autocomplete="email"
                autocorrect="off"
                autocapitalize="none"
                spellcheck="false"
                maxlength="254"
                required
                aria-invalid="false"
                aria-describedby="appt-email-hint"
                data-error="appt-email-error"
                (blur)="markTouched($event)"
                (input)="clearIfValid($event)"
              />
              <span id="appt-email-error" class="error-msg">
                Vul een geldig e-mailadres in (zoals naam&#64;bedrijf.nl).
              </span>
            </div>
            <div class="field">
              <label for="appt-phone">Telefoonnummer</label>
              <input
                type="tel"
                id="appt-phone"
                name="phone"
                [(ngModel)]="customer.phone"
                autocomplete="tel"
                maxlength="40"
              />
            </div>
            <div class="field">
              <label for="appt-company">Bedrijf of organisatie</label>
              <input
                type="text"
                id="appt-company"
                name="company"
                [(ngModel)]="customer.company"
                autocomplete="organization"
                maxlength="160"
              />
            </div>
            <div class="field full">
              <label for="appt-notes">Toelichting of vragen</label>
              <span id="appt-notes-hint" class="hint">
                Optioneel, maximaal 1000 tekens (bijv. groepsgrootte of gewenste zalen).
              </span>
              <textarea
                id="appt-notes"
                name="notes"
                rows="3"
                maxlength="1000"
                [(ngModel)]="notes"
                aria-describedby="appt-notes-hint"
              ></textarea>
            </div>
          </div>

          @if (error) {
            <p class="error" role="alert">{{ error }}</p>
          }

          <footer class="modal-footer">
            <button type="button" (click)="dismissed.emit()">Annuleren</button>
            @if (store.live() && !auth.user()) {
              <button type="button" class="primary" (click)="requestLogin.emit()">
                Inloggen om afspraak te plannen
              </button>
            } @else {
              <button type="submit" class="primary" [disabled]="busy">
                {{
                  busy ? 'Bezig…' : store.live() ? 'Afspraak aanvragen' : 'Demoafspraak inplannen'
                }}
              </button>
            }
          </footer>
        </form>
      }
    </app-modal>
  `,
  styles: `
    .choice-group {
      border: 0;
      padding: 0;
      margin: 18px 0;
    }
    legend {
      font-size: 13px;
      font-weight: 700;
      padding: 0;
      margin-bottom: 10px;
    }
    .slot-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .radio-card {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      border: 1px solid #0004;
      padding: 12px 14px;
      min-block-size: 48px;
    }
    .radio-card input[type='radio'] {
      width: 18px;
      height: 18px;
      margin: 2px 0 0;
      accent-color: #e1014b;
      flex-shrink: 0;
    }
    .radio-card label {
      gap: 2px;
      cursor: pointer;
      flex: 1;
    }
    .radio-card span,
    .hint {
      font-size: 12px;
      color: #000a;
    }
    .unavailable {
      opacity: 0.55;
      background: #00000008;
    }
    .unavailable label {
      cursor: not-allowed;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .error-msg {
      display: none;
      color: #b0003a;
      font-size: 12px;
      font-weight: 600;
    }
    input:is(:user-invalid, [aria-invalid='true']) {
      border-color: #e1014b;
      background: #e1014b0a;
    }
    input:is(:user-invalid, [aria-invalid='true']) + .error-msg {
      display: block;
    }
    .login-prompt {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    @media (max-width: 600px) {
      .slot-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AppointmentModal {
  readonly store = inject(EventStore);
  readonly auth = inject(AuthService);
  readonly dismissed = output<void>();
  readonly created = output<Appointment>();
  readonly requestLogin = output<void>();

  readonly minDate = localDate();
  readonly date = signal(nextWeekday());
  readonly slots = signal<AppointmentSlot[]>([]);
  readonly loadingSlots = signal(false);
  readonly confirmed = signal<Appointment | null>(null);
  readonly hasAvailableSlot = computed(() => this.slots().some((slot) => slot.available));
  readonly isWeekendSelection = computed(
    () => isValidIsoDate(this.date()) && !isWeekdayDate(this.date()),
  );

  format: AppointmentFormat = 'location_tour';
  selectedSlot = '';
  customer = {
    fullName: '',
    email: this.auth.user()?.email ?? '',
    phone: '',
    company: '',
  };
  notes = '';
  busy = false;
  error = '';
  private loadVersion = 0;

  constructor() {
    void this.loadSlots(this.date());
  }

  async loadSlots(nextDate: string): Promise<void> {
    this.date.set(nextDate);
    this.error = '';
    if (!isValidIsoDate(nextDate)) {
      this.slots.set([]);
      this.selectedSlot = '';
      return;
    }
    const version = ++this.loadVersion;
    this.loadingSlots.set(true);
    try {
      const list = await this.store.getAppointmentSlots(nextDate);
      if (version !== this.loadVersion) return;
      this.slots.set(list);
      const stillAvailable = list.some(
        (slot) => slot.startTime === this.selectedSlot && slot.available,
      );
      if (!stillAvailable) {
        this.selectedSlot = list.find((slot) => slot.available)?.startTime ?? '';
      }
    } catch (err) {
      if (version !== this.loadVersion) return;
      this.slots.set([]);
      this.selectedSlot = '';
      this.error = err instanceof Error ? err.message : 'Tijdsloten konden niet worden geladen.';
    } finally {
      if (version === this.loadVersion) this.loadingSlots.set(false);
    }
  }

  markTouched(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) return;
    this.setInvalidState(input, !input.validity.valid);
  }

  clearIfValid(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input || input.getAttribute('aria-invalid') !== 'true') return;
    if (input.validity.valid) this.setInvalidState(input, false);
  }

  private setInvalidState(input: HTMLInputElement, invalid: boolean): void {
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    const errorId = input.dataset['error'];
    if (!errorId) return;
    const ids = (input.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (invalid) ids.push(errorId);
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
    else input.removeAttribute('aria-describedby');
  }

  async submit(formEl: HTMLFormElement): Promise<void> {
    if (this.busy) return;
    this.error = '';
    const textInputs = Array.from(formEl.querySelectorAll<HTMLInputElement>('input[data-error]'));
    for (const input of textInputs) {
      this.setInvalidState(input, !input.validity.valid);
    }
    const firstInvalid = textInputs.find((input) => !input.validity.valid);
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
    if (!this.selectedSlot) {
      this.error = 'Kies een beschikbaar tijdslot.';
      return;
    }
    const slotObj = this.slots().find((s) => s.startTime === this.selectedSlot);
    this.busy = true;
    try {
      const booked = await this.store.createAppointment({
        date: this.date(),
        startTime: this.selectedSlot,
        endTime: slotObj?.endTime,
        format: this.format,
        customer: this.customer,
        notes: this.notes,
      });
      this.confirmed.set(booked);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'De afspraak kon niet worden ingepland.';
      await this.loadSlots(this.date());
    } finally {
      this.busy = false;
    }
  }
}
