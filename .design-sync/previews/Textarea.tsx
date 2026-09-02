import { Label, Textarea } from '@seopotion/web-ui';

export const Default = () => (
  <Textarea className="max-w-md" placeholder="Describe your business in a few sentences…" />
);

export const WithRows = () => (
  <Textarea
    className="max-w-md"
    rows={6}
    placeholder="Paste keywords to exclude, one per line"
  />
);

export const Filled = () => (
  <Textarea
    className="max-w-md"
    rows={5}
    defaultValue={
      'Article brief: compare the five most popular CRM tools for agencies with fewer than 20 staff. Lead with pricing tiers, cover HubSpot and Pipedrive in depth, and close with a short migration checklist. Tone: practical, no hype.'
    }
  />
);

export const Disabled = () => (
  <Textarea
    className="max-w-md"
    disabled
    defaultValue="Brand voice is locked while the 30-day plan is being generated."
  />
);

export const Invalid = () => (
  <div className="grid max-w-md gap-2">
    <Label htmlFor="brief">Article brief</Label>
    <Textarea id="brief" aria-invalid="true" defaultValue="Write about CRM" />
    <p className="text-destructive text-sm">A brief needs at least 50 characters.</p>
  </div>
);
