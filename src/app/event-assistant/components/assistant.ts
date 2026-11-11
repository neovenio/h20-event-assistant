import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../auth-service';
import { EventStore } from '../event-store';
import { EventConfiguration } from '../models';
import { emptyConfiguration } from '../event-utils';
@Component({
  selector: 'app-assistant',
  imports: [FormsModule],
  template: ` <section class="panel assistant">
    <div class="section-heading">
      <div>
        <span class="badge">✦ H20</span>
        <h2>AI Assistent</h2>
      </div>
      <span class="status-dot">{{ store.live() ? 'n8n' : 'Demo' }}</span>
    </div>
    <p class="muted">
      {{
        store.live()
          ? 'Plan samen jouw evenement. Een medewerker beoordeelt elk voorstel.'
          : 'Verken de mogelijkheden met de lokale keuzehulp. Live AI is nog niet verbonden.'
      }}
    </p>
    <div class="chat-messages" aria-live="polite">
      @for (message of messages(); track $index) {
        <div class="chat-message" [class.from-user]="message.sender === 'user'">
          <small>{{
            message.sender === 'user' ? 'Jij' : store.live() ? 'H20 Assistent' : 'Demo-keuzehulp'
          }}</small>
          <p>{{ message.text }}</p>
        </div>
      }
      @if (busy()) {
        <p class="muted">Een moment…</p>
      }
    </div>
    @if (loginRequired()) {
      <div class="notice" role="status">
        <p>Log in met je H20-account om met de live AI-assistent te chatten.</p>
        <button type="button" class="primary wide" (click)="requestLogin.emit()">
          Inloggen om te chatten
        </button>
      </div>
    }
    <div class="chips">
      @for (
        chip of ['Een zaal aanbevelen', 'Activiteiten voorstellen', 'Mijn budget bespreken'];
        track chip
      ) {
        <button type="button" (click)="send(chip)" [disabled]="busy() || loginRequired()">
          {{ chip }}
        </button>
      }
    </div>
    <form class="chat-form" (ngSubmit)="send()">
      <label class="sr-only" for="chat-input">Bericht</label
      ><input
        id="chat-input"
        name="message"
        [(ngModel)]="message"
        placeholder="Bijv. teambuilding voor 30 personen"
        maxlength="2000"
        [disabled]="loginRequired()"
      /><button
        class="primary"
        type="submit"
        aria-label="Bericht versturen"
        [disabled]="busy() || loginRequired() || !message.trim()"
      >
        ↑
      </button>
    </form>
    @if (plan()) {
      <button type="button" class="primary wide" (click)="build.emit(plan()!)">
        Open voorstel in Event Builder →
      </button>
    }
    <button type="button" class="text-button" (click)="build.emit(null)">
      Zelf een evenement samenstellen →
    </button>
  </section>`,
})
export class Assistant {
  readonly auth = inject(AuthService);
  readonly store = inject(EventStore);
  readonly build = output<EventConfiguration | null>();
  readonly requestLogin = output<void>();
  readonly loginRequired = computed(() => this.store.live() && !this.auth.user());
  readonly messages = signal([
    {
      sender: 'ai',
      text: 'Hallo! Vertel me over jouw evenement: met hoeveel personen komen jullie, wat willen jullie doen en wat is het budget?',
    },
  ]);
  readonly busy = signal(false);
  readonly plan = signal<EventConfiguration | null>(null);
  message = '';
  async send(text = this.message): Promise<void> {
    if (this.loginRequired()) {
      this.requestLogin.emit();
      return;
    }
    if (!text.trim() || this.busy()) return;
    this.message = '';
    this.messages.update((items) => [...items, { sender: 'user', text }]);
    this.busy.set(true);
    try {
      if (this.store.live()) {
        const result = await this.store.api.request<{ reply: string; config?: EventConfiguration }>(
          'chat',
          { message: text, currentEventConfig: this.plan() },
        );
        this.messages.update((items) => [...items, { sender: 'ai', text: result.reply }]);
        if (result.config) this.plan.set(result.config);
      } else {
        const participants = Number(
          text.match(/(\d+)\s*(personen|mensen|collega|gasten|deelnemers)/i)?.[1] || 30,
        );
        const room = this.store
          .activeRooms()
          .filter(
            (item) => item.capacityVerified && item.maxCapacity && item.maxCapacity >= participants,
          )
          .sort((a, b) => (a.maxCapacity ?? 0) - (b.maxCapacity ?? 0))[0];
        let reply =
          'Vul je datum, groepsgrootte en budget in de Event Builder in. Daar zie je een indicatie; prijzen en beschikbaarheid moeten nog worden bevestigd.';
        if (/catering|eten|lunch/i.test(text))
          reply =
            'Er zijn lunch-, diner- en borrelarrangementen. De prijzen zijn op aanvraag. Je kunt ook dieetwensen vermelden in de Event Builder.';
        else if (/activiteit|gaming|vr/i.test(text))
          reply =
            'Denk aan een Esports Toernooi, Sim Racing Masters of Virtual Reality Arena. Je kunt activiteiten combineren met een vergadering of borrel.';
        else if (room) {
          reply = `Voor ${participants} personen kun je ${room.name} bekijken (${room.capacityDisplay}). Dit is een lokale suggestie op basis van de voorbeeldcatalogus; geen bevestigde reservering.`;
          this.plan.set({
            ...emptyConfiguration(),
            name: 'Mijn H20 evenement',
            participants,
            selectedRoomId: room.id,
            selectedRoomName: room.name,
          });
        } else
          reply =
            'Voor deze groepsgrootte kan ik geen zaal met bevestigde capaciteit aanbevelen. Neem contact op met H20.';
        this.messages.update((items) => [...items, { sender: 'ai', text: reply }]);
      }
    } catch (error) {
      this.messages.update((items) => [
        ...items,
        {
          sender: 'ai',
          text:
            error instanceof Error
              ? error.message
              : 'De assistent is tijdelijk niet bereikbaar. Je kunt de Event Builder gebruiken.',
        },
      ]);
    } finally {
      this.busy.set(false);
    }
  }
}
