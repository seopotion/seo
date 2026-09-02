import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@seopotion/web-ui';

export const InTable = () => (
  <div className="max-w-2xl overflow-hidden rounded-lg border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Page</TableHead>
          <TableHead className="text-right">Clicks</TableHead>
          <TableHead className="text-right">Impressions</TableHead>
          <TableHead className="text-right">CTR</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">/blog/best-crm-tools-for-small-agencies</TableCell>
          <TableCell className="text-right tabular-nums">318</TableCell>
          <TableCell className="text-right tabular-nums">9,420</TableCell>
          <TableCell className="text-right tabular-nums">3.4%</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">/blog/static-site-hosting-compared</TableCell>
          <TableCell className="text-right tabular-nums">142</TableCell>
          <TableCell className="text-right tabular-nums">6,105</TableCell>
          <TableCell className="text-right tabular-nums">2.3%</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
);
