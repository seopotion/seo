import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@seopotion/web-ui';

export const InSelect = () => (
  <div className="grid min-h-80 max-w-80 content-start gap-1.5">
    <p className="font-medium text-sm">Publish to</p>
    <Select defaultOpen defaultValue="wp-blog">
      <SelectTrigger>
        <SelectValue placeholder="Choose a destination" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>WordPress</SelectLabel>
          <SelectItem value="wp-blog">blog.acme.com</SelectItem>
          <SelectItem value="wp-help">help.acme.com</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Static site</SelectLabel>
          <SelectItem value="static-docs">docs.acme.com</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);
