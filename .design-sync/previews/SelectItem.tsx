import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seopotion/web-ui';

export const InSelect = () => (
  <div className="grid min-h-72 max-w-80 content-start gap-1.5">
    <p className="font-medium text-sm">Article length</p>
    <Select defaultOpen defaultValue="medium">
      <SelectTrigger>
        <SelectValue placeholder="Choose a length" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="short">Short (600–900 words)</SelectItem>
        <SelectItem value="medium">Medium (1,200–1,600 words)</SelectItem>
        <SelectItem value="long">Long (2,000+ words)</SelectItem>
        <SelectItem value="pillar" disabled>
          Pillar page (expert plan)
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
);
