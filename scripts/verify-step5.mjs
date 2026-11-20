import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const base = 'http://127.0.0.1:5173';
const shots = process.env.VERIFY_SHOTS ?? '/opt/cursor/artifacts';
const fixtures = path.join(process.cwd(), 'public', 'fixtures');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-flow-profile-'));
const listPath = path.join(os.tmpdir(), 'vocab-flow-check.txt');
const pngPath = path.join(os.tmpdir(), 'vocab-flow-apple.png');
fs.writeFileSync(listPath, 'go\nice cream\nwell-known\napple\nbanana\n');
fs.writeFileSync(
  pngPath,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const words = ['go', 'ice cream', 'well-known', 'apple', 'banana'];
const photoWords = ['apple', 'bridge', 'castle', 'donkey', 'engine', 'forest', 'ice cream', 'well-known'];

function browserOnDisk(names) {
  return names.some((name) => {
    try {
      execFileSync('bash', ['-lc', `command -v ${name}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
}

const installed = {
  chrome: browserOnDisk(['google-chrome', 'google-chrome-stable']),
  edge: browserOnDisk(['microsoft-edge', 'microsoft-edge-stable']),
  firefox: browserOnDisk(['firefox', 'firefox-esr']),
  safari: browserOnDisk(['safari']),
};

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  userDataDir,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-first-run', '--no-first-run', '--disable-default-browser-check', '--window-size=1280,900'],
});

const report = {
  installed,
  chrome: await browser.version(),
  desktop: {},
  phone: {},
};

function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  return page.screenshot({ path: path.join(shots, name), fullPage: true });
}

async function installSpeech(page, mode) {
  await page.evaluateOnNewDocument((speechMode) => {
    const synth = window.speechSynthesis;
    const voices =
      speechMode === 'missing'
        ? [{ name: 'Chinese', lang: 'zh-TW', default: true, localService: true, voiceURI: 'zh-TW' }]
        : [{ name: 'English US', lang: 'en-US', default: true, localService: true, voiceURI: 'en-US' }];
    window.__spoken = [];
    const speak = (utterance) => {
      window.__spoken.push({ text: utterance.text, lang: utterance.lang });
      window.setTimeout(() => utterance.onend?.(), 30);
    };
    for (const [name, value] of [
      ['getVoices', () => voices],
      ['speak', speak],
      ['cancel', () => {}],
    ]) {
      try {
        Object.defineProperty(synth, name, { configurable: true, writable: true, value });
      } catch {
        synth[name] = value;
      }
    }
  }, mode);
}

async function overflow(page) {
  const amount = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(amount <= 1, `horizontal overflow ${amount} at ${page.url()}`);
  return amount;
}

async function tapSize(page, selector) {
  const box = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width, text: (element.textContent ?? '').trim() };
  });
  assert.ok(box.height >= 44, `${selector} height ${box.height}`);
  assert.ok(box.width >= 44, `${selector} width ${box.width} (${box.text})`);
  return box;
}

async function spellings(page) {
  return page.$$eval('[data-testid="entry-spelling"]', (nodes) => nodes.map((node) => node.value));
}

async function slots(page) {
  return page.$$eval('[data-testid="spell-slot"], [data-testid="blank-input"]', (nodes) =>
    nodes.map((node) => ({ kind: node.getAttribute('data-kind'), value: node.getAttribute('data-value') })),
  );
}

function missingLetters(spelling, promptSlots) {
  const letters = [...spelling].filter((character) => /[A-Za-z]/.test(character));
  let index = 0;
  let missing = '';
  for (const slot of promptSlots) {
    if (slot.kind === 'sep') continue;
    const letter = letters[index];
    index += 1;
    if (slot.kind === 'blank') missing += letter;
  }
  assert.equal(index, letters.length, `slots do not match ${spelling}: ${JSON.stringify(promptSlots)}`);
  assert.ok(missing.length > 0, `no blank in ${spelling}`);
  return missing;
}

async function typeInto(page, selector, text) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.type(text);
}

async function meaningOf(page, spelling) {
  return page.$eval(`[data-testid="entry-picture"][data-spelling="${spelling}"]`, (node) => {
    const input = node.closest('.entry-main')?.querySelector('[data-testid="entry-meaning"]');
    return input instanceof HTMLInputElement ? input.value : '';
  });
}

async function setMeaning(page, spelling, value) {
  const handle = await page.evaluateHandle((word) => {
    const node = document.querySelector(`[data-testid="entry-picture"][data-spelling="${word}"]`);
    return node?.closest('.entry-main')?.querySelector('[data-testid="entry-meaning"]') ?? null;
  }, spelling);
  const element = handle.asElement();
  assert.ok(element, `meaning field for ${spelling}`);
  await element.click({ clickCount: 3 });
  await page.keyboard.type(value);
  await page.waitForFunction(
    (word, expected) => {
      const node = document.querySelector(`[data-testid="entry-picture"][data-spelling="${word}"]`);
      const input = node?.closest('.entry-main')?.querySelector('[data-testid="entry-meaning"]');
      return input instanceof HTMLInputElement && input.value === expected;
    },
    {},
    spelling,
    value,
  );
}

async function answerCloze(page, spelling, submitWith) {
  await page.waitForSelector('[data-testid="blank-prompt"]');
  const missing = missingLetters(spelling, await slots(page));
  await page.click('[data-testid="blank-input"]');
  await page.keyboard.type(missing, { delay: 30 });
  if (submitWith === 'enter') {
    await page.keyboard.press('Enter');
  } else {
    await page.tap('[data-testid="submit-answer"]');
  }
  await page.waitForSelector('[data-testid="feedback"][data-result="right"]');
  const shown = await page.$eval('[data-testid="correct-spelling"]', (node) => node.textContent ?? '');
  assert.equal(shown, spelling);
  const advanced = await page.$eval('[data-testid="question-progress"]', (node) => node.textContent ?? '');
  return { missing, advanced };
}

async function finishRound(page) {
  const progress = await page.$eval('[data-testid="question-progress"]', (node) => node.textContent ?? '');
  const match = progress.match(/第 (\d+) 題，共 (\d+) 題/);
  assert.ok(match, progress);
  const index = Number(match[1]);
  const total = Number(match[2]);
  await page.click('[data-testid="next-question"]');
  if (index >= total) {
    await page.waitForSelector('[data-testid="round-summary"]');
    return page.$eval('[data-testid="round-score"]', (node) => node.textContent ?? '');
  }
  await page.waitForFunction(
    (next) => document.querySelector('[data-testid="question-progress"]')?.textContent?.includes(`第 ${next} 題`),
    {},
    index + 1,
  );
  return null;
}

const pageErrors = [];
const page = await browser.newPage();
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

try {
  await page.goto(`${base}/import`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="file-input"]');
  await typeInto(page, '[data-testid="set-name"]', 'Flow Check');
  const fileInput = await page.$('[data-testid="file-input"]');
  await fileInput.uploadFile(listPath);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="entry-spelling"]').length === 5);
  assert.deepEqual(await spellings(page), words);
  assert.match(await page.$eval('[data-testid="file-status"]', (node) => node.textContent ?? ''), /vocab-flow-check\.txt/);
  await shot(page, 'flow_desktop_import.png');
  await page.click('[data-testid="confirm-save"]');
  await page.waitForSelector('[data-testid="detail-name"]');
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="picture-upload"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  const detailUrl = page.url();

  await setMeaning(page, 'apple', '蘋果');
  await setMeaning(page, 'banana', '香蕉');
  const pictureInput = await page.waitForSelector('[data-testid="entry-picture"][data-spelling="apple"] [data-testid="picture-file"]');
  await pictureInput.uploadFile(pngPath);
  await page.waitForSelector('[data-testid="entry-picture"][data-spelling="apple"][data-state="ready"] [data-testid="picture-preview"]');
  await page.click('[data-testid="detail-save"]');
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="detail-save"]');
    return button instanceof HTMLButtonElement && button.disabled && document.querySelector('[data-testid="save-notice"]');
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="detail-name"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="entry-picture"][data-spelling="apple"][data-state="ready"]'));
  assert.equal(await page.$eval('[data-testid="detail-name"]', (node) => node.value), 'Flow Check');
  assert.deepEqual(await spellings(page), words);
  assert.equal(await meaningOf(page, 'apple'), '蘋果');
  assert.equal(await meaningOf(page, 'banana'), '香蕉');
  assert.equal(await page.$eval('[data-testid="mode-cloze"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 5 個詞');
  assert.equal(await page.$eval('[data-testid="mode-listen"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 5 個詞');
  assert.equal(await page.$eval('[data-testid="mode-picture"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 1 個詞');
  await shot(page, 'flow_desktop_after_reload.png');

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="set-card"][data-set-name="Flow Check"]');
  await page.click('[data-testid="set-card"][data-set-name="Flow Check"]');
  await page.waitForSelector('[data-testid="start-cloze"]');
  assert.equal(page.url(), detailUrl);

  await page.click('[data-testid="start-cloze"]');
  await page.waitForSelector('[data-testid="blank-prompt"]');
  const clozeProgress = [];
  for (let index = 0; index < words.length; index += 1) {
    const before = await page.$eval('[data-testid="question-progress"]', (node) => node.textContent ?? '');
    assert.equal(before, `第 ${index + 1} 題，共 ${words.length} 題`);
    const result = await answerCloze(page, words[index], 'enter');
    assert.equal(result.advanced, before, 'Enter submitted and stayed on the same question');
    if (index === 0) await shot(page, 'flow_desktop_cloze_feedback.png');
    const score = await finishRound(page);
    clozeProgress.push({ word: words[index], missing: result.missing, score });
  }
  assert.match(clozeProgress.at(-1).score, /答對 5 \/ 5/);
  await page.click('[data-testid="back-to-set"]');
  await page.waitForSelector('[data-testid="start-listen"]');

  await page.click('[data-testid="start-listen"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="voice-missing"]') || document.querySelector('[data-testid="play-word"]'),
  );
  const realListen = (await page.$('[data-testid="voice-missing"]')) ? 'missing' : 'ready';
  const realVoices = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const collect = () => speechSynthesis.getVoices().map((voice) => ({ name: voice.name, lang: voice.lang }));
        const current = collect();
        if (current.length > 0) {
          resolve(current);
          return;
        }
        const finish = () => resolve(collect());
        speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
        window.setTimeout(finish, 2000);
      }),
  );
  report.desktop.realVoices = realVoices;
  report.desktop.realListen = realListen;
  if (realListen === 'missing') {
    const text = await page.$eval('[data-testid="voice-missing"]', (node) => node.textContent ?? '');
    assert.match(text, /沒有英文|沒有語音/);
    assert.equal(await page.$('[data-testid="listen-answer"]'), null);
    await shot(page, 'flow_desktop_listen_missing.png');
    await page.click('[data-testid="back-to-set"]');
    await page.waitForSelector('[data-testid="start-picture"]');
  }

  const listen = await browser.newPage();
  listen.on('pageerror', (error) => pageErrors.push(String(error)));
  await installSpeech(listen, 'english');
  await listen.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await listen.goto(detailUrl.replace(/\/?$/, '') + '/practice/listen', { waitUntil: 'domcontentloaded' });
  await listen.waitForSelector('[data-testid="play-word"]');
  const listenAnswers = [' GO ', 'Ice  Cream', 'Well-Known', 'apple', 'banana'];
  let spokenCount = 0;
  for (let index = 0; index < words.length; index += 1) {
    await listen.click('[data-testid="play-word"]');
    spokenCount += 1;
    await listen.waitForFunction((count) => window.__spoken.length === count, {}, spokenCount);
    const spoken = await listen.evaluate((item) => window.__spoken[item], spokenCount - 1);
    assert.equal(spoken.text, words[index]);
    assert.match(spoken.lang, /^en/i);
    await listen.click('[data-testid="play-word"]');
    spokenCount += 1;
    await listen.waitForFunction((count) => window.__spoken.length === count, {}, spokenCount);
    await listen.click('[data-testid="listen-answer"]');
    await listen.keyboard.type(listenAnswers[index]);
    await listen.keyboard.press('Enter');
    await listen.waitForSelector('[data-testid="feedback"][data-result="right"]');
    const stayed = await listen.$eval('[data-testid="question-progress"]', (node) => node.textContent ?? '');
    assert.equal(stayed, `第 ${index + 1} 題，共 ${words.length} 題`);
    if (index === 1) await shot(listen, 'flow_desktop_listen_feedback.png');
    const score = await finishRound(listen);
    if (score) report.desktop.listenScore = score.replace(/\s+/g, ' ');
  }
  assert.match(report.desktop.listenScore, /答對 5 \/ 5/);
  await listen.close();

  await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="start-picture"]');
  await page.click('[data-testid="start-picture"]');
  await page.waitForSelector('[data-testid="picture-choice"]');
  const choices = await page.$$eval('[data-testid="picture-choice"]', (nodes) => nodes.map((node) => node.getAttribute('data-spelling')));
  assert.ok(choices.includes('apple'));
  assert.ok(choices.length >= 2 && choices.length <= 4);
  assert.equal(new Set(choices).size, choices.length);
  await page.click('[data-testid="picture-choice"][data-spelling="apple"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="picture-choice"][data-spelling="apple"]')?.getAttribute('aria-pressed') === 'true');
  await page.focus('[data-testid="submit-answer"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="feedback"][data-result="right"]');
  await shot(page, 'flow_desktop_picture_feedback.png');
  await page.click('[data-testid="next-question"]');
  await page.waitForSelector('[data-testid="round-summary"]');
  assert.match(await page.$eval('[data-testid="round-score"]', (node) => node.textContent ?? ''), /答對 1 \/ 1/);
  await page.click('[data-testid="back-to-set"]');
  await page.waitForSelector('[data-testid="detail-name"]');
  report.desktop.cloze = clozeProgress.map((item) => item.word);
  report.desktop.pictureChoices = choices;
  await overflow(page);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${base}/import`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="camera-input"]');
  assert.equal(await page.$eval('[data-testid="camera-input"]', (node) => node.getAttribute('capture')), 'environment');
  const cameraBox = await tapSize(page, '[data-testid="camera-button"]');
  const albumBox = await tapSize(page, '[data-testid="album-button"]');
  const camera = await page.$('[data-testid="camera-input"]');
  await camera.uploadFile(path.join(fixtures, 'printed-column.png'));
  await page.waitForFunction(
    () => document.querySelector('[data-testid="file-status"]')?.textContent?.includes('已辨識 printed-column.png'),
    { timeout: 120000 },
  );
  assert.deepEqual(await spellings(page), photoWords);
  await page.focus('[data-testid="entry-spelling"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('apples');
  await page.waitForFunction(() => document.querySelector('[data-testid="entry-spelling"]')?.value === 'apples');
  await typeInto(page, '[data-testid="set-name"]', 'Photo Lesson');
  await overflow(page);
  await shot(page, 'flow_phone_camera_preview.png');
  await page.tap('[data-testid="confirm-save"]');
  await page.waitForSelector('[data-testid="detail-name"]');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="detail-name"]');
  assert.equal(await page.$eval('[data-testid="detail-name"]', (node) => node.value), 'Photo Lesson');
  assert.equal((await spellings(page))[0], 'apples');
  assert.ok((await spellings(page)).includes('ice cream'));
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="set-card"][data-set-name="Photo Lesson"]');
  await page.waitForSelector('[data-testid="set-card"][data-set-name="Flow Check"]');

  const phoneListen = await browser.newPage();
  phoneListen.on('pageerror', (error) => pageErrors.push(String(error)));
  await installSpeech(phoneListen, 'english');
  await phoneListen.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phoneListen.goto(`${detailUrl}/practice/listen`, { waitUntil: 'domcontentloaded' });
  await phoneListen.waitForSelector('[data-testid="play-word"]');
  const playBox = await tapSize(phoneListen, '[data-testid="play-word"]');
  await phoneListen.tap('[data-testid="play-word"]');
  await phoneListen.waitForFunction(() => window.__spoken.length === 1);
  assert.equal(await phoneListen.evaluate(() => window.__spoken[0].text), 'go');
  await phoneListen.tap('[data-testid="listen-answer"]');
  await phoneListen.keyboard.type('go');
  await tapSize(phoneListen, '[data-testid="submit-answer"]');
  await phoneListen.tap('[data-testid="submit-answer"]');
  await phoneListen.waitForSelector('[data-testid="feedback"][data-result="right"]');
  await overflow(phoneListen);
  await shot(phoneListen, 'flow_phone_listen.png');
  await phoneListen.close();

  await page.goto(`${detailUrl}/practice/cloze`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="blank-input"]');
  await tapSize(page, '[data-testid="blank-input"]');
  await tapSize(page, '[data-testid="submit-answer"]');
  const phoneCloze = await answerCloze(page, 'go', 'tap');
  assert.equal(phoneCloze.missing, 'o');
  await overflow(page);

  await page.goto(`${detailUrl}/practice/picture`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="picture-choice"]');
  const phoneChoices = await page.$$eval('[data-testid="picture-choice"]', (nodes) => nodes.map((node) => node.getAttribute('data-spelling')));
  for (const choice of await page.$$('[data-testid="picture-choice"]')) {
    const box = await choice.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    });
    assert.ok(box.height >= 44 && box.width >= 120, `choice ${box.width}x${box.height}`);
  }
  await tapSize(page, '[data-testid="submit-answer"]');
  await page.tap('[data-testid="picture-choice"][data-spelling="apple"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="picture-choice"][data-spelling="apple"]')?.getAttribute('aria-pressed') === 'true');
  await page.tap('[data-testid="submit-answer"]');
  await page.waitForSelector('[data-testid="feedback"][data-result="right"]');
  await overflow(page);
  await shot(page, 'flow_phone_picture.png');
  await page.tap('[data-testid="next-question"]');
  await page.waitForSelector('[data-testid="round-summary"]');
  await tapSize(page, '[data-testid="retry-round"]');
  await tapSize(page, '[data-testid="back-to-set"]');
  await page.tap('[data-testid="back-to-set"]');
  await page.waitForSelector('[data-testid="detail-name"]');

  report.phone = { cameraBox, albumBox, playBox, phoneChoices, photoKept: true };
  report.pageErrors = pageErrors;
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify(report, null, 2));
  console.log('step 5 flow passed');
} catch (error) {
  const failed = path.join(os.tmpdir(), 'flow-step5-failed.png');
  await page.screenshot({ path: failed, fullPage: true }).catch(() => {});
  console.error(`failure screenshot ${failed}`);
  console.error(pageErrors);
  throw error;
} finally {
  await browser.close();
}
