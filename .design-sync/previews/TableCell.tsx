import {
  Badge,
  Button,
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
          <TableHead>Integration</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">WordPress</TableCell>
          <TableCell className="text-muted-foreground">blog.acme.com (drafts)</TableCell>
          <TableCell>
            <Badge variant="success">Connected</Badge>
          </TableCell>
          <TableCell className="text-right">
            <Button size="sm" variant="outline">
              Manage
            </Button>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Static site</TableCell>
          <TableCell className="text-muted-foreground">Not configured</TableCell>
          <TableCell>
            <Badge variant="neutral">Not connected</Badge>
          </TableCell>
          <TableCell className="text-right">
            <Button size="sm">Connect</Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
);
