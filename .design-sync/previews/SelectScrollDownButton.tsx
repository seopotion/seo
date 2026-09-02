import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seopotion/web-ui';

// The scroll-down chevron renders while more items sit below the list's
// max height, so the 30-country list opens at the top.
export const InSelect = () => (
  <div className="grid min-h-96 max-w-80 content-start gap-1.5">
    <p className="font-medium text-sm">Target country</p>
    <Select defaultOpen defaultValue="au">
      <SelectTrigger>
        <SelectValue placeholder="Choose a country" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="au">Australia</SelectItem>
        <SelectItem value="at">Austria</SelectItem>
        <SelectItem value="be">Belgium</SelectItem>
        <SelectItem value="br">Brazil</SelectItem>
        <SelectItem value="ca">Canada</SelectItem>
        <SelectItem value="dk">Denmark</SelectItem>
        <SelectItem value="fi">Finland</SelectItem>
        <SelectItem value="fr">France</SelectItem>
        <SelectItem value="de">Germany</SelectItem>
        <SelectItem value="gr">Greece</SelectItem>
        <SelectItem value="in">India</SelectItem>
        <SelectItem value="ie">Ireland</SelectItem>
        <SelectItem value="it">Italy</SelectItem>
        <SelectItem value="jp">Japan</SelectItem>
        <SelectItem value="mx">Mexico</SelectItem>
        <SelectItem value="nl">Netherlands</SelectItem>
        <SelectItem value="nz">New Zealand</SelectItem>
        <SelectItem value="no">Norway</SelectItem>
        <SelectItem value="pl">Poland</SelectItem>
        <SelectItem value="pt">Portugal</SelectItem>
        <SelectItem value="sg">Singapore</SelectItem>
        <SelectItem value="za">South Africa</SelectItem>
        <SelectItem value="es">Spain</SelectItem>
        <SelectItem value="se">Sweden</SelectItem>
        <SelectItem value="ch">Switzerland</SelectItem>
        <SelectItem value="tr">Türkiye</SelectItem>
        <SelectItem value="ae">United Arab Emirates</SelectItem>
        <SelectItem value="gb">United Kingdom</SelectItem>
        <SelectItem value="us">United States</SelectItem>
        <SelectItem value="vn">Vietnam</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
