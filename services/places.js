const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.googleMapsUri',
  'nextPageToken',
].join(',');

export async function searchPlaces({ query, maxResultCount = 20, pageToken }) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GOOGLE_PLACES_API_KEY ist nicht gesetzt. Trage ihn in der .env-Datei ein (siehe .env.example).'
    );
  }

  // Bei Pagination muessen laut Google-Doku alle Parameter des Original-
  // Requests (ausser pageToken/pageSize) identisch mitgeschickt werden.
  const body = {
    textQuery: query,
    languageCode: 'de',
    maxResultCount,
    ...(pageToken ? { pageToken } : {}),
  };

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Places API Fehler ${res.status}: ${text || res.statusText}`);
  }

  const data = await res.json();
  const places = (data.places || []).map((p) => ({
    id: p.id,
    name: p.displayName?.text || '(ohne Namen)',
    address: p.formattedAddress || '',
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
    website: p.websiteUri || '',
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
    mapsUrl: p.googleMapsUri || '',
    businessStatus: p.businessStatus || '',
  }));

  return { places, nextPageToken: data.nextPageToken || null };
}
