import { Link } from 'react-router-dom';
import { canAskCloze, canAskListen, letterCount } from '../practice/blanks';
import type { WordEntry } from '../domain/types';

type PracticeModesProps = {
  setId: string;
  entries: WordEntry[];
  dirty: boolean;
};

export function PracticeModes({ setId, entries, dirty }: PracticeModesProps) {
  const clozeCount = entries.filter((entry) => canAskCloze(entry.spelling)).length;
  const listenCount = entries.filter((entry) => canAskListen(entry.spelling)).length;
  const singleLetters = entries.filter((entry) => letterCount(entry.spelling) === 1).length;

  return (
    <section className="stack" data-testid="practice-modes" aria-labelledby="practice-heading">
      <div className="section-head">
        <h2 id="practice-heading">練習模式</h2>
      </div>
      <p className="hint">字母填空和聽音拼字使用已儲存的詞。看圖選字還沒開放。</p>
      {dirty ? (
        <p className="hint" data-testid="practice-uses-saved">
          畫面上還沒儲存的修改不會出題。先按「儲存修改」，練習才會用新的詞。
        </p>
      ) : null}
      <ul className="mode-list">
        <li className="mode-card is-ready" data-testid="mode-listen">
          <span className="badge badge-ready">可練習</span>
          <h3>聽音拼字</h3>
          <p>聽完整的詞或片語，再輸入答案。</p>
          <p data-testid="mode-count">可出題 {listenCount} 個詞</p>
          {listenCount > 0 ? (
            <Link className="button button-primary" to={`/sets/${setId}/practice/listen`} data-testid="start-listen">
              開始練習
            </Link>
          ) : (
            <button type="button" className="button button-ghost" disabled>
              沒有可出的題
            </button>
          )}
        </li>
        <li className="mode-card is-ready" data-testid="mode-cloze">
          <span className="badge badge-ready">可練習</span>
          <h3>字母填空</h3>
          <p>空格與連字號會保留，只填英文字母。</p>
          <p data-testid="mode-count">可出題 {clozeCount} 個詞</p>
          {singleLetters > 0 ? (
            <p className="hint" data-testid="cloze-skipped">
              單一字母的詞留給其他模式。
            </p>
          ) : null}
          {clozeCount > 0 ? (
            <Link className="button button-primary" to={`/sets/${setId}/practice/cloze`} data-testid="start-cloze">
              開始練習
            </Link>
          ) : (
            <button type="button" className="button button-ghost" disabled>
              沒有可出的題
            </button>
          )}
        </li>
        <li className="mode-card" data-testid="mode-unavailable">
          <span className="badge">尚未開放</span>
          <h3>看圖選字</h3>
          <p>看已確認的圖片，選出正確拼寫。</p>
          <button type="button" className="button button-ghost" disabled>
            尚未開放
          </button>
        </li>
      </ul>
    </section>
  );
}
