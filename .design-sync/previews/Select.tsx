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

export const Placeholder = () => (
  <div className="grid max-w-80 gap-1.5">
    <p className="font-medium text-sm">Publishing cadence</p>
    <Select>
      <SelectTrigger>
        <SelectValue placeholder="Choose a cadence" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="daily">Daily</SelectItem>
        <SelectItem value="twice-a-week">Twice a week</SelectItem>
        <SelectItem value="weekly">Weekly</SelectItem>
        <SelectItem value="monthly">Monthly</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const WithDefaultValue = () => (
  <div className="grid max-w-80 gap-1.5">
    <p className="font-medium text-sm">Article length</p>
    <Select defaultValue="medium">
      <SelectTrigger>
        <SelectValue placeholder="Choose a length" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="short">Short (600–900 words)</SelectItem>
        <SelectItem value="medium">Medium (1,200–1,600 words)</SelectItem>
        <SelectItem value="long">Long (2,000+ words)</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const Open = () => (
  <div className="grid min-h-72 max-w-80 content-start gap-1.5">
    <p className="font-medium text-sm">Publishing cadence</p>
    <Select defaultOpen defaultValue="weekly">
      <SelectTrigger>
        <SelectValue placeholder="Choose a cadence" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="daily">Daily</SelectItem>
        <SelectItem value="twice-a-week">Twice a week</SelectItem>
        <SelectItem value="weekly">Weekly</SelectItem>
        <SelectItem value="monthly">Monthly</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const WithGroups = () => (
  <div className="grid min-h-80 max-w-80 content-start gap-1.5">
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
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>North America</SelectLabel>
          <SelectItem value="us">United States</SelectItem>
          <SelectItem value="ca">Canada</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

export const Disabled = () => (
  <div className="grid max-w-80 gap-1.5">
    <p className="font-medium text-sm">Integration</p>
    <Select disabled defaultValue="wordpress">
      <SelectTrigger>
        <SelectValue placeholder="Choose an integration" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="wordpress">WordPress</SelectItem>
        <SelectItem value="static">Static site</SelectItem>
      </SelectContent>
    </Select>
    <p className="text-muted-foreground text-xs">Disconnect WordPress to change the integration.</p>
  </div>
);
