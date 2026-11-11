import { Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';
@Component({
  selector: 'app-modal',
  template: `<dialog #dialog [attr.aria-label]="heading()" (cancel)="dismissed.emit()">
    <header class="modal-header">
      <div>
        <span class="eyebrow">H20 EVENT ASSISTANT</span>
        <h2>{{ heading() }}</h2>
      </div>
      <button type="button" class="icon-button" aria-label="Sluiten" (click)="dismissed.emit()">
        ✕
      </button>
    </header>
    <div class="modal-body"><ng-content /></div>
  </dialog>`,
  styles: `
    dialog {
      width: min(1000px, calc(100vw - 32px));
      max-height: 90dvh;
      padding: 0;
      border: 1px solid #0003;
      border-radius: 8px;
      background: #ffffff;
      color: #000000;
      box-shadow: 0 30px 100px #0008;
    }
    dialog::backdrop {
      background: #00000099;
      backdrop-filter: blur(5px);
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 22px 28px;
      border-bottom: 1px solid #0002;
    }
    .modal-header h2 {
      margin: 6px 0 0;
      font-size: clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem);
    }
    .modal-body {
      padding: 26px;
    }
    @media (max-width: 600px) {
      .modal-body,
      .modal-header {
        padding: 18px;
      }
    }
  `,
})
export class Modal {
  readonly heading = input.required<string>();
  readonly dismissed = output<void>();
  readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }
}
