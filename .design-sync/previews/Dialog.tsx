import { Button, Dialog, DialogContent, DialogTitle, Input, Label } from '@seopotion/web-ui';

export const Editor = () => (
  <Dialog defaultOpen>
    <DialogContent>
      <div className="flex items-center justify-between border-b px-6 py-4">
        <DialogTitle>Edit article</DialogTitle>
        <span className="text-muted-foreground text-sm">Draft · scheduled for 4 Sep 2026</span>
      </div>
      <div className="flex flex-1 flex-col gap-5 overflow-auto px-6 py-5">
        <div className="grid gap-1.5">
          <Label htmlFor="dlg-title">Title</Label>
          <Input id="dlg-title" defaultValue="Google Search Console: reading clicks vs impressions" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="dlg-keyword">Target keyword</Label>
          <Input id="dlg-keyword" defaultValue="search console impressions" />
        </div>
        <div className="grid gap-1.5">
          <span className="font-medium text-sm">Body</span>
          <div className="rounded-md border p-4 text-sm leading-relaxed">
            <p className="mb-3">
              Impressions count how often a page appeared in search results; clicks count how often
              someone actually visited. A page with thousands of impressions and a handful of clicks
              is ranking, but its title and description are not earning the click.
            </p>
            <p className="text-muted-foreground">
              Start by sorting the Performance report by impressions and looking for pages whose
              CTR sits well below the average for their position…
            </p>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t px-6 py-4">
        <Button variant="outline">Cancel</Button>
        <Button>Save changes</Button>
      </div>
    </DialogContent>
  </Dialog>
);

export const Confirm = () => (
  <Dialog defaultOpen>
    <DialogContent className="sm:h-auto sm:max-w-md">
      <div className="flex flex-col gap-2 px-6 pt-6">
        <DialogTitle>Delete this article?</DialogTitle>
        <p className="text-muted-foreground text-sm">
          “Best CRM tools for small agencies” will be removed from your content plan. The published
          post on blog.acme.com is not affected.
        </p>
      </div>
      <div className="flex justify-end gap-2 px-6 pt-6 pb-6">
        <Button variant="outline">Keep article</Button>
        <Button variant="destructive">Delete</Button>
      </div>
    </DialogContent>
  </Dialog>
);
