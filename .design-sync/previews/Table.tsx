import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@seopotion/web-ui';

export const Articles = () => (
  <div className="overflow-hidden rounded-lg border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Keyword</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="whitespace-nowrap text-right">Published</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Best CRM tools for small agencies</TableCell>
          <TableCell className="text-muted-foreground">crm for small agencies</TableCell>
          <TableCell>
            <Badge variant="success">Published</Badge>
          </TableCell>
          <TableCell className="whitespace-nowrap text-right tabular-nums">2 Sep 2026</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">How to migrate a blog from Medium to WordPress</TableCell>
          <TableCell className="text-muted-foreground">medium to wordpress migration</TableCell>
          <TableCell>
            <Badge variant="progress">Generating</Badge>
          </TableCell>
          <TableCell className="text-right text-muted-foreground tabular-nums">—</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Static site hosting compared: Netlify vs Cloudflare Pages</TableCell>
          <TableCell className="text-muted-foreground">static site hosting</TableCell>
          <TableCell>
            <Badge variant="error">Publish failed</Badge>
          </TableCell>
          <TableCell className="text-right text-muted-foreground tabular-nums">—</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Google Search Console: reading clicks vs impressions</TableCell>
          <TableCell className="text-muted-foreground">search console impressions</TableCell>
          <TableCell>
            <Badge variant="neutral">Scheduled</Badge>
          </TableCell>
          <TableCell className="whitespace-nowrap text-right tabular-nums">4 Sep 2026</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">A 30-day content plan for a SaaS launch</TableCell>
          <TableCell className="text-muted-foreground">saas content plan</TableCell>
          <TableCell>
            <Badge variant="success">Published</Badge>
          </TableCell>
          <TableCell className="whitespace-nowrap text-right tabular-nums">28 Aug 2026</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
);

export const Keywords = () => (
  <div className="max-w-2xl overflow-hidden rounded-lg border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Keyword</TableHead>
          <TableHead className="text-right">Volume</TableHead>
          <TableHead className="text-right">Difficulty</TableHead>
          <TableHead className="text-right">Clicks (28d)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="py-2">crm for small agencies</TableCell>
          <TableCell className="py-2 text-right tabular-nums">2,400</TableCell>
          <TableCell className="py-2 text-right tabular-nums">34</TableCell>
          <TableCell className="py-2 text-right tabular-nums">318</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="py-2">static site hosting</TableCell>
          <TableCell className="py-2 text-right tabular-nums">5,900</TableCell>
          <TableCell className="py-2 text-right tabular-nums">51</TableCell>
          <TableCell className="py-2 text-right tabular-nums">142</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="py-2">wordpress seo plugin</TableCell>
          <TableCell className="py-2 text-right tabular-nums">12,100</TableCell>
          <TableCell className="py-2 text-right tabular-nums">67</TableCell>
          <TableCell className="py-2 text-right tabular-nums">89</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="py-2">search console impressions</TableCell>
          <TableCell className="py-2 text-right tabular-nums">880</TableCell>
          <TableCell className="py-2 text-right text-muted-foreground tabular-nums">—</TableCell>
          <TableCell className="py-2 text-right tabular-nums">27</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
);

export const Empty = () => (
  <div className="overflow-hidden rounded-lg border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Keyword</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="whitespace-nowrap text-right">Published</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
            No articles yet. The first one is generated once your content plan is ready.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
);
