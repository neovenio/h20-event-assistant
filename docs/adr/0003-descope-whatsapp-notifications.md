# ADR 0003: Descope WhatsApp notifications in favour of email delivery

Status: accepted (issue #16)

## Context

The project requirements mentioned direct email/WhatsApp delivery for customer notifications (`Directe e-mail/WhatsApp-aflevering`).

- Email delivery for both request receipt (`received`) and staff proposal review (`approved`) is implemented by Workflow D (`backend/n8n/workflows/D-email-notifications.json`), which sends text-only notifications via SMTP with personal capability links and records delivery receipts (`notification:<bookingId>:<event>`) in the n8n Data Table.
- Sending automated outbound messages over WhatsApp Business requires Meta Business verification, a dedicated WhatsApp Business phone number, paid provider credentials (WhatsApp Cloud API, Twilio, or Bird), Meta-pre-approved message templates, and explicit GDPR/telecommunications opt-in tracking per customer. None of these external accounts or templates have been provisioned for this project.

## Decision

1. Automated WhatsApp notifications and two-way WhatsApp messaging are formally **descoped** for this release in favour of SMTP email delivery via Workflow D (issue #11).
2. Every booking already requires a valid customer email address (`customer.email`), ensuring 100% notification reach through Workflow D once SMTP is configured and activated.
3. Customers can still optionally supply a phone number (`customer.phone`) for manual follow-up by H20 staff when discussing custom event details.
4. `scripts/check-requirements.cjs` reports WhatsApp notifications as formally out of scope under this ADR (`BUITEN SCOPE (ADR): WhatsApp-notificaties (docs/adr/0003-descope-whatsapp-notifications.md)`) and scopes the manual delivery verification item specifically to email via Workflow D.

## Post-go-live phase

If H20 later wishes to add WhatsApp notifications alongside email:

- Complete Meta Business verification and provision a WhatsApp Business API provider credential inside n8n only.
- Add an explicit WhatsApp opt-in checkbox to the booking request form and store consent timestamp in the booking record.
- Extend Workflow D (or add a parallel notification branch) using pre-approved utility templates for receipt and approval links.

## Consequences

- Go-live is not blocked on Meta Business verification, template approval, or third-party messaging costs.
- Operational notification setup and testing focus on a single reliable channel: verified-sender SMTP email in Workflow D (#11).
