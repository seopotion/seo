import { Button } from '../../../components/ui';
import { textEntryInputClass } from '../constants';
import type { TextEntry } from '../types';
import { ErrorMessage } from './ErrorMessage';

export function TextEntryList({
  ariaInvalid,
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
  return (
    <div>
      <label className="block font-medium text-gray-900 text-sm" htmlFor={inputId}>
        {label}
      </label>
      <div className="mt-2 flex gap-2">
        <input
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
          className={textEntryInputClass}
          aria-invalid={ariaInvalid}
        />
        <Button variant="outline" onClick={onAdd}>
          Add
        </Button>
      </div>
      {errors?.map((error) => (
        <ErrorMessage key={error}>{error}</ErrorMessage>
      ))}

      <div className="mt-3 flex flex-wrap gap-2">
        {entries.map((entry) => (
          <span
            key={entry.id}
            className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-gray-700 text-sm"
          >
            {entry.value}
            <button
              type="button"
              onClick={() => onRemove(entry.id)}
              className="font-bold text-gray-500 hover:text-gray-900"
              aria-label={`Remove ${entry.value}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
