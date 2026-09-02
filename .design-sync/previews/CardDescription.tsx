import { Button, Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@seopotion/web-ui';

export const InCard = () => (
  <Card className="max-w-md">
    <CardHeader>
      <CardTitle>Keyword research</CardTitle>
      <CardDescription>
        318 keywords grouped into 27 topics, ranked by search volume and how hard they are to
        rank for. Difficulty is unknown for 12 of them.
      </CardDescription>
    </CardHeader>
    <CardFooter>
      <Button size="sm" variant="outline">
        Review keywords
      </Button>
    </CardFooter>
  </Card>
);
