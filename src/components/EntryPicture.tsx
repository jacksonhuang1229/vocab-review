import { useEffect, useRef, useState } from 'react';
import { deleteImage, saveImage } from '../db/imageStore';
import { listWordSets } from '../db/wordSetStore';
import type { DraftEntry } from '../domain/draft';
import { createId } from '../domain/ids';
import type { ImageAsset } from '../domain/types';
import { pictureStatus } from '../practice/picture';
import { normalizeSpelling } from '../practice/score';

type EntryPictureProps = {
  entry: DraftEntry;
  entries: DraftEntry[];
  images: ImageAsset[];
  imagesLoaded: boolean;
  onEntry: (entry: DraftEntry) => void;
  onImages: (images: ImageAsset[]) => void;
};

export function EntryPicture({ entry, entries, images, imagesLoaded, onEntry, onImages }: EntryPictureProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asset = images.find((image) => image.id === entry.imageId);
  const status = pictureStatus(entry, asset, imagesLoaded);
  const meaning = entry.meaningHint.trim();
  const spelling = entry.spelling.trim();
  const reusable = images.filter(
    (image) =>
      image.id !== entry.imageId &&
      meaning.length > 0 &&
      spelling.length > 0 &&
      normalizeSpelling(image.word) === normalizeSpelling(spelling) &&
      image.meaning.trim() === meaning &&
      (!entry.abstract || image.sceneConfirmed),
  );

  async function remember(next: ImageAsset, previousId?: string) {
    await saveImage(next);
    const withoutPrevious =
      previousId && previousId !== next.id && !(await imageStillUsed(previousId, entry.id, entries))
        ? images.filter((image) => image.id !== previousId)
        : images;
    if (previousId && previousId !== next.id && !(await imageStillUsed(previousId, entry.id, entries))) {
      await deleteImage(previousId);
    }
    onImages([...withoutPrevious.filter((image) => image.id !== next.id), next]);
  }

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!spelling || !meaning) {
      setError('先寫上英文拼寫和詞義，再上傳配圖。');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('請選擇圖片檔。');
      return;
    }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file).catch(() => null);
      if (!bitmap) {
        setError('這張圖片讀不到，請換一張。');
        return;
      }
      bitmap.close();
      const next: ImageAsset = {
        id: createId(),
        word: spelling,
        meaning,
        blob: file,
        source: 'upload',
        sceneConfirmed: !entry.abstract,
        createdAt: Date.now(),
      };
      await remember(next, entry.imageId);
      onEntry({
        ...entry,
        imageId: next.id,
        imageAcceptedSpelling: undefined,
        imageAcceptedMeaning: undefined,
      });
    } catch {
      setError('配圖沒有存好，請再試一次。');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function reuse(image: ImageAsset) {
    setError(null);
    const previousId = entry.imageId;
    if (previousId && previousId !== image.id && !(await imageStillUsed(previousId, entry.id, entries))) {
      await deleteImage(previousId);
      onImages(images.filter((item) => item.id !== previousId));
    }
    onEntry({
      ...entry,
      imageId: image.id,
      imageAcceptedSpelling: undefined,
      imageAcceptedMeaning: undefined,
    });
  }

  async function remove() {
    setError(null);
    const previousId = entry.imageId;
    onEntry({
      ...entry,
      imageId: undefined,
      imageAcceptedSpelling: undefined,
      imageAcceptedMeaning: undefined,
    });
    if (previousId && !(await imageStillUsed(previousId, entry.id, entries))) {
      await deleteImage(previousId);
      onImages(images.filter((image) => image.id !== previousId));
    }
  }

  async function confirmScene() {
    if (!asset) return;
    setError(null);
    const next = { ...asset, sceneConfirmed: true };
    await saveImage(next);
    onImages(images.map((image) => (image.id === next.id ? next : image)));
  }

  function acceptCurrent() {
    if (!spelling || !meaning) {
      setError('先寫上英文拼寫和詞義，再確認這張圖。');
      return;
    }
    setError(null);
    onEntry({
      ...entry,
      imageAcceptedSpelling: spelling,
      imageAcceptedMeaning: meaning,
    });
  }

  async function toggleAbstract(abstract: boolean) {
    setError(null);
    onEntry({ ...entry, abstract: abstract || undefined });
    if (abstract && asset?.sceneConfirmed) {
      const next = { ...asset, sceneConfirmed: false };
      await saveImage(next);
      onImages(images.map((image) => (image.id === next.id ? next : image)));
    }
  }

  return (
    <div className="entry-picture" data-testid="entry-picture" data-spelling={spelling} data-state={status}>
      <label className="check-line">
        <input
          data-testid="picture-abstract"
          type="checkbox"
          checked={Boolean(entry.abstract)}
          onChange={(event) => {
            void toggleAbstract(event.target.checked);
          }}
        />
        抽象詞，需要情境圖
      </label>
      {asset ? <PictureThumb blob={asset.blob} testId="picture-preview" large={false} /> : null}
      <div className="picture-actions">
        <button
          type="button"
          className="button button-quiet"
          data-testid="picture-upload"
          disabled={busy || !imagesLoaded}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? '讀取圖片…' : asset ? '更換配圖' : '上傳配圖'}
        </button>
        <input
          ref={fileRef}
          className="sr-only"
          data-testid="picture-file"
          type="file"
          accept="image/*"
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
          }}
        />
        {reusable.map((image) => (
          <button key={image.id} type="button" className="button button-quiet" data-testid="picture-reuse" onClick={() => void reuse(image)}>
            使用已確認的配圖
          </button>
        ))}
        {status === 'needs-scene' ? (
          <button type="button" className="button button-quiet" data-testid="picture-confirm-scene" onClick={() => void confirmScene()}>
            確認情境圖
          </button>
        ) : null}
        {status === 'needs-reconfirm' ? (
          <button type="button" className="button button-quiet" data-testid="picture-reconfirm" onClick={acceptCurrent}>
            仍然適用
          </button>
        ) : null}
        {entry.imageId ? (
          <button type="button" className="button button-quiet" data-testid="picture-remove" onClick={() => void remove()}>
            移除配圖
          </button>
        ) : null}
      </div>
      {asset ? (
        <p className="hint" data-testid="picture-source">
          來源：家長上傳
        </p>
      ) : null}
      {status === 'needs-reconfirm' ? (
        <p className="hint" data-testid="picture-reconfirm-note">
          拼寫或詞義已改，請確認這張圖是否還適用。
        </p>
      ) : null}
      {status === 'needs-scene' ? (
        <p className="hint" data-testid="picture-scene-note">
          抽象詞要確認情境圖之後，才會出現在看圖選字。
        </p>
      ) : null}
      {status === 'missing' ? <p className="hint">找不到這張配圖，可以重新上傳。</p> : null}
      {error ? (
        <p className="banner banner-error" role="alert" data-testid="picture-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

async function imageStillUsed(imageId: string, exceptEntryId: string, drafts: DraftEntry[]): Promise<boolean> {
  if (drafts.some((entry) => entry.id !== exceptEntryId && entry.imageId === imageId)) return true;
  const sets = await listWordSets();
  return sets.some((set) => set.entries.some((entry) => entry.id !== exceptEntryId && entry.imageId === imageId));
}

export function PictureThumb({ blob, testId, large }: { blob: Blob; testId?: string; large: boolean }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  if (!url) return null;
  return <img className={large ? 'picture-prompt' : 'picture-thumb'} src={url} alt="" data-testid={testId} />;
}
