export type EnglishVoice =
  | { ok: true; voice: SpeechSynthesisVoice }
  | { ok: false; reason: string };

const MISSING_BROWSER = '這個瀏覽器沒有語音功能，所以沒辦法聽音拼字。可以回到課次，改用字母填空。';
const MISSING_ENGLISH = '這台裝置的語音清單裡沒有英文，所以沒辦法聽音拼字。可以回到課次，改用字母填空。';

export function pickEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'));
  if (english.length === 0) return null;
  return (
    english.find((voice) => voice.default) ??
    english.find((voice) => voice.lang.toLowerCase() === 'en-us') ??
    english[0]
  );
}

export function loadEnglishVoice(timeoutMs = 1500): Promise<EnglishVoice> {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve({ ok: false, reason: MISSING_BROWSER });

  const fromList = (voices: SpeechSynthesisVoice[]): EnglishVoice => {
    const voice = pickEnglishVoice(voices);
    if (voice) return { ok: true, voice };
    return { ok: false, reason: MISSING_ENGLISH };
  };

  const current = synth.getVoices();
  if (current.length > 0) return Promise.resolve(fromList(current));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      synth.removeEventListener('voiceschanged', onChange);
      resolve(fromList(voices));
    };
    const onChange = () => {
      const voices = synth.getVoices();
      if (voices.length > 0) finish(voices);
    };
    synth.addEventListener('voiceschanged', onChange);
    window.setTimeout(() => finish(synth.getVoices()), timeoutMs);
  });
}

export function speakText(text: string, voice: SpeechSynthesisVoice): Promise<void> {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.reject(new Error('no-speech'));

  return new Promise((resolve, reject) => {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    try {
      utterance.voice = voice;
    } catch {
      // Some stand-ins for a voice are not accepted by the browser object.
    }
    utterance.lang = voice.lang || 'en-US';
    utterance.rate = 0.92;
    let settled = false;
    const close = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };
    utterance.onend = () => close(resolve);
    utterance.onerror = (event) => {
      const reason = 'error' in event ? String(event.error) : '';
      if (reason === 'interrupted' || reason === 'canceled') close(resolve);
      else close(() => reject(new Error(reason || 'playback')));
    };
    synth.speak(utterance);
  });
}
