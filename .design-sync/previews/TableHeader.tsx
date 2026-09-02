import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@seopotion/web-ui';

export const InTable = () => (
  <div className="overflow-hidden rounded-lg border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Site</TableHead>
          <TableHead>Platform</TableHead>
          <TableHead>Last scan</TableHead>
          <TableHead className="text-right">Pages</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">blog.acme.com</TableCell>
          <TableCell>WordPress</TableCell>
          <TableCell className="text-muted-foreground">Today, 07:00 UTC</TableCell>
          <TableCell className="text-right tabular-nums">128</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">docs.acme.com</TableCell>
          <TableCell>Static site</TableCell>
          <TableCell className="text-muted-foreground">Yesterday, 07:00 UTC</TableCell>
          <TableCell className="text-right tabular-nums">46</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
);
