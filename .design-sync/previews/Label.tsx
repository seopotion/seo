import { Input, Label, Switch } from '@seopotion/web-ui';

export const Default = () => <Label>Target keyword</Label>;

export const WithInput = () => (
  <div className="grid max-w-sm gap-2">
    <Label htmlFor="site">Site URL</Label>
    <Input id="site" type="url" placeholder="https://www.acme.com" />
  </div>
);

export const WithSwitch = () => (
  <div className="flex items-center gap-3">
    <Switch id="auto" defaultChecked />
    <Label htmlFor="auto">Auto-publish new articles</Label>
  </div>
);

export const PeerDisabled = () => (
  <div className="flex items-center gap-3">
    <Switch id="gsc" disabled />
    <Label htmlFor="gsc">Sync Google Search Console (connect an account first)</Label>
  </div>
);

export const WithHint = () => (
  <div className="grid max-w-sm gap-2">
    <Label htmlFor="org">
      Organization name
      <span className="font-normal text-muted-foreground">(optional)</span>
    </Label>
    <Input id="org" placeholder="Acme Marketing" />
  </div>
);
