# ADR 0005: In-app intake and venue-tour appointments with verified availability

Status: accepted (issue #17)

## Context

Issue #17 asks how customers should schedule an intake call (_online intakegesprek_) or venue tour (_rondleiding op locatie_) with H20 staff on verified available time slots. Integrating an external staff calendar (Google Calendar or Microsoft 365/Outlook) requires production OAuth credentials, per-staff calendar sharing rules, and webhook sync that are not provisioned in the self-contained n8n Data Table + static Angular architecture, and would fail completely in local demo mode. Conversely, an unverified free-text callback form allows double bookings and forces manual back-and-forth to find an open slot.

## Decision

1. **In-app verified weekday slots, zero external calendar credentials**:
   - Standard intake/tour windows on future weekdays (Monday–Friday) are `10:00–11:00`, `11:30–12:30`, `14:00–15:00`, and `15:30–16:30`.
   - Past dates (`< today()` in `Europe/Amsterdam`) and weekend dates (`0` or `6` UTC day of `YYYY-MM-DD`) expose all four windows as `available: false`.
   - A window is unavailable when an active `appointment` (`status !== 'cancelled' && status !== 'rejected'`) overlaps it, or when a venue-wide `Closure` block (`kind === 'block'` with `type === 'Closure'`) overlaps it. Single-room `Maintenance` or `Admin Block` blocks do not block general intake calls or tours.
2. **Public slot inspection without PII leakage**:
   - `publicAction` (`action: 'appointment-slots'`) is allowed without authentication so visitors can inspect open slots before signing in. It returns only `{ date, slots: { startTime, endTime, available }[] }` and never exposes customer names, emails, notes, or references.
3. **Authenticated, idempotent, race-safe booking**:
   - `book-appointment` requires a verified Firebase identity (`_identity.uid`), validates all fields on the server, scopes idempotent retries by `requestId` to `ownerUid`, and reuses ADR 0001's reserve-first `resolveClaim` / `settleClaim` protocol (`claimKind: 'appointment'`, virtual resource `'__intake__'`) so two simultaneous intake bookings for the same slot resolve deterministically without double-holding.
   - Appointments start as `status: 'pending'` with reference `AF-<8-HEX>` and appear alongside event requests in `my-requests` (`Mijn voorstellen`).
4. **Staff confirmation & conflict re-check**:
   - Staff review appointments in the employee portal under `Beschikbaarheid & Afspraken` (`/admin/availability`), confirming (`status: 'confirmed'`) or cancelling (`status: 'cancelled'`) via `appointment-status`. Confirmation re-checks for overlapping active appointments and `Closure` blocks and appends an audit entry.
   - Both local demo mode (`localStorage`) and connected n8n mode execute identical slot rules.
5. **Zero initial-bundle impact**:
   - `<app-appointment-modal>` is wrapped inside `@defer` inside `@if (appointmentOpen)` in `app.html`, keeping the modal out of the initial bundle until opened.

## Rejected alternatives

- **Direct Google Calendar / Microsoft Graph OAuth integration**: Adds external OAuth client secrets, token refresh failure modes, and staff calendar permission setup without working in offline/local demo mode. Can be added later as an optional outbound sync from workflow C/D when H20 connects a shared intake mailbox.
- **Unverified free-text preferred-time field**: Does not prevent double-booking and fails the "verified availability" requirement of #17.

## Consequences

- Visitors and signed-in customers get immediate, conflict-checked weekday slots in both demo and live n8n deployments.
- Staff control intake availability using existing `Closure` blocks and appointment confirmation/cancellation actions in `/admin/availability`, with full audit logging.
