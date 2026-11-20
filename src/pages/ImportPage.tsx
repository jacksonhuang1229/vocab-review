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
import {
  imageCanBeDecoded,
  recognizePrintedEnglish,
  setOcrProgressListener,
  type OcrFailure,
} from '../ocr/recognizeEnglish';

type LoadState =
  | { status: 'idle' }
  | { status: 'empty'; fileName: string }
  | { status: 'loaded'; fileName: string; loadedCount: number; source: 'text' | 'photo' };

const OCR_MESSAGES: Record<OcrFailure, string> = {
  undecodable: '這張照片讀取不到。預覽裡的修改還在，可以重拍、改選另一張，或在下面貼上詞列。',
  empty: '沒有辨識到英文詞。預覽裡的修改還在，可以重拍、改選另一張，或手動貼上。',
  unreadable: '這張照片太模糊，沒有採用辨識結果。預覽裡的修改還在，可以重拍、改選另一張，或手動貼上。',
  failed: '辨識沒有完成。預覽裡的修改還在，可以重拍、改選另一張，或手動貼上。',
};

export function ImportPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [ocrPercent, setOcrPercent] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [textFileName, setTextFileName] = useState<string | null>(null);
  const [photoFileName, setPhotoFileName] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const albumInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    document.title = '匯入課次 · 英文單字複習';
    mounted.current = true;
    setOcrProgressListener((percent) => {
      if (mounted.current) setOcrPercent(percent);
    });
    function keepFileDropOnPage(event: DragEvent) {
      event.preventDefault();
    }
    window.addEventListener('dragover', keepFileDropOnPage);
    window.addEventListener('drop', keepFileDropOnPage);
    return () => {
      mounted.current = false;
      setOcrProgressListener(null);
      window.removeEventListener('dragover', keepFileDropOnPage);
      window.removeEventListener('drop', keepFileDropOnPage);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  function replacePhotoUrl(next: string | null) {
    setPhotoUrl(next);
  }

  function spellingsToDraft(spellings: string[]): DraftEntry[] {
    return spellings.map((spelling) => ({ id: createId(), spelling, meaningHint: '' }));
  }

  async function loadTextFile(file: File) {
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
    setPasteNotice(null);
    setTextFileName(file.name);
    if (spellings.length === 0) {
      setEntries([]);
      setLoadState({ status: 'empty', fileName: file.name });
      return;
    }

    setEntries(spellingsToDraft(spellings));
    setLoadState({ status: 'loaded', fileName: file.name, loadedCount: spellings.length, source: 'text' });
  }

  async function recognizePhoto(file: File) {
    const id = requestId.current + 1;
    requestId.current = id;
    setRecognizing(true);
    setOcrPercent(null);
    setError(null);
    setPasteNotice(null);
    setPhotoFileName(file.name);
    try {
      const decoded = await imageCanBeDecoded(file);
      if (!mounted.current || id !== requestId.current) return;
      if (!decoded) {
        replacePhotoUrl(null);
        setError(OCR_MESSAGES.undecodable);
        return;
      }
      replacePhotoUrl(URL.createObjectURL(file));
      const outcome = await recognizePrintedEnglish(file);
      if (!mounted.current || id !== requestId.current) return;
      if (!outcome.ok) {
        setError(OCR_MESSAGES[outcome.reason]);
        return;
      }
      setEntries(spellingsToDraft(outcome.lines));
      setLoadState({
        status: 'loaded',
        fileName: file.name,
        loadedCount: outcome.lines.length,
        source: 'photo',
      });
    } catch {
      if (!mounted.current || id !== requestId.current) return;
      setError(OCR_MESSAGES.failed);
    } finally {
      if (mounted.current && id === requestId.current) setRecognizing(false);
    }
  }

  function ingestDroppedFile(file: File) {
    if (isTextFile(file)) {
      void loadTextFile(file);
      return;
    }
    if (isImageFile(file)) {
      void recognizePhoto(file);
      return;
    }
    setError('請選擇 .txt 文字檔或照片。目前的預覽沒有被清掉。');
  }

  function addPastedLines() {
    const spellings = parseWordList(pasteText);
    if (spellings.length === 0) {
      setPasteNotice(null);
      setError('沒有讀到可以加入的詞。預覽裡的內容還在。');
      return;
    }
    setError(null);
    setEntries((current) => [...current, ...spellingsToDraft(spellings)]);
    setPasteText('');
    setPasteNotice(`已把 ${spellings.length} 個詞加入預覽，還沒有寫入。`);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || recognizing) return;
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
          body: '選擇 UTF-8 文字檔或單欄英文照片，也可以自行新增或貼上詞條。',
          testId: 'empty-preview',
        };

  return (
    <form
      className="stack-lg"
      data-testid="import-form"
      aria-busy={saving || recognizing}
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
          可以用 UTF-8 文字檔，或拍一張單欄印刷的英文。課次名稱在這個畫面填寫。按下「確認並儲存」之前不會寫入。
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
          const file = event.dataTransfer.files[0];
          if (file) ingestDroppedFile(file);
        }}
      >
        <label htmlFor="word-file">文字檔</label>
        <div className="file-actions">
          <button type="button" className="button button-ghost" onClick={() => fileInput.current?.click()}>
            選擇文字檔
          </button>
          <span data-testid="chosen-file">{textFileName ?? '尚未選擇檔案'}</span>
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
            if (file) void loadTextFile(file);
          }}
        />
        <p className="hint">每行一個英文詞或片語。重新選擇文字檔會換掉預覽中的詞條，課次名稱會保留。也可以把檔案拖到這裡。</p>
      </div>

      <div className="file-field" data-testid="photo-source">
        <p className="section-label">照片</p>
        <div className="file-actions">
          <button type="button" className="button button-ghost" data-testid="camera-button" onClick={() => cameraInput.current?.click()}>
            拍照
          </button>
          <button type="button" className="button button-ghost" data-testid="album-button" onClick={() => albumInput.current?.click()}>
            從相簿選擇
          </button>
          <span data-testid="photo-file">{photoFileName ?? '尚未選擇照片'}</span>
        </div>
        <input
          ref={cameraInput}
          className="sr-only"
          data-testid="camera-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void recognizePhoto(file);
          }}
        />
        <input
          ref={albumInput}
          className="sr-only"
          data-testid="album-input"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void recognizePhoto(file);
          }}
        />
        <p className="hint">
          適合單欄印刷的英文。辨識在這個瀏覽器裡完成，照片不會送出。拍照實際開相機或檔案選擇器，由瀏覽器決定，所以另外保留「從相簿選擇」。辨識出詞之後會換掉預覽中的詞條；讀不到、太模糊或辨識失敗時，預覽不會被清掉。
        </p>
        {photoUrl ? (
          <figure className="photo-preview">
            <img src={photoUrl} alt="準備辨識的照片" data-testid="photo-preview" />
          </figure>
        ) : null}
        {recognizing ? (
          <p className="banner banner-note" role="status" data-testid="ocr-progress">
            正在這個瀏覽器裡辨識英文{ocrPercent === null ? '…' : `… ${ocrPercent}%`}
          </p>
        ) : null}
        {error && isOcrError(error) ? (
          <p className="banner banner-error" role="alert" data-testid="ocr-error">
            {error}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="paste-lines">手動貼上</label>
        <textarea
          id="paste-lines"
          data-testid="paste-lines"
          lang="en"
          value={pasteText}
          placeholder={'每行一個英文詞或片語'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setPasteText(event.target.value)}
        />
        <div>
          <button type="button" className="button button-ghost" data-testid="paste-add" onClick={addPastedLines}>
            加入預覽
          </button>
        </div>
        <p className="hint">辨識失敗時可以把詞貼在這裡。加入預覽不會清掉已經寫在上面的詞，也不會寫入。</p>
      </div>

      {pasteNotice ? (
        <p className="banner banner-ok" data-testid="paste-notice">
          {pasteNotice}
        </p>
      ) : null}

      {loadState.status === 'loaded' && loadState.source === 'text' ? (
        <p className="banner banner-ok" data-testid="file-status">
          已讀取 {loadState.fileName}，共 {loadState.loadedCount} 個詞。可以先增刪或修正，再確認儲存。
        </p>
      ) : null}
      {loadState.status === 'loaded' && loadState.source === 'photo' ? (
        <p className="banner banner-ok" data-testid="file-status">
          已辨識 {loadState.fileName}，共 {loadState.loadedCount} 個詞。可以逐行修正，再確認儲存。
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

      {error && !isOcrError(error) ? (
        <p className="banner banner-error" role="alert" data-testid="save-error">
          {error}
        </p>
      ) : null}

      <div className="action-bar">
        <Link className="button button-ghost" to="/" data-testid="cancel-import">
          取消匯入
        </Link>
        <button type="submit" className="button button-primary" data-testid="confirm-save" disabled={saving || recognizing}>
          {saving ? '儲存中…' : recognizing ? '辨識中…' : '確認並儲存'}
        </button>
      </div>
      <p className="hint">取消匯入不會新增課次，也不會更改已經儲存的內容。若儲存或辨識失敗，這個預覽裡的修改會留下。</p>
    </form>
  );
}

function isOcrError(message: string): boolean {
  return (
    message.startsWith('這張照片') ||
    message.startsWith('沒有辨識') ||
    message.startsWith('辨識沒有完成')
  );
}

function isTextFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith('.txt') || file.type === 'text/plain';
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(file.name);
}

function decodeUtf8(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('utf-8');
  }
}
