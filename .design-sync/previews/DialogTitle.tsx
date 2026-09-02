import { Button, Dialog, DialogContent, DialogTitle } from '@seopotion/web-ui';

export const InDialog = () => (
  <Dialog defaultOpen>
    <DialogContent className="sm:h-auto sm:max-w-md">
      <div className="flex flex-col gap-2 px-6 pt-6">
        <DialogTitle>Rescan blog.acme.com?</DialogTitle>
        <p className="text-muted-foreground text-sm">
          A fresh scan re-reads your pages and refreshes the keyword research behind your content
          plan. It usually takes a couple of minutes.
        </p>
      </div>
      <div className="flex justify-end gap-2 px-6 pt-6 pb-6">
        <Button variant="outline">Not now</Button>
        <Button>Start scan</Button>
      </div>
    </DialogContent>
  </Dialog>
);
