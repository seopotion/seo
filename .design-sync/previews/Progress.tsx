import { Progress } from '@seopotion/web-ui';

export const Default = () => (
  <div className="grid max-w-md gap-2">
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium">Generating article</span>
      <span className="text-muted-foreground">60%</span>
    </div>
    <Progress value={60} />
  </div>
);

export const Values = () => (
  <div className="grid max-w-md gap-5">
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <span>Site scan</span>
        <span className="text-muted-foreground">0%</span>
      </div>
      <Progress value={0} />
    </div>
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <span>Keyword research</span>
        <span className="text-muted-foreground">25%</span>
      </div>
      <Progress value={25} />
    </div>
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <span>Content plan</span>
        <span className="text-muted-foreground">60%</span>
      </div>
      <Progress value={60} />
    </div>
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <span>Published articles</span>
        <span className="text-muted-foreground">100%</span>
      </div>
      <Progress value={100} />
    </div>
  </div>
);

export const PlanUsage = () => (
  <div className="grid max-w-md gap-2 rounded-lg border p-4">
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium">Articles this month</span>
      <span className="text-muted-foreground">18 of 30</span>
    </div>
    <Progress value={60} />
    <p className="text-muted-foreground text-xs">Resets on 1 Oct.</p>
  </div>
);

export const Thin = () => (
  <div className="grid max-w-md gap-2">
    <p className="text-muted-foreground text-xs">Day 11 of 30 in your content plan</p>
    <Progress value={37} className="h-1" />
  </div>
);
