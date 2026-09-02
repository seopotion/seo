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
  <div className="grid min-h-72 max-w-80 content-start gap-1.5">
    <p className="font-medium text-sm">Target market</p>
    <Select defaultOpen defaultValue="de">
      <SelectTrigger>
        <SelectValue placeholder="Choose a country" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Europe</SelectLabel>
          <SelectItem value="de">Germany</SelectItem>
          <SelectItem value="fr">France</SelectItem>
          <SelectItem value="nl">Netherlands</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);
