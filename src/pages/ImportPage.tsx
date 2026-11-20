import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EntryListEditor } from '../components/EntryListEditor';
import type { DraftEntry } from '../domain/draft';
import { draftToEntries, validateDraft } from '../domain/draft';
import { createId } from '../domain/ids';
import { parseWordList } from '../domain/parseWordList';
import {
  SAVE_FAILED_MESSAGE,
  WordSetSaveError,
  createWordSet,
  saveFailureArmed,
} from '../db/wordSetStore';

type LoadState =
  | { status: 'idle' }
  | { status: 'empty'; fileName: string }
  | { status: 'loaded'; fileName: string; loadedCount: number };

export function ImportPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = '匯入課次 · 英文單字複習';
    function keepFileDropOnPage(event: DragEvent) {
      event.preventDefault();
    }
    window.addEventListener('dragover', keepFileDropOnPage);
    window.addEventListener('drop', keepFileDropOnPage);
    return () => {
      window.removeEventListener('dragover', keepFileDropOnPage);
      window.removeEventListener('drop', keepFileDropOnPage);
    };
  }, []);

  async function loadFile(file: File) {
    const lowerName = file.name.toLowerCase();
    const typeOk = lowerName.endsWith('.txt') || file.type === 'text/plain';
    if (!typeOk) {
      setError('請選擇 .txt 文字檔。目前的預覽沒有被清掉。');
      return;
    }

    let text: string;
    try {
      text = decodeUtf8(await file.arrayBuffer());
    } catch {
      setError('無法以 UTF-8 讀取這個檔案。目前的預覽沒有被清掉。');
      return;
    }

    const spellings = parseWordList(text);
    setError(null);
    if (spellings.length === 0) {
      setEntries([]);
      setLoadState({ status: 'empty', fileName: file.name });
      return;
    }

    setEntries(spellings.map((spelling) => ({ id: createId(), spelling, meaningHint: '' })));
    setLoadState({ status: 'loaded', fileName: file.name, loadedCount: spellings.length });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const problem = validateDraft(name, entries);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createWordSet({
        name,
        entries: draftToEntries(entries),
      });
      navigate(`/sets/${created.id}`);
    } catch (caught) {
      setError(caught instanceof WordSetSaveError ? caught.message : SAVE_FAILED_MESSAGE);
    } finally {
      setSaving(false);
    }
  }

  const emptyCopy =
    loadState.status === 'empty'
      ? {
          title: '這份檔案是空的',
          body: '沒有讀到任何英文詞。預覽會留在這個畫面。你可以自行新增詞條，或改選另一個檔案。取消匯入不會留下新的課次。',
          testId: 'empty-file',
        }
      : {
          title: '預覽還是空的',
          body: '選擇 UTF-8 文字檔，或自行新增詞條。檔案裡每一行會變成一個英文詞或片語。',
          testId: 'empty-preview',
        };

  return (
    <form
      className="stack-lg"
      data-testid="import-form"
      aria-busy={saving}
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
      }}
    >
      <div className="page-head">
        <h1>匯入課次</h1>
        <p className="lede">
          選擇 UTF-8 文字檔，每行一個英文詞或片語。課次名稱在這個畫面填寫。按下「確認並儲存」之前不會寫入。
        </p>
      </div>

      {saveFailureArmed() ? (
        <p className="banner banner-note" data-testid="failure-armed">
          目前會模擬寫入失敗，用來確認預覽修改不會被清掉。
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="set-name">課次名稱</label>
        <input
          id="set-name"
          data-testid="set-name"
          type="text"
          value={name}
          placeholder="例如 Flyer - Unit 4"
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div
        className={dragging ? 'file-field is-dragging' : 'file-field'}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.target instanceof HTMLInputElement) return;
          const file = event.dataTransfer.files[0];
          if (file) void loadFile(file);
        }}
      >
        <label htmlFor="word-file">文字檔</label>
        <div className="file-actions">
          <button type="button" className="button button-ghost" onClick={() => fileInput.current?.click()}>
            選擇文字檔
          </button>
          <span data-testid="chosen-file">{loadState.status === 'idle' ? '尚未選擇檔案' : loadState.fileName}</span>
        </div>
        <input
          ref={fileInput}
          id="word-file"
          className="sr-only"
          data-testid="file-input"
          type="file"
          accept=".txt,text/plain"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void loadFile(file);
          }}
        />
        <p className="hint">每行一個英文詞或片語。重新選擇檔案會換掉預覽中的詞條，課次名稱會保留。也可以把檔案拖到這裡。</p>
      </div>

      {loadState.status === 'loaded' ? (
        <p className="banner banner-ok" data-testid="file-status">
          已讀取 {loadState.fileName}，共 {loadState.loadedCount} 個詞。可以先增刪或修正，再確認儲存。
        </p>
      ) : null}
      {loadState.status === 'empty' ? (
        <p className="banner banner-note" data-testid="file-status">
          已讀取 {loadState.fileName}。這份檔案是空的，沒有詞條。
        </p>
      ) : null}

      <EntryListEditor
        entries={entries}
        onChange={setEntries}
        emptyTitle={emptyCopy.title}
        emptyBody={emptyCopy.body}
        emptyTestId={emptyCopy.testId}
      />

      {error ? (
        <p className="banner banner-error" role="alert" data-testid="save-error">
          {error}
        </p>
      ) : null}

      <div className="action-bar">
        <Link className="button button-ghost" to="/" data-testid="cancel-import">
          取消匯入
        </Link>
        <button type="submit" className="button button-primary" data-testid="confirm-save" disabled={saving}>
          {saving ? '儲存中…' : '確認並儲存'}
        </button>
      </div>
      <p className="hint">取消匯入不會新增課次，也不會更改已經儲存的內容。若儲存失敗，這個預覽裡的修改會留下。</p>
    </form>
  );
}

function decodeUtf8(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('utf-8');
  }
}
