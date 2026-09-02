import { Input, Label } from '@seopotion/web-ui';

export const Default = () => (
  <Input className="max-w-sm" placeholder="https://www.acme.com" />
);

export const Types = () => (
  <div className="grid max-w-sm gap-3">
    <Input type="text" placeholder="Organization name" />
    <Input type="email" placeholder="you@acme.com" />
    <Input type="url" placeholder="https://blog.acme.com" />
    <Input type="password" defaultValue="wp-app-password-2026" />
    <Input type="number" placeholder="Articles per week" min={1} max={7} defaultValue={3} />
    <Input type="file" accept=".csv" />
  </div>
);

export const States = () => (
  <div className="grid max-w-sm gap-3">
    <Input placeholder="Add a target keyword" />
    <Input defaultValue="best crm for small agencies" />
    <Input defaultValue="sc-domain:acme.com" readOnly />
    <Input defaultValue="acme.com" disabled />
    <Input defaultValue="not a valid url" aria-invalid="true" />
  </div>
);

export const WithLabel = () => (
  <div className="grid max-w-sm gap-2">
    <Label htmlFor="site">Site URL</Label>
    <Input id="site" type="url" placeholder="https://www.acme.com" />
    <p className="text-muted-foreground text-sm">We scan this site to build your keyword plan.</p>
  </div>
);

export const WithError = () => (
  <div className="grid max-w-sm gap-2">
    <Label htmlFor="wp-url">WordPress URL</Label>
    <Input id="wp-url" type="url" defaultValue="blog.acme" aria-invalid="true" />
    <p className="text-destructive text-sm">Enter a full URL including https://</p>
  </div>
);
