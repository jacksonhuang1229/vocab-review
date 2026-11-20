import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatTimestamp } from '../domain/format';
import type { WordSet } from '../domain/types';
import { listWordSets } from '../db/wordSetStore';

export function SetListPage() {
  const [sets, setSets] = useState<WordSet[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    document.title = '單字組 · 英文單字複習';
    let active = true;
    listWordSets()
      .then((rows) => {
        if (active) setSets(rows);
      })
      .catch(() => {
        if (active) setLoadError('無法讀取已儲存的單字組。');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="stack-lg">
      <div className="page-head">
        <h1>單字組</h1>
        {sets === null ? (
          <p className="lede">正在讀取已儲存的課次。</p>
        ) : sets.length === 0 ? (
          <p className="lede">第一次使用時，從文字檔建立一個課次。之後可以在這裡直接選擇。</p>
        ) : (
          <p className="lede">已儲存 {sets.length} 個課次。選擇一個課次，或匯入新的文字檔。</p>
        )}
      </div>

      {loadError ? (
        <p className="banner banner-error" role="alert">
          {loadError}
        </p>
      ) : null}

      {sets !== null && sets.length === 0 ? (
        <div className="empty-panel" data-testid="empty-library">
          <h2>還沒有單字組</h2>
          <p>匯入一份 UTF-8 文字檔來建立第一個課次。之後可以在這裡選擇已儲存的課次，例如 Flyer - Unit 4。</p>
          <div>
            <Link className="button button-primary" to="/import" data-testid="create-set">
              建立單字組
            </Link>
          </div>
        </div>
      ) : null}

      {sets !== null && sets.length > 0 ? (
        <>
          <div>
            <Link className="button button-primary" to="/import" data-testid="create-set">
              匯入新課次
            </Link>
          </div>
          <ul className="set-list" data-testid="set-list">
            {sets.map((set) => (
              <li key={set.id}>
                <Link className="set-card" to={`/sets/${set.id}`} data-testid="set-card" data-set-name={set.name}>
                  <span className="set-card-name">{set.name}</span>
                  <span className="meta">
                    {set.entries.length} 個詞 · {formatTimestamp(set.updatedAt)} 更新
                  </span>
                  <span className="set-card-preview">{previewSpellings(set)}</span>
                  <span className="set-card-go">查看</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function previewSpellings(set: WordSet): string {
  const words = set.entries.slice(0, 3).map((entry) => entry.spelling);
  if (words.length === 0) return '沒有詞條';
  return set.entries.length > 3 ? `${words.join('、')}…` : words.join('、');
}
