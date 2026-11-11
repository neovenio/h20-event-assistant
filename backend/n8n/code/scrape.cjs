// Input is HTML-node extraction, never executable page content.
function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeSource(source, extracted) {
  const content = clean(extracted.content);
  if (content.length < 50)
    throw new Error(`Geen bruikbare inhoud voor ${source.url}; controleer de HTML-selectors.`);
  const title =
    clean(extracted.heading) || clean(extracted.title).replace(/\s*[-–|]\s*H20.*$/i, '');
  let imageUrl = '';
  try {
    const candidate = new URL(extracted.image, source.url);
    if (
      candidate.protocol === 'https:' &&
      (candidate.hostname === 'h20.gg' || candidate.hostname.endsWith('.h20.gg'))
    )
      imageUrl = candidate.href;
  } catch {
    /* An absent or external image needs review. */
  }
  const capacity = content.match(
    /(?:van\s+)?(\d{1,4})\s*(?:tot|–|-)\s*(\d[\d.]*)\s*(?:personen|gasten)/i,
  );
  const maximum = capacity ? Number(capacity[2].replaceAll('.', '')) : undefined;
  const description = content.slice(0, 6000);
  const common = {
    id: source.id,
    name: title || source.label,
    description,
    isActive: false,
    sourceUrl: source.url,
    sourceRetrievedAt: new Date().toISOString(),
  };
  let suggestedItem;
  if (source.kind === 'room')
    suggestedItem = {
      ...common,
      dutchName: common.name,
      category: 'Meeting & Conference',
      capacityDisplay: capacity
        ? `${capacity[1]} – ${maximum} personen (bron controleren)`
        : 'Capaciteit op aanvraag',
      minCapacity: capacity ? Number(capacity[1]) : 1,
      ...(maximum ? { maxCapacity: maximum } : {}),
      capacityVerified: false,
      facilities: [],
      suitableFor: [],
      imageUrl,
      unconfirmedNote:
        'Controleer de bron, capaciteit en faciliteiten voordat je deze zaal publiceert.',
    };
  else if (source.kind === 'catering')
    suggestedItem = {
      ...common,
      category: 'Dinner catering',
      categoryDutch: 'Catering op maat',
      pricePerPerson: null,
      priceDisplay: 'Prijs op aanvraag',
      status: 'Subject to Confirmation',
      isOfficialH20: true,
    };
  else if (source.kind === 'activity')
    suggestedItem = {
      ...common,
      tag: 'H20 activiteiten',
      price: null,
      priceDisplay: 'Prijs op aanvraag',
    };
  return {
    recordId: `source:${source.id}`,
    kind: 'source',
    payload: JSON.stringify({
      data: {
        id: source.id,
        url: source.url,
        title,
        content,
        imageUrl,
        retrievedAt: new Date().toISOString(),
        catalogueKind: source.kind,
        suggestedItem,
      },
    }),
  };
}
if (typeof module !== 'undefined') module.exports = { normalizeSource };
