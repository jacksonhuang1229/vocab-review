const MODES = [
  {
    id: 'dictation',
    title: '聽音拼字',
    description: '聽完整的詞或片語，再輸入答案。',
  },
  {
    id: 'cloze',
    title: '字母填空',
    description: '空格與連字號會保留，只填英文字母。',
  },
  {
    id: 'picture',
    title: '看圖選字',
    description: '看已確認的圖片，選出正確拼寫。',
  },
] as const;

export function PracticeModes() {
  return (
    <section className="stack" data-testid="practice-modes" aria-labelledby="practice-heading">
      <div className="section-head">
        <h2 id="practice-heading">練習模式</h2>
      </div>
      <p className="hint">聽音拼字、字母填空和看圖選字都尚未開放。</p>
      <ul className="mode-list">
        {MODES.map((mode) => (
          <li key={mode.id} className="mode-card" data-testid="mode-unavailable">
            <span className="badge">尚未開放</span>
            <h3>{mode.title}</h3>
            <p>{mode.description}</p>
            <button type="button" className="button button-ghost" disabled>
              尚未開放
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
