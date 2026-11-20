import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import type { DraftEntry } from '../domain/draft';
import { createId } from '../domain/ids';

type EntryListEditorProps = {
  entries: DraftEntry[];
  onChange: (entries: DraftEntry[]) => void;
  emptyTitle: string;
  emptyBody: string;
  emptyTestId: string;
  renderEntryExtra?: (entry: DraftEntry) => ReactNode;
};

export function EntryListEditor({
  entries,
  onChange,
  emptyTitle,
  emptyBody,
  emptyTestId,
  renderEntryExtra,
}: EntryListEditorProps) {
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const node = document.getElementById(`spelling-${id}`);
    if (node instanceof HTMLInputElement) {
      node.focus();
      pendingFocus.current = null;
    }
  }, [entries]);

  function update(id: string, patch: Partial<Pick<DraftEntry, 'spelling' | 'meaningHint'>>) {
    onChange(
      entries.map((entry) => {
        if (entry.id !== id) return entry;
        const next: DraftEntry = { ...entry, ...patch };
        delete next.imageAcceptedSpelling;
        delete next.imageAcceptedMeaning;
        return next;
      }),
    );
  }

  function remove(id: string) {
    onChange(entries.filter((entry) => entry.id !== id));
  }

  function move(index: number, delta: number) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= entries.length) return;
    const copy = entries.slice();
    const [item] = copy.splice(index, 1);
    if (!item) return;
    copy.splice(nextIndex, 0, item);
    onChange(copy);
  }

  function addEntry() {
    const id = createId();
    pendingFocus.current = id;
    onChange([...entries, { id, spelling: '', meaningHint: '' }]);
  }

  return (
    <div className="stack" data-testid="preview">
      <div className="section-head">
        <h2>
          詞條 <span className="count">{entries.length}</span>
        </h2>
      </div>
      {entries.length === 0 ? (
        <div className="empty-panel" data-testid={emptyTestId}>
          <h2>{emptyTitle}</h2>
          <p>{emptyBody}</p>
        </div>
      ) : (
        <ol className="entry-list">
          {entries.map((entry, index) => (
            <li key={entry.id} className="entry-row" data-testid="entry-row">
              <span className="entry-index">{index + 1}</span>
              <div className="entry-main">
                <div className="entry-fields">
                  <input
                    id={`spelling-${entry.id}`}
                    data-testid="entry-spelling"
                    type="text"
                    lang="en"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={entry.spelling}
                    aria-label={`第 ${index + 1} 個詞的拼寫`}
                    placeholder="英文詞或片語"
                    onChange={(event) => update(entry.id, { spelling: event.target.value })}
                  />
                  <input
                    data-testid="entry-meaning"
                    type="text"
                    lang="zh-Hant"
                    value={entry.meaningHint}
                    aria-label={`第 ${index + 1} 個詞的詞義提示`}
                    placeholder="詞義提示，選填"
                    onChange={(event) => update(entry.id, { meaningHint: event.target.value })}
                  />
                </div>
                <div className="entry-actions">
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`上移第 ${index + 1} 個詞`}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => move(index, 1)}
                    disabled={index === entries.length - 1}
                    aria-label={`下移第 ${index + 1} 個詞`}
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    className="button button-quiet button-danger"
                    onClick={() => remove(entry.id)}
                    aria-label={`刪除第 ${index + 1} 個詞`}
                  >
                    刪除
                  </button>
                </div>
                {renderEntryExtra ? renderEntryExtra(entry) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      <div>
        <button type="button" className="button button-ghost" data-testid="add-entry" onClick={addEntry}>
          新增詞條
        </button>
      </div>
    </div>
  );
}
