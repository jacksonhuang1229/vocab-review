import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = 'http://127.0.0.1:5173';
const shots = process.env.VERIFY_SHOTS ?? '/opt/cursor/artifacts';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-practice-profile-'));

const practiceSet = {
  id: 'practice-check',
  name: 'Practice Check',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  entries: [
    { id: 'e-a', spelling: 'a' },
    { id: 'e-go', spelling: 'go' },
    { id: 'e-ice', spelling: 'ice cream' },
    { id: 'e-well', spelling: 'well-known' },
  ],
};

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  userDataDir,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-first-run',
    '--no-first-run',
    '--disable-default-browser-check',
    '--window-size=1280,900',
  ],
});

function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  return page.screenshot({ path: path.join(shots, name), fullPage: true });
}

async function readSets(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('english-vocab-review');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction('wordSets', 'readonly').objectStore('wordSets').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        };
      }),
  );
}

async function seed(page) {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (set) => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('english-vocab-review');
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('wordSets')) {
          open.result.createObjectStore('wordSets', { keyPath: 'id' });
        }
        if (!open.result.objectStoreNames.contains('images')) {
          open.result.createObjectStore('images', { keyPath: 'id' });
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('wordSets', 'readwrite');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.objectStore('wordSets').put(set);
      };
    });
  }, practiceSet);
}

async function slots(page) {
  return page.$$eval('[data-testid="spell-slot"], [data-testid="blank-input"]', (nodes) =>
    nodes.map((node) => ({
      kind: node.getAttribute('data-kind'),
      value: node.getAttribute('data-value'),
    })),
  );
}

async function blankValues(page) {
  return page.$$eval('[data-testid="blank-input"]', (nodes) => nodes.map((node) => node.value));
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}`);
}

async function assertTap(page, selector) {
  const box = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width, text: element.textContent ?? '' };
  });
  assert.ok(box.height >= 44, `${selector} height ${box.height}`);
  assert.ok(box.width >= 44, `${selector} width ${box.width} (${box.text})`);
  return box;
}

async function installSpeech(page, mode) {
  await page.evaluateOnNewDocument((speechMode) => {
    const synth = window.speechSynthesis;
    const voices =
      speechMode === 'missing'
        ? [{ name: 'Chinese', lang: 'zh-TW', default: true, localService: true, voiceURI: 'zh-TW' }]
        : [{ name: 'English US', lang: 'en-US', default: true, localService: true, voiceURI: 'en-US' }];
    window.__spoken = [];
    window.__failRemaining = speechMode === 'fail-once' ? 1 : 0;
    const speak = (utterance) => {
      window.__spoken.push({ text: utterance.text, lang: utterance.lang });
      const fail = window.__failRemaining > 0;
      if (fail) window.__failRemaining -= 1;
      window.setTimeout(() => {
        if (fail) utterance.onerror?.({ error: 'audio-busy' });
        else utterance.onend?.();
      }, 30);
    };
    const getVoices = () => voices;
    const cancel = () => {};
    for (const [name, value] of [
      ['getVoices', getVoices],
      ['speak', speak],
      ['cancel', cancel],
    ]) {
      try {
        Object.defineProperty(synth, name, { configurable: true, writable: true, value });
      } catch {
        synth[name] = value;
      }
    }
    window.__speechInstalled = speechMode;
  }, mode);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await seed(page);

  await page.goto(`${base}/sets/practice-check`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="practice-modes"]');
  assert.equal(await page.$eval('[data-testid="mode-cloze"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 3 個詞');
  assert.equal(await page.$eval('[data-testid="mode-listen"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 4 個詞');
  assert.match(await page.$eval('[data-testid="cloze-skipped"]', (node) => node.textContent ?? ''), /單一字母/);
  assert.equal(await page.$eval('[data-testid="mode-picture"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 0 個詞');
  assert.ok(await page.$('[data-testid="start-picture"]'));
  const storedBefore = JSON.stringify(await readSets(page));

  await page.focus('[data-testid="entry-spelling"]');
  await page.keyboard.type('zzz');
  await page.waitForSelector('[data-testid="practice-uses-saved"]');
  assert.equal(await page.$eval('[data-testid="mode-cloze"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 3 個詞');
  assert.equal(await page.$eval('[data-testid="mode-listen"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 4 個詞');

  await page.click('[data-testid="start-cloze"]');
  await page.waitForSelector('[data-testid="blank-prompt"]');
  assert.match(page.url(), /\/practice\/cloze$/);
  assert.equal(await page.$eval('[data-testid="question-progress"]', (node) => node.textContent), '第 1 題，共 3 題');
  assert.deepEqual(await slots(page), [
    { kind: 'char', value: 'g' },
    { kind: 'blank', value: null },
  ]);
  await page.click('[data-testid="blank-input"]');
  await page.keyboard.type('o');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="feedback"][data-result="right"]');
  assert.equal(await page.$eval('[data-testid="correct-spelling"]', (node) => node.textContent), 'go');
  await page.click('[data-testid="next-question"]');

  await page.waitForFunction(() => document.querySelector('[data-testid="question-progress"]')?.textContent?.includes('第 2 題'));
  assert.deepEqual(await slots(page), [
    { kind: 'char', value: 'i' },
    { kind: 'char', value: 'c' },
    { kind: 'blank', value: null },
    { kind: 'sep', value: ' ' },
    { kind: 'char', value: 'c' },
    { kind: 'char', value: 'r' },
    { kind: 'blank', value: null },
    { kind: 'blank', value: null },
    { kind: 'char', value: 'm' },
  ]);
  await page.click('[data-testid="blank-input"]');
  await page.keyboard.type('x');
  await page.click('[data-testid="submit-answer"]');
  await page.waitForSelector('[data-testid="feedback"][data-result="wrong"]');
  assert.match(await page.$eval('[data-testid="feedback"]', (node) => node.textContent ?? ''), /還沒對/);
  assert.equal(await page.$eval('[data-testid="correct-spelling"]', (node) => node.textContent), 'ice cream');
  await assertNoHorizontalOverflow(page);
  await shot(page, 'practice_cloze_feedback.png');
  await page.click('[data-testid="next-question"]');

  await page.waitForFunction(() => document.querySelector('[data-testid="question-progress"]')?.textContent?.includes('第 3 題'));
  assert.deepEqual(await slots(page), [
    { kind: 'char', value: 'w' },
    { kind: 'char', value: 'e' },
    { kind: 'blank', value: null },
    { kind: 'char', value: 'l' },
    { kind: 'sep', value: '-' },
    { kind: 'char', value: 'k' },
    { kind: 'char', value: 'n' },
    { kind: 'blank', value: null },
    { kind: 'blank', value: null },
    { kind: 'char', value: 'n' },
  ]);
  await page.click('[data-testid="blank-input"]');
  await page.keyboard.type('low');
  assert.deepEqual(await blankValues(page), ['l', 'o', 'w']);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="feedback"][data-result="right"]');
  assert.equal(await page.$eval('[data-testid="correct-spelling"]', (node) => node.textContent), 'well-known');
  await page.click('[data-testid="next-question"]');

  await page.waitForSelector('[data-testid="round-summary"]');
  assert.equal(await page.$eval('[data-testid="round-score"]', (node) => node.textContent?.replace(/\s+/g, ' ').trim()), '答對 2 / 3');
  await page.click('[data-testid="retry-round"]');
  await page.waitForSelector('[data-testid="blank-prompt"]');
  assert.equal(await page.$eval('[data-testid="question-progress"]', (node) => node.textContent), '第 1 題，共 3 題');
  assert.deepEqual(await blankValues(page), ['']);
  await page.click('[data-testid="back-to-set"]');
  await page.waitForSelector('[data-testid="detail-name"]');
  assert.equal(page.url(), `${base}/sets/practice-check`);
  assert.equal(JSON.stringify(await readSets(page)), storedBefore);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.click('[data-testid="start-cloze"]');
  await page.waitForSelector('[data-testid="submit-answer"]');
  await assertTap(page, '[data-testid="blank-input"]');
  await assertTap(page, '[data-testid="submit-answer"]');
  await assertNoHorizontalOverflow(page);
  await shot(page, 'practice_cloze_phone.png');

  const listen = await browser.newPage();
  await installSpeech(listen, 'english');
  await listen.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await listen.goto(`${base}/sets/practice-check/practice/listen`, { waitUntil: 'domcontentloaded' });
  await listen.waitForSelector('[data-testid="play-word"]');
  assert.equal(await listen.evaluate(() => window.__speechInstalled), 'english');
  await listen.click('[data-testid="play-word"]');
  await listen.waitForFunction(() => window.__spoken.length === 1);
  assert.deepEqual(await listen.evaluate(() => window.__spoken.map((item) => item.text)), ['a']);
  assert.match(await listen.evaluate(() => window.__spoken[0].lang), /^en/i);
  await listen.waitForFunction(() => document.querySelector('[data-testid="play-word"]')?.textContent?.includes('再聽一次'));
  await listen.click('[data-testid="play-word"]');
  await listen.waitForFunction(() => window.__spoken.length === 2);
  assert.deepEqual(await listen.evaluate(() => window.__spoken.map((item) => item.text)), ['a', 'a']);

  async function answerListen(text, result, spelling) {
    await listen.click('[data-testid="listen-answer"]', { clickCount: 3 });
    await listen.keyboard.type(text);
    await listen.keyboard.press('Enter');
    await listen.waitForSelector(`[data-testid="feedback"][data-result="${result}"]`);
    assert.equal(await listen.$eval('[data-testid="correct-spelling"]', (node) => node.textContent), spelling);
  }

  await answerListen('A', 'right', 'a');
  await listen.click('[data-testid="next-question"]');
  await listen.waitForFunction(() => document.querySelector('[data-testid="question-progress"]')?.textContent?.includes('第 2 題'));
  await listen.click('[data-testid="play-word"]');
  await listen.waitForFunction(() => window.__spoken.at(-1)?.text === 'go');
  await answerListen(' GO ', 'right', 'go');
  await listen.click('[data-testid="next-question"]');
  await listen.waitForFunction(() => document.querySelector('[data-testid="question-progress"]')?.textContent?.includes('第 3 題'));
  await answerListen('Ice  Cream', 'right', 'ice cream');
  await listen.click('[data-testid="next-question"]');
  await listen.waitForFunction(() => document.querySelector('[data-testid="question-progress"]')?.textContent?.includes('第 4 題'));
  await answerListen('well known', 'wrong', 'well-known');
  await listen.click('[data-testid="next-question"]');
  await listen.waitForSelector('[data-testid="round-summary"]');
  assert.equal(await listen.$eval('[data-testid="round-score"]', (node) => node.textContent?.replace(/\s+/g, ' ').trim()), '答對 3 / 4');
  await listen.click('[data-testid="retry-round"]');
  await listen.waitForSelector('[data-testid="play-word"]');
  await answerListen('a', 'right', 'a');
  await listen.click('[data-testid="next-question"]');
  await answerListen('go', 'right', 'go');
  await listen.click('[data-testid="next-question"]');
  await answerListen('ice cream', 'right', 'ice cream');
  await listen.click('[data-testid="next-question"]');
  await answerListen('Well-Known', 'right', 'well-known');

  await listen.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await listen.click('[data-testid="back-to-set"]');
  await listen.waitForSelector('[data-testid="start-listen"]');
  await listen.click('[data-testid="start-listen"]');
  await listen.waitForSelector('[data-testid="play-word"]');
  const playBox = await assertTap(listen, '[data-testid="play-word"]');
  const answerBox = await assertTap(listen, '[data-testid="submit-answer"]');
  assert.match(playBox.text, /播放/);
  assert.match(answerBox.text, /送出答案/);
  await assertNoHorizontalOverflow(listen);
  await shot(listen, 'practice_listen_phone.png');
  await listen.click('[data-testid="submit-answer"]');
  await listen.waitForSelector('[data-testid="next-question"]');
  const nextBox = await assertTap(listen, '[data-testid="next-question"]');
  assert.match(nextBox.text, /下一題/);
  await assertTap(listen, '[data-testid="play-word"]');
  await shot(listen, 'practice_listen_phone_next.png');

  const failing = await browser.newPage();
  await installSpeech(failing, 'fail-once');
  await failing.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await failing.goto(`${base}/sets/practice-check/practice/listen`, { waitUntil: 'domcontentloaded' });
  await failing.waitForSelector('[data-testid="play-word"]');
  await failing.click('[data-testid="play-word"]');
  await failing.waitForSelector('[data-testid="play-error"]');
  assert.match(await failing.$eval('[data-testid="play-error"]', (node) => node.textContent ?? ''), /再試一次/);
  assert.ok(await failing.$('[data-testid="play-word"]'));
  await failing.click('[data-testid="play-word"]');
  await failing.waitForFunction(() => !document.querySelector('[data-testid="play-error"]'));
  await failing.waitForFunction(() => document.querySelector('[data-testid="play-word"]')?.textContent?.includes('再聽一次'));
  assert.deepEqual(await failing.evaluate(() => window.__spoken.map((item) => item.text)), ['a', 'a']);

  const missing = await browser.newPage();
  await installSpeech(missing, 'missing');
  await missing.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await missing.goto(`${base}/sets/practice-check/practice/listen`, { waitUntil: 'domcontentloaded' });
  await missing.waitForSelector('[data-testid="voice-missing"]');
  const missingText = await missing.$eval('[data-testid="voice-missing"]', (node) => node.textContent ?? '');
  assert.match(missingText, /沒有英文/);
  assert.equal(await missing.$('[data-testid="listen-answer"]'), null);
  assert.equal(await missing.$('[data-testid="play-word"]'), null);
  await shot(missing, 'practice_voice_missing.png');
  await missing.click('[data-testid="back-to-set"]');
  await missing.waitForSelector('[data-testid="start-cloze"]');
  assert.equal(missing.url(), `${base}/sets/practice-check`);

  const real = await browser.newPage();
  await real.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await real.goto(`${base}/sets/practice-check/practice/listen`, { waitUntil: 'domcontentloaded' });
  await real.waitForFunction(
    () => document.querySelector('[data-testid="voice-missing"]') || document.querySelector('[data-testid="play-word"]'),
    { timeout: 4000 },
  );
  const realOutcome = (await real.$('[data-testid="voice-missing"]')) ? 'missing' : 'ready';
  if (realOutcome === 'missing') {
    assert.match(await real.$eval('[data-testid="voice-missing"]', (node) => node.textContent ?? ''), /沒有英文|沒有語音/);
  }
  console.log(`device speech path: ${realOutcome}`);
  assert.equal(JSON.stringify(await readSets(real)), storedBefore);
  console.log('step 3 verification passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser.connected) await browser.close();
}
