import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@seopotion/web-ui';

export const InTable = () => (
  <div className="overflow-hidden rounded-lg border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Day</TableHead>
          <TableHead>Planned article</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="text-muted-foreground tabular-nums">Day 1</TableCell>
          <TableCell className="font-medium">What is keyword difficulty and how is it scored?</TableCell>
          <TableCell>
            <Badge variant="success">Published</Badge>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="text-muted-foreground tabular-nums">Day 2</TableCell>
          <TableCell className="font-medium">Long-tail keywords for a new SaaS blog</TableCell>
          <TableCell>
            <Badge variant="progress">Generating</Badge>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="text-muted-foreground tabular-nums">Day 3</TableCell>
          <TableCell className="font-medium">Internal linking on a static site</TableCell>
          <TableCell>
            <Badge variant="neutral">Scheduled</Badge>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="text-muted-foreground tabular-nums">Day 4</TableCell>
          <TableCell className="font-medium">Reading Search Console impressions week over week</TableCell>
          <TableCell>
            <Badge variant="neutral">Scheduled</Badge>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
);
