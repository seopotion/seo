import { Separator } from '@seopotion/web-ui';

export const Horizontal = () => (
  <div className="max-w-md">
    <div className="space-y-1">
      <h4 className="font-medium text-sm leading-none">Content plan</h4>
      <p className="text-muted-foreground text-sm">30 articles scheduled over the next 30 days.</p>
    </div>
    <Separator className="my-4" />
    <div className="space-y-1">
      <h4 className="font-medium text-sm leading-none">Published articles</h4>
      <p className="text-muted-foreground text-sm">24 live on blog.acme.com, 2 waiting for review.</p>
    </div>
  </div>
);

export const Vertical = () => (
  <div className="flex h-5 items-center gap-4 text-sm">
    <a href="#planner" className="hover:underline">
      Planner
    </a>
    <Separator orientation="vertical" />
    <a href="#articles" className="hover:underline">
      Articles
    </a>
    <Separator orientation="vertical" />
    <a href="#keywords" className="hover:underline">
      Keywords
    </a>
    <Separator orientation="vertical" />
    <a href="#settings" className="hover:underline">
      Settings
    </a>
  </div>
);

export const Semantic = () => (
  <div className="max-w-md space-y-4 text-sm">
    <p>
      Articles are generated from your keyword plan and published to WordPress once a day.
    </p>
    <Separator decorative={false} aria-label="End of publishing section" />
    <p className="text-muted-foreground">
      Search Console data appears here about 48 hours after an article goes live.
    </p>
  </div>
);
