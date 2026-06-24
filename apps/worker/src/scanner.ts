/**
 * Website scanner. Stub for now — scrapes the site and makes AI calls to
 * generate the editable onboarding presets (business details, audience,
 * blog, article preferences). See design/product-flow.md §1.1.
 */
export interface ScanPresets {
  business_name?: string;
  language?: string;
  country?: string;
  description?: string;
}

export async function scanWebsite(websiteUrl: string): Promise<ScanPresets> {
  // TODO: scrape `websiteUrl` + AI calls. Returning an empty preset set for now.
  void websiteUrl;
  return {};
}
