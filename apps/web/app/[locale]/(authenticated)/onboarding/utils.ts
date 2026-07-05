export function createEntryId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isValidHttpUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) return false;

  try {
    const url = new URL(trimmedValue);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function hostFromUrl(value: string) {
  try {
    return new URL(value.trim()).hostname.replace(/^www\./, '');
  } catch {
    return 'your website';
  }
}

export function buildMockBusinessDescription(websiteUrl: string) {
  const host = hostFromUrl(websiteUrl);

  return `Based on the scan of ${host}, this business appears to help customers improve search visibility and content growth with practical, service-focused SEO support. The brand voice should be clear, useful, and confident for readers comparing solutions.`;
}
