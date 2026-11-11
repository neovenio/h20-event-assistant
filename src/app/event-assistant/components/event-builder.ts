import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EventStore } from '../event-store';
import { EventConfiguration, Room } from '../models';
import { duration, emptyConfiguration, estimate, localDate } from '../event-utils';
import { Modal } from './modal';
@Component({
  selector: 'app-event-builder',
  imports: [FormsModule, CurrencyPipe, Modal],
  templateUrl: './event-builder.html',
})
export class EventBuilder implements OnInit {
  readonly store = inject(EventStore);
  readonly initial = input<EventConfiguration | null>(null);
  readonly proposalId = input<string | null>(null);
  readonly dismissed = output<void>();
  readonly book = output<EventConfiguration>();
  readonly saved = output<void>();
  readonly step = signal(1);
  readonly steps = [
    'Evenement',
    'Budget & omvang',
    'Zalen',
    'Activiteiten',
    'Catering',
    'Sfeer & wensen',
    'Jouw voorstel',
  ];
  readonly today = localDate();
  config = emptyConfiguration();
  error = '';
  readonly selectedStep = computed(() => this.steps[this.step() - 1]);
  ngOnInit(): void {
    if (this.initial()) this.config = JSON.parse(JSON.stringify(this.initial()));
    this.baseline = JSON.stringify(this.config);
  }
  private baseline = '';
  /** True when the config differs from what the builder was opened with. */
  dirty(): boolean {
    return JSON.stringify(this.config) !== this.baseline;
  }
  get price() {
    return estimate(
      this.config,
      this.store.rooms(),
      this.store.catering(),
      this.store.upgrades(),
      this.store.live() ? this.store.activities() : undefined,
    );
  }
  get recommendedRoom(): Room | undefined {
    const budget = Number(this.config.budgetRange) || Infinity;
    const hours = Math.max(1, duration(this.config.startTime, this.config.endTime));
    return this.store
      .activeRooms()
      .filter(
        (room) =>
          room.capacityVerified &&
          !!room.maxCapacity &&
          room.maxCapacity >= this.config.participants,
      )
      .sort(
        (a, b) =>
          Number((b.baseHourlyRate ?? Infinity) * hours * 1.21 <= budget) -
            Number((a.baseHourlyRate ?? Infinity) * hours * 1.21 <= budget) ||
          (a.maxCapacity ?? Infinity) - (b.maxCapacity ?? Infinity),
      )[0];
  }
  selectRoom(room: Room): void {
    this.config.selectedRoomId = room.id;
    this.config.selectedRoomName = room.name;
    this.config.additionalRooms = this.config.additionalRooms.filter((item) => item.id !== room.id);
  }
  toggle(list: string[], item: string): string[] {
    return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
  }
  extraSelected(id: string): boolean {
    return this.config.additionalRooms.some((room) => room.id === id);
  }
  toggleRoom(room: Room): void {
    this.config.additionalRooms = this.extraSelected(room.id)
      ? this.config.additionalRooms.filter((item) => item.id !== room.id)
      : [
          ...this.config.additionalRooms,
          { id: room.id, name: room.name, price: room.baseHourlyRate ?? 0 },
        ];
  }
  addonSelected(id: string): boolean {
    return this.config.selectedAddons.some((item) => item.id === id);
  }
  toggleAddon(id: string): void {
    const addon = this.store.upgrades().find((item) => item.id === id);
    if (addon)
      this.config.selectedAddons = this.addonSelected(id)
        ? this.config.selectedAddons.filter((item) => item.id !== id)
        : [...this.config.selectedAddons, { id, name: addon.name, price: addon.price ?? 0 }];
  }
  next(): void {
    this.error = '';
    if (
      this.step() === 1 &&
      (!this.config.name.trim() ||
        !this.config.date ||
        this.config.date < this.today ||
        !(duration(this.config.startTime, this.config.endTime) > 0))
    )
      this.error = 'Vul een naam, toekomstige datum en een eindtijd na de begintijd in.';
    if (
      this.step() === 2 &&
      (!Number.isInteger(this.config.participants) || this.config.participants < 1)
    )
      this.error = 'Vul een geldig aantal deelnemers in.';
    if (this.step() === 3) this.error = this.store.validate(this.config);
    if (!this.error) {
      this.config.durationHours = duration(this.config.startTime, this.config.endTime);
      this.step.update((step) => Math.min(7, step + 1));
    }
  }
  save(): void {
    this.store.saveProposal(this.config, this.proposalId() ?? undefined);
    this.saved.emit();
  }
  submit(): void {
    this.error = this.store.validate(this.config);
    if (!this.error) this.book.emit(this.config);
  }
}
