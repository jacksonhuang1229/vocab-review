import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EntryListEditor } from '../components/EntryListEditor';
import { EntryPicture } from '../components/EntryPicture';
import { PracticeModes } from '../components/PracticeModes';
import type { DraftEntry } from '../domain/draft';
import { draftToEntries, entriesToDraft, sameStoredContent, validateDraft } from '../domain/draft';
import { formatTimestamp } from '../domain/format';
import type { ImageAsset, WordSet } from '../domain/types';
import { listImages } from '../db/imageStore';
import {
  SAVE_FAILED_MESSAGE,
  WordSetSaveError,
  getWordSet,
  saveFailureArmed,
  updateWordSet,
} from '../db/wordSetStore';
import { buildPictureRound } from '../practice/picture';

export function SetDetailPage() {
  const { id } = useParams();
  const [saved, setSaved] = useState<WordSet | null>(null);
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState<ImageAsset[] | null>(null);

  useEffect(() => {
    document.title = '課次內容 · 英文單字複習';
    if (!id) {
      setMissing(true);
      return;
    }
    let active = true;
    setSaved(null);
    setMissing(false);
    setLoadError(null);
    getWordSet(id)
      .then((row) => {
        if (!active) return;
        if (!row) {
          setMissing(true);
          return;
        }
        setSaved(row);
        setName(row.name);
        setEntries(entriesToDraft(row.entries));
      })
      .catch(() => {
        if (active) setLoadError('無法讀取這個單字組。');
      });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setImages(null);
    listImages()
      .then((rows) => {
        if (active) setImages(rows);
      })
      .catch(() => {
        if (active) setLoadError('無法讀取配圖。');
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || saving) return;
    const problem = validateDraft(name, entries);
    if (problem) {
      setError(problem);
      setNotice(null);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await updateWordSet(id, {
        name,
        entries: draftToEntries(entries),
      });
      setSaved(next);
      setName(next.name);
      setEntries(entriesToDraft(next.entries));
      setNotice('已儲存。');
    } catch (caught) {
      setError(caught instanceof WordSetSaveError ? caught.message : SAVE_FAILED_MESSAGE);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <p className="banner banner-error" role="alert">
        {loadError}
      </p>
    );
  }

  if (missing) {
    return (
      <section className="stack">
        <h1>找不到這個單字組</h1>
        <p>它可能還沒有儲存。</p>
        <Link className="button button-ghost" to="/">
          回到單字組
        </Link>
      </section>
    );
  }

  if (!saved) {
    return <p>正在讀取課次。</p>;
  }

  const dirty = !sameStoredContent(name, entries, saved);

  return (
    <form
      className="stack-lg"
      data-testid="detail-form"
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
        <Link className="text-link" to="/" data-testid="back-to-list">
          回到單字組
        </Link>
        <div className="field">
          <label htmlFor="detail-name">課次名稱</label>
          <input
            id="detail-name"
            className="name-input"
            data-testid="detail-name"
            type="text"
            value={name}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              setNotice(null);
            }}
          />
        </div>
        <p className="meta">
          共 {entries.length} 個詞 · {formatTimestamp(saved.createdAt)} 建立 · {formatTimestamp(saved.updatedAt)} 更新
          {dirty ? ' · 有尚未儲存的修改' : ''}
        </p>
      </div>

      {saveFailureArmed() ? (
        <p className="banner banner-note" data-testid="failure-armed">
          目前會模擬寫入失敗，用來確認畫面上的修改不會被清掉。
        </p>
      ) : null}

      {notice ? (
        <p className="banner banner-ok" data-testid="save-notice">
          {notice}
        </p>
      ) : null}

      <EntryListEditor
        entries={entries}
        onChange={(next) => {
          setEntries(next);
          setNotice(null);
        }}
        emptyTitle="這個課次目前沒有詞條"
        emptyBody="新增詞條後再儲存。尚未儲存前，原來的課次不會被改掉。"
        emptyTestId="empty-preview"
        renderEntryExtra={(entry) => (
          <EntryPicture
            entry={entry}
            entries={entries}
            images={images ?? []}
            imagesLoaded={images !== null}
            onEntry={(next) => {
              setEntries((current) => current.map((item) => (item.id === next.id ? next : item)));
              setNotice(null);
            }}
            onImages={setImages}
          />
        )}
      />

      {error ? (
        <p className="banner banner-error" role="alert" data-testid="save-error">
          {error}
        </p>
      ) : null}

      <div className="action-bar">
        <button type="submit" className="button button-primary" data-testid="detail-save" disabled={saving || !dirty}>
          {saving ? '儲存中…' : '儲存修改'}
        </button>
      </div>
      <p className="hint">修改會留在這個畫面，按下「儲存修改」才寫入。若儲存失敗，這些修改會留下。</p>

      <PracticeModes
        setId={saved.id}
        entries={saved.entries}
        dirty={dirty}
        pictureCount={buildPictureRound(saved.entries, images ?? []).length}
      />
    </form>
  );
}
