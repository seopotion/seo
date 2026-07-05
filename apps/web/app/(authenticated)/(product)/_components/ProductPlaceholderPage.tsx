import { Card, CardContent } from '../../../../components/ui';

export function ProductPlaceholderPage() {
  return (
    <div>
      <Card className="max-w-3xl border-slate-200 shadow-none">
        <CardContent>
          <p className="font-medium text-slate-900 text-sm">Coming soon</p>
          <p className="mt-2 text-slate-600 text-sm">
            This workspace area is ready for the product flow, data fetching, and actions that
            belong here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
