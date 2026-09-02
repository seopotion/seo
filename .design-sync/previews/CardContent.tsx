import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seopotion/web-ui';

export const InCard = () => (
  <Card className="max-w-md">
    <CardHeader>
      <CardTitle>Site settings</CardTitle>
      <CardDescription>How generated articles are written and where they go.</CardDescription>
    </CardHeader>
    <CardContent>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Domain</dt>
        <dd>acme.com</dd>
        <dt className="text-muted-foreground">Language</dt>
        <dd>English (US)</dd>
        <dt className="text-muted-foreground">Publish target</dt>
        <dd>WordPress — blog.acme.com</dd>
        <dt className="text-muted-foreground">Schedule</dt>
        <dd>1 article per day, 07:00 UTC</dd>
        <dt className="text-muted-foreground">Article images</dt>
        <dd>Generated, no text overlays</dd>
      </dl>
    </CardContent>
  </Card>
);
