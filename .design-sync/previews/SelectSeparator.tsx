import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@seopotion/web-ui';

export const InSelect = () => (
  <div className="grid min-h-80 max-w-80 content-start gap-1.5">
    <p className="font-medium text-sm">Organization</p>
    <Select defaultOpen defaultValue="acme">
      <SelectTrigger>
        <SelectValue placeholder="Choose an organization" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Your organizations</SelectLabel>
          <SelectItem value="acme">Acme Software</SelectItem>
          <SelectItem value="piperbox">Piperbox</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value="new">Create a new organization…</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
