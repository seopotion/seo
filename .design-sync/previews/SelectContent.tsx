import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seopotion/web-ui';

export const InSelect = () => (
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
