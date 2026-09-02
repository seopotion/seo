import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Input, Label } from '@/components/ui';
import type { TextEntry } from '../types';
import { ErrorMessage } from './ErrorMessage';

export function TextEntryList({
  ariaInvalid,
  description,
  draft,
  errors,
  entries,
  inputId,
  inputType = 'text',
  label,
  onAdd,
  onDraftChange,
  onRemove,
  placeholder,
}: {
  ariaInvalid?: boolean;
  /** Why this field matters — rendered under the label, before the input. */
  description?: string;
  draft: string;
  errors?: string[];
  entries: TextEntry[];
  inputId: string;
  inputType?: 'text' | 'url';
  label: string;
  onAdd: () => void;
  onDraftChange: (value: string) => void;
  onRemove: (id: string) => void;
  placeholder: string;
}) {
  const t = useTranslations('Onboarding.actions');

  return (
    <div>
      <Label htmlFor={inputId}>{label}</Label>
      {description && <p className="mt-1 text-muted-foreground text-sm">{description}</p>}
      <div className="mt-2 flex gap-2">
        <Input
          id={inputId}
          type={inputType}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onAdd();
            }
          }}
          placeholder={placeholder}
          aria-invalid={ariaInvalid}
        />
        <Button variant="outline" onClick={onAdd}>
          {t('add')}
        </Button>
      </div>
      {errors?.map((error) => (
        <ErrorMessage key={error}>{error}</ErrorMessage>
      ))}

      <div className="mt-3 flex flex-wrap gap-2">
        {entries.map((entry) => (
          <Badge key={entry.id} variant="secondary" className="max-w-full gap-1.5 py-1 pr-1 pl-3">
            <span className="truncate">{entry.value}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRemove(entry.id)}
              className="size-5 rounded-full text-muted-foreground hover:text-foreground"
              aria-label={t('remove', { value: entry.value })}
            >
              <XIcon className="size-3" />
            </Button>
          </Badge>
        ))}
      </div>
    </div>
  );
}
