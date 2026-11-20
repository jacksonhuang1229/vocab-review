import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PictureThumb } from '../components/EntryPicture';
import type { ImageAsset, WordEntry, WordSet } from '../domain/types';
import { listImages } from '../db/imageStore';
import { getWordSet } from '../db/wordSetStore';
import { buildBlankPrompt, canAskListen, reconstructSpelling } from '../practice/blanks';
import type { BlankPrompt } from '../practice/blanks';
import { buildPictureRound } from '../practice/picture';
import type { PictureChoice } from '../practice/picture';
import { answersMatch } from '../practice/score';
import { loadEnglishVoice, speakText } from '../practice/speech';
import type { EnglishVoice } from '../practice/speech';

type PracticeMode = 'cloze' | 'listen' | 'picture';
type Phase = 'answer' | 'feedback' | 'summary';

type Question = {
  id: string;
  spelling: string;
  prompt: BlankPrompt | null;
  imageId?: string;
  choices?: PictureChoice[];
};

const MODE_TITLE: Record<PracticeMode, string> = {
  cloze: '字母填空',
  listen: '聽音拼字',
  picture: '看圖選字',
};

export function PracticePage() {
  const { id, mode: modeParam } = useParams();
  const mode: PracticeMode | null = modeParam === 'cloze' || modeParam === 'listen' || modeParam === 'picture' ? modeParam : null;
  const [saved, setSaved] = useState<WordSet | null>(null);
  const [images, setImages] = useState<ImageAsset[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    document.title = mode ? `${MODE_TITLE[mode]} · 英文單字複習` : '練習 · 英文單字複習';
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
      })
      .catch(() => {
        if (active) setLoadError('無法讀取這個單字組。');
      });
    return () => {
      active = false;
    };
  }, [id, mode]);

  useEffect(() => {
    if (mode !== 'picture') return;
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
  }, [mode, saved?.id, saved?.updatedAt]);

  if (!mode) {
    return (
      <section className="stack">
        <h1>這個模式尚未開放</h1>
        <p>可以回到課次，改用字母填空或聽音拼字。</p>
        <Link className="button button-ghost" to={id ? `/sets/${id}` : '/'} data-testid="back-to-set">
          回到課次
        </Link>
      </section>
    );
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
        <Link className="button button-ghost" to="/">
          回到單字組
        </Link>
      </section>
    );
  }

  if (!saved || !id) {
    return <p>正在讀取課次。</p>;
  }

  if (mode === 'picture' && images === null) {
    return <p data-testid="picture-loading">正在讀取配圖。</p>;
  }

  const questions = questionsFor(saved.entries, mode, images ?? []);
  if (questions.length === 0) {
    if (mode === 'picture') return <PictureEmpty setId={id} />;
    return (
      <section className="stack">
        <h1>{MODE_TITLE[mode]}</h1>
        <p>這一組目前沒有可出的題。</p>
        <Link className="button button-ghost" to={`/sets/${id}`} data-testid="back-to-set">
          回到課次
        </Link>
      </section>
    );
  }

  return (
    <Round
      key={`${saved.id}:${mode}:${saved.updatedAt}`}
      setId={id}
      setName={saved.name}
      mode={mode}
      questions={questions}
      images={images ?? []}
    />
  );
}

function questionsFor(entries: WordEntry[], mode: PracticeMode, images: ImageAsset[]): Question[] {
  if (mode === 'picture') {
    return buildPictureRound(entries, images).map((question) => ({
      id: question.id,
      spelling: question.spelling,
      prompt: null,
      imageId: question.imageId,
      choices: question.choices,
    }));
  }
  const questions: Question[] = [];
  for (const entry of entries) {
    if (mode === 'cloze') {
      const prompt = buildBlankPrompt(entry.spelling);
      if (prompt) questions.push({ id: entry.id, spelling: entry.spelling, prompt });
    } else if (canAskListen(entry.spelling)) {
      questions.push({ id: entry.id, spelling: entry.spelling, prompt: null });
    }
  }
  return questions;
}

function PictureEmpty({ setId }: { setId: string }) {
  return (
    <section className="stack" data-testid="picture-unavailable">
      <h1>看圖選字</h1>
      <p>這一組還沒有可出的看圖題。</p>
      <p>
        在課次裡為要出的詞寫上詞義，再上傳配圖。抽象詞要再按「確認情境圖」。同組至少要有兩個拼寫不同的詞；如果這張圖也像另一個選項，那個選項會被拿掉。缺圖或選項不夠的詞，可以改用聽音拼字或字母填空。
      </p>
      <div className="practice-actions">
        <Link className="button button-primary" to={`/sets/${setId}`} data-testid="back-to-set">
          回到課次補圖
        </Link>
        <Link className="button button-ghost" to="/" data-testid="back-to-list">
          回到單字組
        </Link>
      </div>
    </section>
  );
}

function Round({
  setId,
  setName,
  mode,
  questions,
  images,
}: {
  setId: string;
  setName: string;
  mode: PracticeMode;
  questions: Question[];
  images: ImageAsset[];
}) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('answer');
  const [correctCount, setCorrectCount] = useState(0);
  const [lastCorrect, setLastCorrect] = useState(false);
  const [typed, setTyped] = useState<string[]>(() => emptyBlanks(questions[0]));
  const [given, setGiven] = useState('');
  const [voice, setVoice] = useState<EnglishVoice | null>(null);
  const phaseRef = useRef<Phase>('answer');
  const indexRef = useRef(0);
  const typedRef = useRef(typed);
  const givenRef = useRef(given);
  typedRef.current = typed;
  givenRef.current = given;

  useEffect(() => {
    if (mode !== 'listen') return;
    let active = true;
    loadEnglishVoice().then((result) => {
      if (active) setVoice(result);
    });
    return () => {
      active = false;
    };
  }, [mode]);

  function setPhaseNow(nextPhase: Phase) {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }

  function showQuestion(nextIndex: number) {
    const question = questions[nextIndex];
    const blanks = question ? emptyBlanks(question) : [];
    indexRef.current = nextIndex;
    typedRef.current = blanks;
    givenRef.current = '';
    setIndex(nextIndex);
    setTyped(blanks);
    setGiven('');
    setPhaseNow('answer');
  }

  function submit() {
    if (phaseRef.current !== 'answer') return;
    const question = questions[indexRef.current];
    const answer = mode === 'cloze' && question.prompt ? reconstructSpelling(question.prompt.slots, typedRef.current) : givenRef.current;
    const correct = mode === 'picture' ? answer === question.id : answersMatch(question.spelling, answer);
    setLastCorrect(correct);
    if (correct) setCorrectCount((count) => count + 1);
    setPhaseNow('feedback');
  }

  function next() {
    if (phaseRef.current !== 'feedback') return;
    if (indexRef.current + 1 >= questions.length) setPhaseNow('summary');
    else showQuestion(indexRef.current + 1);
  }

  function retry() {
    setCorrectCount(0);
    setLastCorrect(false);
    showQuestion(0);
  }

  const nextRef = useRef(next);
  nextRef.current = next;

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Enter' || event.defaultPrevented || phaseRef.current !== 'feedback') return;
      const tag = event.target instanceof Element ? event.target.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      event.preventDefault();
      nextRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (phase === 'summary') {
    return (
      <section className="stack" data-testid="round-summary">
        <p className="meta">{setName}</p>
        <h1>這一輪完成了</h1>
        <p data-testid="round-score">
          答對 {correctCount} / {questions.length}
        </p>
        <div className="practice-actions">
          <button type="button" className="button button-primary" data-testid="retry-round" onClick={retry}>
            再練一次
          </button>
          <Link className="button button-ghost" to={`/sets/${setId}`} data-testid="back-to-set">
            回到課次
          </Link>
        </div>
      </section>
    );
  }

  if (mode === 'listen' && !voice) {
    return (
      <section className="stack">
        <h1>{MODE_TITLE.listen}</h1>
        <p data-testid="voice-loading">正在確認這台裝置的英文語音…</p>
      </section>
    );
  }

  if (mode === 'listen' && voice && !voice.ok) {
    return (
      <section className="stack" data-testid="voice-missing">
        <h1>{MODE_TITLE.listen}</h1>
        <p className="banner banner-note" role="status">
          {voice.reason}
        </p>
        <Link className="button button-ghost" to={`/sets/${setId}`} data-testid="back-to-set">
          回到課次
        </Link>
      </section>
    );
  }

  const question = questions[index];

  return (
    <form
      className="stack-lg"
      data-testid="practice-round"
      data-phase={phase}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (phaseRef.current === 'answer') submit();
      }}
    >
      <div className="page-head">
        <Link className="text-link" to={`/sets/${setId}`} data-testid="back-to-set">
          回到課次
        </Link>
        <h1>{MODE_TITLE[mode]}</h1>
        <p className="meta">{setName}</p>
        <p className="progress" data-testid="question-progress">
          第 {index + 1} 題，共 {questions.length} 題
        </p>
      </div>

      {mode === 'listen' && voice?.ok ? (
        <ListenPrompt
          key={question.id}
          spelling={question.spelling}
          voice={voice.voice}
          active={phase === 'answer'}
          given={given}
          onEnter={submit}
          onGiven={(value) => {
            givenRef.current = value;
            setGiven(value);
          }}
        />
      ) : null}

      {mode === 'picture' && question.choices ? (
        <PictureChoices
          choices={question.choices}
          blob={images?.find((image) => image.id === question.imageId)?.blob}
          selected={given}
          active={phase === 'answer'}
          onSelect={(choiceId) => {
            givenRef.current = choiceId;
            setGiven(choiceId);
          }}
        />
      ) : null}

      {mode === 'cloze' && question.prompt ? (
        <BlankPromptView
          prompt={question.prompt}
          typed={typed}
          disabled={phase !== 'answer'}
          onTyped={(next) => {
            typedRef.current = next;
            setTyped(next);
          }}
          onSubmit={submit}
        />
      ) : null}

      {phase === 'feedback' ? (
        <div data-testid="feedback" data-result={lastCorrect ? 'right' : 'wrong'} role="status">
          <p className={lastCorrect ? 'banner banner-ok' : 'banner banner-error'}>{lastCorrect ? '答對了' : '還沒對'}</p>
          <p className="correct-line">
            正解：
            <span data-testid="correct-spelling" lang="en">
              {question.spelling}
            </span>
          </p>
        </div>
      ) : null}

      <div className="practice-actions">
        {phase === 'answer' ? (
          <button type="button" className="button button-primary" data-testid="submit-answer" onClick={submit}>
            送出答案
          </button>
        ) : (
          <button type="button" className="button button-primary" data-testid="next-question" onClick={next}>
            {index + 1 >= questions.length ? '看結果' : '下一題'}
          </button>
        )}
      </div>
    </form>
  );
}

function PictureChoices({
  choices,
  blob,
  selected,
  active,
  onSelect,
}: {
  choices: PictureChoice[];
  blob: Blob | undefined;
  selected: string;
  active: boolean;
  onSelect: (choiceId: string) => void;
}) {
  return (
    <div className="stack">
      {blob ? <PictureThumb blob={blob} testId="picture-prompt" large /> : null}
      <div className="choice-list" data-testid="picture-choices" role="group" aria-label="選出正確拼寫">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={selected === choice.id ? 'choice-button is-selected' : 'choice-button'}
            data-testid="picture-choice"
            data-spelling={choice.spelling}
            aria-pressed={selected === choice.id}
            disabled={!active}
            onClick={() => onSelect(choice.id)}
          >
            {choice.spelling}
          </button>
        ))}
      </div>
    </div>
  );
}

function emptyBlanks(question: Question | undefined): string[] {
  return Array.from({ length: question?.prompt?.blankCount ?? 0 }, () => '');
}

function BlankPromptView({
  prompt,
  typed,
  disabled,
  onTyped,
  onSubmit,
}: {
  prompt: BlankPrompt;
  typed: string[];
  disabled: boolean;
  onTyped: (next: string[]) => void;
  onSubmit: () => void;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const typedRef = useRef(typed);
  typedRef.current = typed;
  let blankIndex = 0;

  useEffect(() => {
    if (!disabled) refs.current[0]?.focus();
  }, [disabled, prompt.spelling]);

  function writeFrom(start: number, letters: string[]) {
    const next = typedRef.current.slice();
    let cursor = start;
    for (const letter of letters) {
      if (cursor >= next.length) break;
      next[cursor] = letter;
      cursor += 1;
    }
    typedRef.current = next;
    onTyped(next);
    const focusAt = Math.min(Math.max(cursor, start), next.length - 1);
    if (focusAt >= 0) refs.current[focusAt]?.focus();
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      onSubmit();
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      const current = typedRef.current.slice();
      if (current[index]) {
        current[index] = '';
        typedRef.current = current;
        onTyped(current);
        return;
      }
      if (index > 0) {
        current[index - 1] = '';
        typedRef.current = current;
        onTyped(current);
        refs.current[index - 1]?.focus();
      }
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
      return;
    }
    if (event.key === 'ArrowRight' && index < typed.length - 1) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
  }

  return (
    <div className="stack">
      <p className="hint">逐格填入缺少的字母。桌面也可以連續打字。</p>
      <div className="spell-row" lang="en" data-testid="blank-prompt" aria-label="填入缺少的字母">
        {prompt.slots.map((slot, slotIndex) => {
          if (slot.kind === 'sep') {
            return (
              <span key={slotIndex} className="spell-sep" data-testid="spell-slot" data-kind="sep" data-value={slot.value}>
                {slot.value === ' ' ? '\u00A0' : slot.value}
              </span>
            );
          }
          if (slot.kind === 'char') {
            return (
              <span key={slotIndex} className="spell-char" data-testid="spell-slot" data-kind="char" data-value={slot.value}>
                {slot.value}
              </span>
            );
          }
          const current = blankIndex;
          blankIndex += 1;
          return (
            <input
              key={slotIndex}
              ref={(node) => {
                refs.current[current] = node;
              }}
              className="spell-blank"
              data-testid="blank-input"
              data-kind="blank"
              type="text"
              inputMode="text"
              lang="en"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={1}
              aria-label={`第 ${current + 1} 個空格`}
              value={typed[current] ?? ''}
              disabled={disabled}
              onFocus={(event) => event.target.select()}
              onChange={(event) => {
                const letters = [...event.target.value].filter((character) => /[A-Za-z]/.test(character));
                if (letters.length === 0) {
                  const next = typed.slice();
                  next[current] = '';
                  onTyped(next);
                  return;
                }
                writeFrom(current, letters);
              }}
              onPaste={(event) => {
                const letters = [...event.clipboardData.getData('text')].filter((character) => /[A-Za-z]/.test(character));
                if (letters.length === 0) return;
                event.preventDefault();
                writeFrom(current, letters);
              }}
              onKeyDown={(event) => onKeyDown(current, event)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ListenPrompt({
  spelling,
  voice,
  active,
  given,
  onGiven,
  onEnter,
}: {
  spelling: string;
  voice: SpeechSynthesisVoice;
  active: boolean;
  given: string;
  onGiven: (value: string) => void;
  onEnter: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [spoken, setSpoken] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const playGen = useRef(0);

  async function play() {
    const generation = playGen.current + 1;
    playGen.current = generation;
    setPlayError(null);
    setPlaying(true);
    try {
      await speakText(spelling, voice);
      if (playGen.current === generation) setSpoken(true);
    } catch {
      if (playGen.current === generation) setPlayError('播放沒有成功，可以再試一次。');
    } finally {
      if (playGen.current === generation) setPlaying(false);
    }
  }

  return (
    <div className="stack" data-testid="listen-prompt">
      <button type="button" className="button button-primary" data-testid="play-word" onClick={() => void play()}>
        {playing ? '播放中…' : spoken ? '再聽一次' : '播放'}
      </button>
      {playError ? (
        <p className="banner banner-error" role="alert" data-testid="play-error">
          {playError}
        </p>
      ) : null}
      <label className="field">
        <span>寫出你聽到的詞</span>
        <input
          className="listen-answer"
          data-testid="listen-answer"
          type="text"
          lang="en"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={given}
          disabled={!active}
          onChange={(event) => onGiven(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !active) return;
            event.preventDefault();
            event.stopPropagation();
            onEnter();
          }}
        />
      </label>
      <p className="hint">空格和連字號要照原來的寫法保留。可以隨時再聽一次。</p>
    </div>
  );
}
