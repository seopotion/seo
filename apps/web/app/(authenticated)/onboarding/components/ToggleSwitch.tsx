import { Label, Switch } from '../../../../components/ui';

export function ToggleSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const switchId = `toggle-${label.toLowerCase().replaceAll(' ', '-')}`;

  return (
    <div className="flex w-full items-center justify-between rounded-md border bg-card px-3 py-2">
      <Label htmlFor={switchId}>{label}</Label>
      <Switch id={switchId} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
