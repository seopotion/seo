import { Label, Switch } from '@seopotion/web-ui';

export const Default = () => <Switch aria-label="Auto-publish new articles" />;

export const Checked = () => <Switch defaultChecked aria-label="Auto-publish new articles" />;

export const Disabled = () => (
  <div className="flex items-center gap-4">
    <Switch disabled aria-label="Disabled, off" />
    <Switch disabled defaultChecked aria-label="Disabled, on" />
  </div>
);

export const WithLabel = () => (
  <div className="flex items-center gap-3">
    <Switch id="auto" defaultChecked />
    <Label htmlFor="auto">Auto-publish new articles</Label>
  </div>
);

export const SettingsRow = () => (
  <div className="grid max-w-md gap-4">
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-1">
        <Label htmlFor="publish-drafts">Publish as drafts</Label>
        <p className="text-muted-foreground text-sm">
          Generated articles land in WordPress as drafts for review instead of going live.
        </p>
      </div>
      <Switch id="publish-drafts" defaultChecked />
    </div>
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-1">
        <Label htmlFor="gsc-sync">Sync Google Search Console</Label>
        <p className="text-muted-foreground text-sm">
          Pull clicks and impressions daily to re-rank the content plan.
        </p>
      </div>
      <Switch id="gsc-sync" />
    </div>
  </div>
);
