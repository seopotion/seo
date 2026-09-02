import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@seopotion/web-ui';

export const InCard = () => (
  <Card className="max-w-md">
    <CardHeader>
      <CardTitle>Publish to WordPress</CardTitle>
      <CardDescription>
        “How to choose a CRM for a two-person agency” is ready to go live on blog.acme.com.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm">1,840 words · 4 internal links · cover image generated</p>
    </CardContent>
    <CardFooter className="justify-between gap-4">
      <div className="flex gap-2">
        <Button size="sm">Publish</Button>
        <Button size="sm" variant="outline">
          Save as draft
        </Button>
      </div>
      <span className="text-muted-foreground text-xs">Publishes as a draft for review</span>
    </CardFooter>
  </Card>
);
