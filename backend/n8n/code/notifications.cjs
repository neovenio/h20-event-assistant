function notificationJobs(rows, frontendUrl) {
  const origin = new URL(frontendUrl);
  if (origin.protocol !== 'https:') throw new Error('Use the deployed HTTPS frontend URL.');
  const parsed = rows
    .filter((row) => typeof row.payload === 'string')
    .map((row) => ({ ...row, value: JSON.parse(row.payload) }));
  const sent = new Set(
    parsed.filter((row) => row.kind === 'notification').map((row) => row.recordId),
  );
  const jobs = [];
  for (const row of parsed.filter(
    (row) =>
      row.kind === 'booking' && !row.value.deleted && row.value.data.claimStatus !== 'claiming',
  )) {
    const b = row.value.data;
    const events = ['received', ...(b.requestStatus === 'approved' ? ['approved'] : [])];
    for (const event of events) {
      const recordId = `notification:${b.id}:${event}`;
      if (sent.has(recordId)) continue;
      const link = `${origin.origin}/#request=${encodeURIComponent(b.id)}&token=${encodeURIComponent(row.value.customerToken)}`;
      jobs.push({
        recordId,
        kind: 'notification',
        payload: JSON.stringify({
          data: { bookingId: b.id, event, sentAt: new Date().toISOString() },
        }),
        to: b.customer.email,
        subject: `H20 ${b.reference} — ${event === 'approved' ? 'voorstel beoordeeld' : 'aanvraag ontvangen'}`,
        text: `Beste ${b.customer.fullName},\n\n${event === 'approved' ? 'Een medewerker heeft je conceptvoorstel beoordeeld. Bekijk het voorstel via je persoonlijke link.' : 'Je evenementaanvraag is ontvangen. Het team beoordeelt je wensen en de voorlopige planning.'}\n\n${link}\n\nDit is nog geen definitieve reservering of betaalverzoek. Bewaar deze persoonlijke link en deel hem alleen met mensen die jouw aanvraag mogen bekijken.\n\nH20 Event Assistant`,
      });
    }
  }
  return jobs;
}
if (typeof module !== 'undefined') module.exports = { notificationJobs };
