import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seopotion/web-ui';

export const InSelect = () => (
  <div className="grid min-h-72 max-w-80 content-start gap-1.5">
    <p className="font-medium text-sm">Content language</p>
    <Select defaultOpen>
      <SelectTrigger>
        <SelectValue placeholder="Choose a language" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">English</SelectItem>
        <SelectItem value="de">German</SelectItem>
        <SelectItem value="fr">French</SelectItem>
        <SelectItem value="tr">Turkish</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
