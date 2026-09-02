import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@seopotion/web-ui';

export const InCard = () => (
  <Card className="max-w-md">
    <CardHeader>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>Site scan</CardTitle>
        <Badge variant="secondary">Completed</Badge>
      </div>
      <CardDescription>
        We crawled 142 pages on acme.com and extracted your existing topics and brand voice.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm">
        Scan finished 2 minutes ago. Keyword research runs next and takes about 10 minutes.
      </p>
    </CardContent>
  </Card>
);
