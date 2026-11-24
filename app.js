// 文章なおし：打った文を Gemini に直してもらい、LINE へ渡す
// 鍵はこの端末の localStorage にだけ置く（外へは Gemini に送るときのヘッダーだけ）

// 直して公開するたびに1つ上げる。画面の右上に出る
const VERSION = 'ver.9（11月25日）';

const KEY_STORE = 'naoshi_api_key';
const DRAFT_STORE = 'naoshi_draft'; // ver.3 まで打ちかけの文を残していた所。今は起動のたびに消すだけ
const MODEL_STORE = 'naoshi_model'; // 空なら gemini-flash-latest（いつも新しい flash を指す名前）

// どの直し方でも守ってほしいこと
// 直しすぎない（2026-11-25「加工しすぎ」「変えすぎは、おれじゃないみたい」）。書いた人の文のまま、要る所だけ変える
// 「！」と絵文字は足してよい（同じ日「！とか絵文字はいいんだけど」）
const SYSTEM = `あなたは、LINEで送る文を、書いた人の代わりに少しだけ直す係です。
決まり：
- 返すのは、直した文だけ。前置き・説明・いくつもの案・かぎかっこで囲むことはしない
- 書いた人の言いたいこと・口調・語尾のくせを残す。別人やキャラクターが書いたような文にしない
- 元の文の言葉は、できるだけそのまま使う。言い換えるのは、直し方に要る所だけ
- 話している物（天気・仕事・ごはんなど）を、別の物にたとえたり、別の言葉に置きかえたりしない
- 元の文で言っていること（お願い・断り・予定・気持ち）は、1つも落とさない
- 元の文に無い文（あいさつ・おわび・気づかいの一言・しめの言葉）を足さない
- 「！」や絵文字は、合う所に少し足してよい（言葉そのものは変えすぎない）
- 日時・数字・名前・場所・約束の中身は変えない。元の文に無い事実を足さない
- 長さは元の文と同じくらい。改行も元の文に合わせる`;

// ボタンごとの頼み方と、ぶれの大きさ（temperature）
const MODES = {
  // 2026-11-25「今日天気いいね」→「今日の太陽、やる気出しすぎじゃない？」になり、変わりすぎと言われた。語尾と！・絵文字でノリを出す
  funny: { text: '面白く：元の文の言葉は、ほぼそのまま使う。変えるのは語尾か1語だけで、ノリのいい言い方にする。「！」や絵文字を足してよい。たとえ話・ネタ・言いかえはしない', temperature: 0.5 },
  polite: { text: 'ていねい：敬語に直すだけ。目上の人に送れる、ふつうのです・ます調にする。かたすぎる敬語や二重敬語は使わない。絵文字は足さない', temperature: 0.3 },
  soft: { text: 'やわらかく：言い切り・命令・断りの所の言い方だけを、角が立たない形に変える。ほかの所はそのまま', temperature: 0.4 },
  short: { text: '短く：言いたいことだけを残して短くする。口調は変えない', temperature: 0.3 },
  typo: { text: '誤字だけ：誤字・脱字・変換ミス・声の入力の聞き間違いだけを直す。言い回し・語尾・長さは変えない。直す所が無ければ、元の文をそのまま返す', temperature: 0.1 },
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

async function askGemini(key, prompt, temperature, system = SYSTEM) {
  const model = localStorage.getItem(MODEL_STORE) || 'gemini-flash-latest';
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, // 鍵は URL に入れない
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
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
  if (tidying) await tidying; // 声の文に改行を入れている途中なら、入れ終わるのを待つ
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

// 打った文・直した文を消して、まっさらにする
function clearAll() {
  if (voiceOn) stopVoice(); // 聞いたままだと、消した文が次の聞き取りで戻ってくる
  tidyOnEnd = false;
  source.value = '';
  result.value = '';
  modeButtons.forEach((b) => b.classList.remove('is_active'));
  lastMode = null;
  setStatus('');
}

document.querySelector('.writer_clear').addEventListener('click', () => {
  clearAll();
  source.focus();
});

// 開き直したら、まっさらにする
// スマホはアプリを閉じても裏で動き続けるので、「画面から外れていた時間」で見分ける
// 1分より短いとき（ほかのアプリを少し見て戻った）は消さない
const CLEAR_AFTER = 60 * 1000;
let hiddenAt = 0;

// 入力欄にカーソルを当て、スマホのキーボードも出す（ver.9〜・ユーザー「起動した瞬間、入力ボックスが当たってる状況にできない？」）
// スマホの Chrome は、指で触らずに focus() しただけでは、キーボードを出さない
// navigator.virtualKeyboard.show() なら出せる。ただし、そのページを一度でも触ったあと（hasBeenActive）だけ
// → アプリを裏から開き直したときは出る。完全に閉じてから開いたときは、まだ触っていないので出ない（ブラウザの決まり）
function focusSource() {
  const vk = navigator.virtualKeyboard;
  if (!vk || !(navigator.userActivation && navigator.userActivation.hasBeenActive)) {
    source.focus();
    return;
  }
  source.setAttribute('virtualkeyboardpolicy', 'manual'); // show() は、この印があるときだけ効く
  source.blur();
  source.focus();
  vk.show();
  // 印を残すと、キーボードを閉じたあと指で触っても出なくなるので、すぐ外す
  setTimeout(() => source.removeAttribute('virtualkeyboardpolicy'), 500);
}

function clearIfReopened() {
  if (hiddenAt && Date.now() - hiddenAt >= CLEAR_AFTER) {
    clearAll();
    focusSource(); // すぐ打てるように（キーボードも出す）
    checkNewVersion();
  }
}

// 開き直したとき、新しい版が公開されていたら読み込み直す（ver.6〜）
// 裏で動き続けているページは読み込み直されないので、送っても前の版のままになる。だから自分で確かめる
// 1.5秒待つのは、「共有」で文が届いて画面が切り替わる途中に、読み込み直しで邪魔しないため
function checkNewVersion() {
  setTimeout(async () => {
    try {
      const code = await (await fetch('app.js', { cache: 'no-cache' })).text();
      const latest = (code.match(/const VERSION = '([^']*)'/) || [])[1];
      if (!latest || latest === VERSION) return;
      if (source.value) setStatus('新しい版があります。次に開いたときに入れ替わります');
      else location.reload();
    } catch (_) {
      // 電波が無いときは、今の版のまま使う
    }
  }, 1500);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
  } else {
    clearIfReopened();
  }
});

// 声で入力（Chrome の音声認識）。押すと聞き始め、もう一度押すまで聞き続ける（ver.7〜）
// Chrome は少し黙ると聞くのをやめる。ver.6 までは、そこで止まり、考えて止まった所で文が切れた
// だから押している間は、切れるたびにすぐ聞き直す
// 止まるのは：もう一度押したとき・20秒何も聞き取れなかったとき（押し忘れ）・ほかのアプリに移ったとき・「消す」を押したとき
const voiceButton = document.querySelector('.writer_voice');
const VOICE_LABEL = '🎤 声で入力';
const VOICE_IDLE = 20 * 1000;
let recognition = null; // いま動いている聞き取り（1回ぶん）
let voiceOn = false; // 押して聞いている最中か
let voiceHeard = false; // 押してから1文字でも聞き取れたか
let lastHeardAt = 0; // 最後に聞き取れた時刻（押した時刻から数え始める）
let voiceBefore = ''; // 押す前に入っていた文（改行を入れるのは、そのあとの声の所だけ）
let tidyOnEnd = false; // 押して止めたとき、最後の文字が届いてから改行を入れる

// 声で入れた文に、話の区切りで改行を入れる（ver.8〜・ユーザー「直し方のボタンを押さなくても」）
// 声の文は、改行も句読点も無い1行で届く。話が終わるまで区切りは決められないので、止めたあとに1回だけ頼む
const TIDY_SYSTEM = `あなたは、声で入力した文に改行を入れる係です。
決まり：
- 改行を入れるだけ。言葉・字・句読点は1文字も変えない・足さない・消さない
- 改行は、1つの話が終わって次の話に移る所に入れる（LINE で読みやすい区切り）
- 1つの話しかない短い文には、改行を入れない
- 返すのは、改行を入れた文だけ`;
const TIDY_MIN = 15; // これより短い声の文は頼まない（改行が要らず、待つだけになるため）
let tidying = null; // 改行を入れている途中の頼みごと（直し方のボタンは、これを待ってから頼む）

function tidyVoice(before, doneMessage = '') {
  const key = localStorage.getItem(KEY_STORE);
  const now = source.value;
  if (!key || !now.startsWith(before)) return setStatus(doneMessage);
  const head = now.slice(before.length).match(/^\s*/)[0]; // 押すたびにはさんだ改行は、そのまま残す
  const part = now.slice(before.length + head.length);
  if (part.replace(/\s/g, '').length < TIDY_MIN) return setStatus(doneMessage);
  setStatus('✍ 話の区切りで改行しています…');
  const job = (async () => {
    let message = doneMessage;
    try {
      const tidied = (await askGemini(key, part, 0, TIDY_SYSTEM)).trim();
      const plain = (s) => s.replace(/\s/g, '');
      // 言葉まで変わっていたら使わない。待つ間に手で直していたら、上書きしない
      if (plain(tidied) === plain(part) && source.value === now) source.value = before + head + tidied;
    } catch (e) {
      message = '改行は入れられませんでした：' + e.message;
    }
    if (tidying === job) tidying = null;
    if (status.textContent.startsWith('✍')) setStatus(message);
  })();
  tidying = job;
}

// 聞き取りを1回ぶん始める。Chrome が切ったら onend で、もう一度ここを呼ぶ
function listen() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Recognition();
  rec.lang = 'ja-JP';
  rec.interimResults = true; // 話している途中の文も、その場で出す
  const base = source.value; // それまでの文のあとに足す
  // 🎤 を押すたびに、新しい行から始める（ver.9〜・ユーザー「声で入力のたびに改行されない」）
  // まだ何も聞き取れていない聞き取りだけ、前の文が改行で終わっていなければ、改行を1つはさむ
  const lead = base === voiceBefore && base && !base.endsWith('\n') ? '\n' : '';

  rec.onresult = (e) => {
    if (rec !== recognition) return; // 捨てた聞き取りの、遅れて届いた結果
    voiceHeard = true;
    lastHeardAt = Date.now();
    source.value = base + lead + Array.from(e.results).map((r) => r[0].transcript).join('');
  };
  rec.onerror = (e) => {
    // aborted＝自分で止めた／no-speech＝黙っていた（onend で聞き直す）
    if (rec !== recognition || e.error === 'aborted' || e.error === 'no-speech') return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopVoice('マイクが使えません。Chrome の設定で、このページのマイクを許可してください', true);
    else if (e.error === 'network') stopVoice('ネットにつながりません。電波を確かめてください', true);
    else if (e.error === 'audio-capture') stopVoice('マイクが見つかりません。ほかのアプリがマイクを使っていないか確かめてください', true);
    else stopVoice(`声の入力が止まりました（${e.error}）`, true);
  };
  rec.onend = () => {
    if (rec !== recognition) return;
    recognition = null;
    if (!voiceOn) {
      if (tidyOnEnd) {
        tidyOnEnd = false;
        tidyVoice(voiceBefore);
      }
      return;
    }
    if (Date.now() - lastHeardAt >= VOICE_IDLE) {
      if (voiceHeard) {
        stopVoice();
        tidyVoice(voiceBefore, '20秒話さなかったので、声の入力を止めました');
      } else stopVoice('声が聞き取れませんでした。もう一度押してください', true);
      return;
    }
    try {
      listen(); // 聞き直す
    } catch (err) {
      stopVoice('声の入力が止まりました：' + err.message, true);
    }
  };

  recognition = rec;
  rec.start();
}

// 聞くのをやめて、ボタンを元に戻す。話している途中の文は、stop() で最後まで文字にしてから止まる
function stopVoice(message = '', isError = false) {
  voiceOn = false;
  if (recognition) recognition.stop();
  voiceButton.classList.remove('is_active');
  voiceButton.textContent = VOICE_LABEL;
  setStatus(message, isError);
}

voiceButton.addEventListener('click', () => {
  if (voiceOn) {
    const running = !!recognition;
    stopVoice();
    if (running) tidyOnEnd = voiceHeard; // 最後の文字が届く onend のあとで改行を入れる
    else if (voiceHeard) tidyVoice(voiceBefore);
    return;
  }
  if (recognition) recognition.abort(); // 前の聞き取りが、まだ止まりきっていなければ捨てる
  recognition = null;
  voiceOn = true;
  voiceHeard = false;
  tidyOnEnd = false;
  voiceBefore = source.value;
  lastHeardAt = Date.now();
  voiceButton.classList.add('is_active');
  voiceButton.textContent = '聞いています…（押すと止まる）';
  // 何も起きないように見えないよう、聞いていることと止まった理由を、いつも画面に出す（ver.6〜）
  setStatus('🎤 聞いています。話し終わったら、もう一度押してください');
  try {
    listen();
  } catch (err) {
    stopVoice('声の入力を始められませんでした：' + err.message, true);
  }
});

// ほかのアプリに移ったら止める（マイクを動かしっぱなしにしない）
document.addEventListener('visibilitychange', () => {
  if (document.hidden && voiceOn) stopVoice();
});

// 「LINEで送る」でページを離れ、戻るボタンで戻ってきたとき
window.addEventListener('pageshow', (e) => {
  if (e.persisted) clearIfReopened();
});

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
  document.querySelector('.header_version').textContent = VERSION;

  // ほかのアプリの「共有」から来たときは、その文を入れる（URL の文はすぐ消す）
  const params = new URLSearchParams(location.search);
  const shared = [params.get('title'), params.get('text'), params.get('url')]
    .filter(Boolean)
    .filter((v, i, list) => !list.some((other, j) => j !== i && other.includes(v) && other !== v));
  localStorage.removeItem(DRAFT_STORE); // 前の版で残した打ちかけの文は使わない
  if (shared.length) {
    source.value = [...new Set(shared)].join('\n');
    history.replaceState(null, '', location.pathname);
  } else {
    // すぐ打てるように、入力欄にカーソルを当てる（共有で文が来たときは、直し方のボタンが隠れないよう当てない）
    focusSource();
  }

  // 声で入力：この端末の Chrome が音声認識を使えるときだけ出す
  voiceButton.hidden = !(window.SpeechRecognition || window.webkitSpeechRecognition);

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
