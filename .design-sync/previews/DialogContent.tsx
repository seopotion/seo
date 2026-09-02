import { Button, Dialog, DialogContent, DialogTitle, Input, Label } from '@seopotion/web-ui';

export const InDialog = () => (
  <Dialog defaultOpen>
    <DialogContent className="sm:h-auto sm:max-w-lg">
      <div className="border-b px-6 py-4">
        <DialogTitle>Connect WordPress</DialogTitle>
      </div>
      <div className="flex flex-col gap-4 px-6 py-5">
        <p className="text-muted-foreground text-sm">
          Articles are published to your site as drafts so you can review them before they go
          live.
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="dlg-site-url">Site URL</Label>
          <Input id="dlg-site-url" defaultValue="https://blog.acme.com" />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t px-6 py-4">
        <Button variant="outline">Cancel</Button>
        <Button>Continue</Button>
      </div>
    </DialogContent>
  </Dialog>
);
