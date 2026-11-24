// 文章なおし：打った文を Gemini に直してもらい、LINE へ渡す
// 鍵はこの端末の localStorage にだけ置く（外へは Gemini に送るときのヘッダーだけ）

const KEY_STORE = 'naoshi_api_key';
const DRAFT_STORE = 'naoshi_draft';
const MODEL_STORE = 'naoshi_model'; // 空なら gemini-flash-latest（いつも新しい flash を指す名前）

// どの直し方でも守ってほしいこと
const SYSTEM = `あなたは、LINEで送る文を直す係です。
決まり：
- 返すのは、直した文だけ。前置き・説明・いくつもの案・かぎかっこで囲むことはしない
- 日時・数字・名前・場所・約束の中身は変えない。元の文に無い事実を足さない
- LINEで送る文として自然な長さと改行にする`;

// ボタンごとの頼み方と、ぶれの大きさ（temperature）
const MODES = {
  funny: { text: '面白く：読んだ人がクスッと笑える言い回しにする。ふざけすぎず、相手に失礼にならない程度。ちょっとしたたとえや言葉遊びを1つ入れてよい', temperature: 1.0 },
  polite: { text: 'ていねい：目上の人や取引先に送れる言い方にする。かたすぎる敬語や二重敬語は使わない', temperature: 0.7 },
  soft: { text: 'やわらかく：断る・頼む・注意するときでも角が立たない、やさしい言い方にする。相手への気づかいを一言入れてよい', temperature: 0.8 },
  short: { text: '短く：言いたいことだけを残して、できるだけ短くする', temperature: 0.5 },
  typo: { text: '誤字だけ：誤字・脱字・変換ミス・声の入力の聞き間違いだけを直す。言い回し・語尾・長さは変えない。直す所が無ければ、元の文をそのまま返す', temperature: 0.2 },
};

const source = document.querySelector('#source_text');
const result = document.querySelector('#result_text');
const status = document.querySelector('.result_status');
const modeButtons = document.querySelectorAll('.mode_item');
const setting = document.querySelector('.setting');
const keyInput = document.querySelector('#api_key');

let lastMode = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('is_error', isError);
}

function setBusy(busy) {
  document.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
}

// Gemini が「」や "" で囲んで返したときだけ外す
function unwrap(text) {
  const t = text.trim();
  const pairs = [['「', '」'], ['『', '』'], ['"', '"'], ['“', '”']];
  for (const [open, close] of pairs) {
    if (t.startsWith(open) && t.endsWith(close) && t.length > 2) return t.slice(1, -1).trim();
  }
  return t;
}

async function askGemini(key, prompt, temperature) {
  const model = localStorage.getItem(MODEL_STORE) || 'gemini-flash-latest';
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, // 鍵は URL に入れない
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          thinkingConfig: { thinkingBudget: 0 }, // 考える時間を切る（オンだと待ちが長くなる）
        },
      }),
    });
  } catch {
    throw new Error('ネットにつながりません。電波を確かめてください');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || '';
    if (/API key/i.test(msg) || res.status === 401 || res.status === 403) throw new Error('鍵が正しくないようです。下の設定を見てください');
    if (res.status === 429) throw new Error('使える回数を超えました。少し待ってから、もう一度押してください');
    throw new Error(`Gemini がエラーを返しました（${res.status}）${msg ? '：' + msg.slice(0, 80) : ''}`);
  }

  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text.trim()) throw new Error('Gemini から文が返ってきませんでした。言い方を変えて、もう一度押してください');
  return unwrap(text);
}

async function rewrite(mode, again = false) {
  const text = source.value.trim();
  if (!text) {
    setStatus('先に「送りたい文」を打ってください', true);
    source.focus();
    return;
  }
  const key = localStorage.getItem(KEY_STORE);
  if (!key) {
    setting.open = true;
    setStatus('先に、下の設定で Gemini の鍵を入れてください', true);
    return;
  }

  lastMode = mode;
  modeButtons.forEach((b) => b.classList.toggle('is_active', b.dataset.mode === mode));
  source.blur(); // スマホのキーボードを閉じて、結果を見やすくする

  let prompt = `【直し方】${MODES[mode].text}\n【元の文】\n${text}`;
  if (again && result.value.trim()) {
    prompt += `\n【前に出した案（これとは違う言い回しにする）】\n${result.value.trim()}`;
  }

  setBusy(true);
  setStatus('Gemini に頼んでいます…');
  try {
    result.value = await askGemini(key, prompt, MODES[mode].temperature);
    setStatus('できました。手で少し直してから送ることもできます');
    result.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    setBusy(false);
  }
}

// 送る文：直した文があればそれ、無ければ元の文
function textToSend() {
  return result.value.trim() || source.value.trim();
}

modeButtons.forEach((b) => b.addEventListener('click', () => rewrite(b.dataset.mode)));

document.querySelector('.result_retry').addEventListener('click', () => {
  if (!lastMode) {
    setStatus('先に、直し方のボタンを押してください', true);
    return;
  }
  rewrite(lastMode, true);
});

// LINE が用意している入口。開くと、送る相手を選ぶ画面になる
document.querySelector('.result_send').addEventListener('click', () => {
  const text = textToSend();
  if (!text) {
    setStatus('送る文がありません', true);
    return;
  }
  location.href = 'https://line.me/R/share?text=' + encodeURIComponent(text);
});

document.querySelector('.result_copy').addEventListener('click', async () => {
  const text = textToSend();
  if (!text) {
    setStatus('コピーする文がありません', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus('コピーしました');
  } catch {
    setStatus('コピーできませんでした。文を長押ししてコピーしてください', true);
  }
});

document.querySelector('.writer_clear').addEventListener('click', () => {
  source.value = '';
  result.value = '';
  localStorage.removeItem(DRAFT_STORE);
  modeButtons.forEach((b) => b.classList.remove('is_active'));
  lastMode = null;
  setStatus('');
  source.focus();
});

// 打ちかけの文を残す（ほかのアプリを見て戻っても消えない）
source.addEventListener('input', () => localStorage.setItem(DRAFT_STORE, source.value));

// 設定：鍵を保存
document.querySelector('.setting_save').addEventListener('click', () => {
  const v = keyInput.value.trim();
  if (!v) {
    setStatus('鍵が空です', true);
    return;
  }
  localStorage.setItem(KEY_STORE, v);
  keyInput.value = '';
  keyInput.placeholder = '保存済み（変えるときだけ入れる）';
  setting.open = false;
  setStatus('鍵を保存しました');
});

// 起動したとき
(function start() {
  // ほかのアプリの「共有」から来たときは、その文を入れる（URL の文はすぐ消す）
  const params = new URLSearchParams(location.search);
  const shared = [params.get('title'), params.get('text'), params.get('url')]
    .filter(Boolean)
    .filter((v, i, list) => !list.some((other, j) => j !== i && other.includes(v) && other !== v));
  if (shared.length) {
    source.value = [...new Set(shared)].join('\n');
    localStorage.setItem(DRAFT_STORE, source.value);
    history.replaceState(null, '', location.pathname);
  } else {
    source.value = localStorage.getItem(DRAFT_STORE) || '';
  }

  if (localStorage.getItem(KEY_STORE)) {
    keyInput.placeholder = '保存済み（変えるときだけ入れる）';
  } else {
    setting.open = true;
  }

  // ホーム画面に置くための仕組み。PC で試すとき（localhost）は、古い画面が残らないよう使わない
  if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    navigator.serviceWorker.register('sw.js');
  }
})();
