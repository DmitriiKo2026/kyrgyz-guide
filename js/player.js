/* Плеер: mp3 через <audio> (+ Media Session) и озвучка голосом iPhone (speechSynthesis) кусками. */
(function () {
  'use strict';
  const KG = window.KG;
  const hasTTS = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

  const audio = document.createElement('audio');
  audio.preload = 'none';
  audio.setAttribute('playsinline', '');
  audio.style.display = 'none';
  document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(audio); });
  if (document.body) document.body.appendChild(audio);

  const P = (KG.player = {
    state: 'idle',       // idle | loading | playing | paused
    track: null,         // { key, title, subtitle, cover, audio, text, intro }
    kind: null,          // 'audio' | 'tts'
    pos: 0, dur: 0,      // секунды (audio) либо номер/число кусков (tts)
    unlocked: false,
    hasTTS: hasTTS,
    ttsFallback: false
  });

  let seq = 0, uttToken = 0, silentUrl = '', segs = [], segIdx = 0, chunks = [], chunkIdx = 0, utt = null, loadTimer = null, startTimer = null, ttsErrors = 0;

  /* ---------- подготовка текста для голоса ---------- */
  P.cleanText = function (t) {
    return String(t || '').replace(/ /g, ' ')
      .replace(/\s*[—–]\s*/g, ', ').replace(/№\s*/g, 'номер ').replace(/(\d)\s*%/g, '$1 процентов')
      .replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim();
  };

  /* Резка на предложения до ~max знаков: на iOS длинные фразы обрываются. */
  P.chunk = function (text, max) {
    max = max || 170;
    const clean = P.cleanText(text);
    const sentences = clean.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [clean];
    const out = [];
    sentences.forEach(function (s) {
      s = s.trim();
      if (!s) return;
      if (s.length <= max) { out.push(s); return; }
      let cur = '';
      s.split(/(?<=[,;:])\s+/).forEach(function (part) {
        if ((cur + ' ' + part).trim().length <= max) { cur = (cur + ' ' + part).trim(); return; }
        if (cur) out.push(cur);
        cur = part;
        while (cur.length > max) {
          let cut = cur.lastIndexOf(' ', max);
          if (cut < 40) cut = max;
          out.push(cur.slice(0, cut).trim());
          cur = cur.slice(cut).trim();
        }
      });
      if (cur) out.push(cur);
    });
    return out;
  };

  /* ---------- голоса ---------- */
  P.voices = function () {
    if (!hasTTS) return [];
    return speechSynthesis.getVoices().filter(function (v) { return /^ru/i.test(v.lang.replace('_', '-')); });
  };
  function voiceScore(v) {
    let s = 0;
    const n = v.name + ' ' + v.voiceURI;
    if (/premium|премиум/i.test(n)) s += 30;
    if (/enhanced|улучшен|расшир/i.test(n)) s += 20;
    if (/milena|yuri|katya|юрий|милена|катя|dmitry|svetlana/i.test(n)) s += 8;
    if (v.localService) s += 2;
    return s;
  }
  P.pickVoice = function () {
    const vs = P.voices();
    if (!vs.length) return null;
    if (KG.settings.voice) {
      const m = vs.find(function (v) { return v.voiceURI === KG.settings.voice; });
      if (m) return m;
    }
    return vs.slice().sort(function (a, b) { return voiceScore(b) - voiceScore(a); })[0];
  };
  P.ttsAvailable = function () { return hasTTS && P.voices().length > 0; };
  if (hasTTS) { try { speechSynthesis.onvoiceschanged = function () { KG.emit('voices'); }; speechSynthesis.getVoices(); } catch (e) { /* ignore */ } }

  /* ---------- разблокировка звука первым касанием ---------- */
  function silentWav() {
    const n = 2400, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = function (o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 24000, true); v.setUint32(28, 48000, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  P.unlock = function () {
    if (P.unlocked) return;
    P.unlocked = true;
    try {
      if (P.state === 'idle') {
        silentUrl = silentWav();
        audio.src = silentUrl;
        const p = audio.play();
        if (p && p.then) p.then(function () { if (audio.currentSrc === silentUrl) audio.pause(); }).catch(function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
    try {
      if (hasTTS && P.state === 'idle') {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        speechSynthesis.speak(u);
      }
    } catch (e) { /* ignore */ }
    KG.emit('unlocked');
  };
  ['touchend', 'click'].forEach(function (ev) {
    document.addEventListener(ev, function once() { P.unlock(); document.removeEventListener(ev, once, true); }, true);
  });

  /* ---------- состояние ---------- */
  function setState(s) {
    P.state = s;
    if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : 'none'; } catch (e) { /* ignore */ } }
    KG.emit('player', s);
  }

  function clearTimers() { clearTimeout(loadTimer); clearTimeout(startTimer); loadTimer = startTimer = null; }

  function hardStop() {
    clearTimers();
    audio.onended = audio.onerror = audio.ontimeupdate = audio.onplaying = audio.onpause = audio.onloadedmetadata = audio.onwaiting = null;
    try { audio.pause(); } catch (e) { /* ignore */ }
    if (hasTTS) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    utt = null;
  }

  function setupMediaSession(track) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
      const art = track.cover ? [{ src: track.cover, sizes: '1024x768', type: 'image/jpeg' }] : [{ src: KG.abs('icons/icon-512.png'), sizes: '512x512', type: 'image/png' }];
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: 'Кыргызстан — аудиогид', album: track.subtitle || '', artwork: art });
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', function () { P.resume(); });
      ms.setActionHandler('pause', function () { P.pause(); });
      ms.setActionHandler('seekbackward', function () { P.seek(-15); });
      ms.setActionHandler('seekforward', function () { P.seek(15); });
      ms.setActionHandler('stop', function () { P.stop(); });
      try { ms.setActionHandler('seekto', function (d) { if (P.kind === 'audio' && d.seekTime != null) audio.currentTime = d.seekTime; }); } catch (e) { /* ignore */ }
    } catch (e) { KG.log('warn', 'mediaSession: ' + e.message); }
  }

  /* ---------- запуск ---------- */
  P.play = function (track) {
    hardStop();
    const my = ++seq;
    P.track = track; P.pos = 0; P.dur = 0; P.ttsFallback = false; ttsErrors = 0;
    segs = [];
    if (track.intro && P.ttsAvailable()) segs.push({ kind: 'tts', text: track.intro, intro: true });
    if (track.audio) segs.push({ kind: 'audio', url: track.audio });
    else segs.push({ kind: 'tts', text: track.text });
    segIdx = 0;
    setupMediaSession(track);
    setState('loading');
    runSeg(my);
    KG.emit('track', track);
  };

  function runSeg(my) {
    if (my !== seq) return;
    if (segIdx >= segs.length) return finish(my);
    const s = segs[segIdx];
    P.kind = s.kind;
    if (s.kind === 'audio') startAudio(s, my); else startTTS(s.text, my, s.intro);
  }

  function nextSeg(my) { if (my !== seq) return; segIdx++; runSeg(my); }

  function finish(my) {
    if (my !== seq) return;
    const t = P.track;
    clearTimers();
    P.pos = 0; P.dur = 0;
    setState('idle');
    KG.emit('player-end', t);
  }

  /* --- mp3 --- */
  function startAudio(s, my) {
    audio.onended = function () { nextSeg(my); };
    audio.onerror = function () { audioFailed(my, 'ошибка загрузки'); };
    audio.onplaying = function () { if (my !== seq) return; clearTimeout(loadTimer); setState('playing'); };
    audio.onpause = function () { if (my === seq && P.kind === 'audio' && !audio.ended && P.state === 'playing') setState('paused'); };
    audio.onwaiting = function () { /* буферизация: состояние не меняем */ };
    audio.onloadedmetadata = function () { P.dur = audio.duration || 0; KG.emit('player-time'); };
    audio.ontimeupdate = function () {
      P.pos = audio.currentTime; P.dur = audio.duration || P.dur;
      KG.emit('player-time');
      if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && isFinite(audio.duration) && audio.duration > 0) {
        try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate || 1 }); } catch (e) { /* ignore */ }
      }
    };
    audio.src = KG.abs(s.url);
    audio.playbackRate = KG.settings.speed;
    audio.defaultPlaybackRate = KG.settings.speed;
    const pr = audio.play();
    if (pr && pr.catch) pr.catch(function (e) {
      if (my !== seq) return;
      if (e && e.name === 'NotAllowedError') { KG.toast('Нажмите «Играть» — iPhone требует касания для запуска звука'); setState('paused'); } else audioFailed(my, e && e.message);
    });
    clearTimeout(loadTimer);
    loadTimer = setTimeout(function () { if (my === seq && P.state === 'loading') audioFailed(my, 'долгая загрузка'); }, 9000);
  }

  function audioFailed(my, why) {
    if (my !== seq || P.kind !== 'audio') return;
    KG.log('warn', 'mp3 недоступен (' + why + '), читаем голосом');
    clearTimers();
    audio.onended = audio.onerror = audio.ontimeupdate = audio.onplaying = audio.onpause = null;
    try { audio.pause(); } catch (e) { /* ignore */ }
    if (!P.ttsAvailable()) {
      KG.toast('Аудиофайл недоступен, а голос iPhone не найден. Скачайте пакет региона на Wi-Fi.', 6000);
      return finish(my);
    }
    P.ttsFallback = true;
    segs.splice(segIdx, 1, { kind: 'tts', text: P.track.text });
    KG.toast('Аудио не загрузилось — читаю голосом iPhone', 4000);
    runSeg(my);
  }

  /* --- голос --- */
  function startTTS(text, my, isIntro) {
    if (!P.ttsAvailable()) {
      if (isIntro) return nextSeg(my);
      KG.toast('На iPhone не найден русский голос: Настройки → Универсальный доступ → Устный контент → Голоса → Русский.', 7000);
      return finish(my);
    }
    chunks = P.chunk(text);
    chunkIdx = 0;
    P.dur = chunks.length; P.pos = 0;
    speakChunk(my);
  }

  function speakChunk(my) {
    if (my !== seq || P.kind !== 'tts') return;
    if (chunkIdx >= chunks.length) return nextSeg(my);
    try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    const token = ++uttToken;
    setTimeout(function () {
      if (my !== seq || token !== uttToken || P.kind !== 'tts') return;
      const u = new SpeechSynthesisUtterance(chunks[chunkIdx]);
      const v = P.pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ru-RU';
      u.rate = KG.settings.speed;
      u.volume = KG.settings.volume;
      let started = false;
      u.onstart = function () { started = true; clearTimeout(startTimer); if (my === seq && P.state !== 'paused') setState('playing'); };
      u.onend = function () {
        if (my !== seq || token !== uttToken || P.state === 'paused') return;
        chunkIdx++; P.pos = chunkIdx; KG.emit('player-time');
        speakChunk(my);
      };
      u.onerror = function (e) {
        if (my !== seq || token !== uttToken || (e && (e.error === 'canceled' || e.error === 'interrupted'))) return;
        ttsErrors++;
        KG.log('warn', 'tts error ' + (e && e.error));
        if (ttsErrors > 3) { KG.toast('Голос iPhone не отвечает. Попробуйте ещё раз.', 5000); return finish(my); }
        chunkIdx++; speakChunk(my);
      };
      utt = u; // ссылка нужна, иначе iOS/Safari может «потерять» onend
      speechSynthesis.speak(u);
      clearTimeout(startTimer);
      startTimer = setTimeout(function () {
        if (my === seq && !started && P.state !== 'paused') {
          ttsErrors++;
          if (ttsErrors > 2) { KG.toast('Голос не запустился. Нажмите «Играть» ещё раз.', 5000); setState('paused'); return; }
          speakChunk(my);
        }
      }, 4000);
    }, 70);
  }

  /* ---------- управление ---------- */
  P.pause = function () {
    if (P.state !== 'playing' && P.state !== 'loading') return;
    clearTimers();
    if (P.kind === 'audio') { try { audio.pause(); } catch (e) { /* ignore */ } } else if (hasTTS) { uttToken++; try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    setState('paused');
  };
  P.resume = function () {
    if (P.state !== 'paused') return;
    if (P.kind === 'audio') {
      const pr = audio.play();
      if (pr && pr.catch) pr.catch(function () { KG.toast('Не удалось продолжить воспроизведение'); });
      setState('playing');
    } else { setState('loading'); speakChunk(seq); }
  };
  P.toggle = function () {
    if (P.state === 'playing' || P.state === 'loading') P.pause(); else if (P.state === 'paused') P.resume();
  };
  P.stop = function () {
    ++seq; hardStop();
    const t = P.track;
    P.pos = 0; P.dur = 0;
    setState('idle');
    KG.emit('player-stop', t);
  };
  P.seek = function (delta) {
    if (P.state === 'idle') return;
    if (P.kind === 'audio') {
      const d = audio.duration || Infinity;
      audio.currentTime = Math.max(0, Math.min(d - 0.5, audio.currentTime + delta));
    } else {
      chunkIdx = Math.max(0, Math.min(chunks.length - 1, chunkIdx + (delta > 0 ? 1 : -1)));
      P.pos = chunkIdx; KG.emit('player-time');
      if (P.state === 'playing') speakChunk(seq);
    }
  };
  P.seekTo = function (frac) {
    if (P.state === 'idle') return;
    if (P.kind === 'audio' && isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(1, frac)) * audio.duration;
    else if (P.kind === 'tts') {
      chunkIdx = Math.max(0, Math.min(chunks.length - 1, Math.floor(frac * chunks.length)));
      P.pos = chunkIdx; KG.emit('player-time');
      if (P.state === 'playing') speakChunk(seq);
    }
  };
  P.applySettings = function () {
    audio.playbackRate = KG.settings.speed;
    audio.defaultPlaybackRate = KG.settings.speed;
    if (P.kind === 'tts' && P.state === 'playing') speakChunk(seq);
  };
  P.isActive = function () { return P.state !== 'idle'; };
  P.isPlaying = function () { return P.state === 'playing' || P.state === 'loading'; };
  P.progress = function () { return P.dur > 0 ? Math.min(1, P.pos / P.dur) : 0; };

  KG.on('settings', function (k) { if (k === 'speed') P.applySettings(); });
})();
