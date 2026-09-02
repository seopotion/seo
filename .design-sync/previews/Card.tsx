import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@seopotion/web-ui';

export const Default = () => (
  <Card className="max-w-md">
    <CardHeader>
      <CardTitle>Content plan</CardTitle>
      <CardDescription>30 days of articles planned from your keyword research.</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm">
        The next article, <strong>“Best CRM tools for small agencies”</strong>, is scheduled for
        tomorrow at 07:00 UTC.
      </p>
    </CardContent>
    <CardFooter className="gap-2">
      <Button size="sm">Generate now</Button>
      <Button size="sm" variant="outline">
        Edit plan
      </Button>
    </CardFooter>
  </Card>
);

export const Stats = () => (
  <div className="grid max-w-2xl grid-cols-3 gap-4">
    <Card>
      <CardHeader>
        <CardDescription>Published articles</CardDescription>
        <CardTitle className="text-2xl">24</CardTitle>
      </CardHeader>
    </Card>
    <Card>
      <CardHeader>
        <CardDescription>Keywords tracked</CardDescription>
        <CardTitle className="text-2xl">318</CardTitle>
      </CardHeader>
    </Card>
    <Card>
      <CardHeader>
        <CardDescription>Search clicks (28d)</CardDescription>
        <CardTitle className="text-2xl">1,942</CardTitle>
      </CardHeader>
    </Card>
  </div>
);

export const WithBadge = () => (
  <Card className="max-w-md">
    <CardHeader>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>WordPress</CardTitle>
        <Badge variant="success">Connected</Badge>
      </div>
      <CardDescription>Articles publish to blog.acme.com as drafts for review.</CardDescription>
    </CardHeader>
    <CardFooter>
      <Button size="sm" variant="outline">
        Manage connection
      </Button>
    </CardFooter>
  </Card>
);

export const ContentOnly = () => (
  <Card className="max-w-md">
    <CardContent className="text-muted-foreground text-sm">
      No integrations connected yet. Connect WordPress or a static site to start publishing.
    </CardContent>
  </Card>
);
