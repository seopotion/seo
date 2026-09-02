import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seopotion/web-ui';

export const InCard = () => (
  <Card className="max-w-md">
    <CardHeader>
      <CardTitle>Google Search Console</CardTitle>
      <CardDescription>
        Connect Search Console to track clicks and impressions for every published article.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground text-sm">
        Not connected. You will be asked to pick the property that matches acme.com.
      </p>
    </CardContent>
  </Card>
);
