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
          <TableHead>Organization</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead>Setup</TableHead>
          <TableHead className="text-right">Articles</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Acme Agency</TableCell>
          <TableCell>Expert</TableCell>
          <TableCell>
            <Badge variant="success">Scan completed</Badge>
          </TableCell>
          <TableCell className="text-right tabular-nums">24</TableCell>
        </TableRow>
        <TableRow className="bg-muted/50">
          <TableCell className="font-medium">Piperbox</TableCell>
          <TableCell>Paid</TableCell>
          <TableCell>
            <Badge variant="progress">Scan in progress</Badge>
          </TableCell>
          <TableCell className="text-right tabular-nums">0</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Unmarble</TableCell>
          <TableCell>Free</TableCell>
          <TableCell>
            <Badge variant="success">Scan completed</Badge>
          </TableCell>
          <TableCell className="text-right tabular-nums">3</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
);
