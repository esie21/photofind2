import { useEffect, useRef } from 'react';
import { Upload, Trash2 } from 'lucide-react';

// Mirrors the backend's per-file limit in uploadService (MAX_FILE_SIZE) and the
// imageFileFilter allow-list, so an oversized or non-image file is caught here rather
// than after a full upload round-trip.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface PickedEvidenceFile {
  file: File;
  preview: string;
}

/** Release every object URL in a picked set. Call before dropping the state. */
export function revokePickedFiles(files: PickedEvidenceFile[]) {
  files.forEach((f) => URL.revokeObjectURL(f.preview));
}

interface DisputeEvidencePickerProps {
  files: PickedEvidenceFile[];
  onChange: (files: PickedEvidenceFile[]) => void;
  /** Matches the backend's per-request cap of 5 on POST /:id/dispute-evidence. */
  maxFiles?: number;
  disabled?: boolean;
  onError?: (message: string) => void;
  label?: string;
  helpText?: string;
}

/**
 * Controlled photo picker for dispute evidence. Kept controlled rather than owning its
 * own upload so the two callers can differ on timing: the confirm-completion modal has
 * to raise the dispute before an upload target exists, while the dispute banners can
 * upload immediately.
 */
export function DisputeEvidencePicker({
  files,
  onChange,
  maxFiles = 5,
  disabled = false,
  onError,
  label = 'Attach photos',
  helpText,
}: DisputeEvidencePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Previews are object URLs, and the picker can go away with files still selected -
  // the modal is dismissed, or the panel collapses - so release whatever is left on
  // unmount. Re-revoking an already-released URL is a no-op, so this is safe alongside
  // the callers' own cleanup after a successful submit.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => revokePickedFiles(filesRef.current), []);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;

    const accepted: PickedEvidenceFile[] = [];
    let rejection: string | null = null;

    for (let i = 0; i < selected.length; i++) {
      const file = selected[i];
      if (files.length + accepted.length >= maxFiles) {
        rejection = `You can attach up to ${maxFiles} photos at a time`;
        break;
      }
      if (!file.type.startsWith('image/')) {
        rejection = 'Only image files can be attached';
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        rejection = 'Each photo must be under 10MB';
        continue;
      }
      accepted.push({ file, preview: URL.createObjectURL(file) });
    }

    if (accepted.length > 0) onChange([...files, ...accepted]);
    if (rejection) onError?.(rejection);

    // Reset so re-picking the same file still fires a change event.
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeAt = (index: number) => {
    const next = [...files];
    URL.revokeObjectURL(next[index].preview);
    next.splice(index, 1);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className="text-xs text-gray-500">
          {files.length}/{maxFiles}
        </span>
      </div>

      {helpText && <p className="text-xs text-gray-500">{helpText}</p>}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, index) => (
            <div key={f.preview} className="relative">
              <img
                src={f.preview}
                alt={f.file.name}
                className="w-20 h-20 object-cover rounded-lg border border-gray-200"
              />
              <button
                type="button"
                onClick={() => removeAt(index)}
                disabled={disabled}
                aria-label={`Remove ${f.file.name}`}
                className="absolute -top-1.5 -right-1.5 p-1 bg-white border border-gray-200 rounded-full shadow-sm text-gray-500 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleSelect}
        disabled={disabled || files.length >= maxFiles}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || files.length >= maxFiles}
        className="w-full px-4 py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:border-purple-400 hover:text-purple-600 transition-colors disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:text-gray-600 flex items-center justify-center gap-2"
      >
        <Upload className="w-4 h-4" />
        {files.length >= maxFiles ? `Maximum ${maxFiles} photos selected` : 'Choose photos'}
      </button>
    </div>
  );
}
