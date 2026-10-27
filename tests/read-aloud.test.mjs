import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/voice-harness.mjs';

function playback(text = 'First paragraph.\nSecond paragraph.') {
  const h = harness(), instance = h.instance();
  h.content.current.querySelector('[data-read-aloud-text]').textContent = text;
  const render = () => h.render(instance, () => h.output.ReadAloud({ contentRef: h.content }));
  const click = () => render().props.children[0].props.onClick();
  return { h, instance, render, click, label: () => render().props.children[0].props['aria-label'],
    notice: () => render().props.children[1].props.children };
}

test('chunks respect paragraphs, sentence boundaries and the hard bound without punctuation', () => {
  const { text } = harness();
  assert.deepEqual(Array.from(text.speechChunks('One.\nTwo.')), ['One.', 'Two.']);
  const sentences = 'A sentence. '.repeat(60).trim();
  const chunks = Array.from(text.speechChunks(sentences));
  assert.ok(chunks.every(c => c.length <= text.MAX_SPEECH_CHARS && c.endsWith('.')));
  assert.equal(chunks.join(' '), sentences);
  for (const input of ['x'.repeat(1500), '🙂'.repeat(500), 'words without punctuation '.repeat(80).trim()]) {
    const pieces = Array.from(text.speechChunks(input));
    assert.ok(pieces.length > 1);
    assert.ok(pieces.every(c => c.length > 0 && c.length <= text.MAX_SPEECH_CHARS));
    assert.equal(pieces.join('').replace(/\s/g, ''), input.replace(/\s/g, ''));
    assert.ok(pieces.every(c => !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c)));
  }
});

test('only one chunk is submitted; duplicate/stale chunk callbacks cannot advance playback', () => {
  const p = playback(); p.click();
  const first = p.h.utterances[0], oldEnd = first.onend, oldError = first.onerror;
  assert.equal(p.h.utterances.length, 1);
  first.onend(); oldEnd(); oldError();
  assert.equal(p.h.utterances.length, 1);
  p.h.advance(120);
  assert.equal(p.h.utterances.length, 2);
  oldEnd(); oldError(); p.h.advance(120);
  assert.equal(p.h.utterances.length, 2);
  p.h.utterances[1].onend();
  assert.equal(p.label(), 'Read aloud');
  assert.equal(p.h.timers.size, 0);
});

test('Stop during the inter-chunk gap and unmount both cancel future chunks', () => {
  for (const unmount of [false, true]) {
    const p = playback(); p.click(); p.h.utterances[0].onend();
    if (unmount) p.h.cleanup(p.instance); else p.click();
    p.h.advance(60_000);
    assert.equal(p.h.utterances.length, 1);
    assert.equal(p.h.timers.size, 0);
    assert.equal(p.h.cancellations(), 2);
  }
});

test('a missing completion event times out, releases ownership and permits retry', () => {
  const p = playback(); p.click();
  const oldEnd = p.h.utterances[0].onend;
  p.h.advance(p.h.text.SPEECH_TIMEOUT_MS);
  assert.equal(p.label(), 'Read aloud');
  assert.match(p.notice(), /timed out/);
  assert.equal(p.h.timers.size, 0);
  p.click(); oldEnd();
  assert.equal(p.label(), 'Stop reading aloud');
  assert.equal(p.h.utterances.length, 2);
});

test('errors and thrown speak calls release ownership without advancing the reply', () => {
  const p = playback(); p.click(); p.h.utterances[0].onerror();
  assert.equal(p.label(), 'Read aloud'); assert.match(p.notice(), /Couldn't read/);
  p.h.advance(60_000); assert.equal(p.h.utterances.length, 1);
  p.h.throwOnSpeak(); p.click();
  assert.equal(p.label(), 'Read aloud'); assert.equal(p.h.timers.size, 0);
});

test('read-aloud stays en-US regardless of browser or recognition language, without language UI', () => {
  const p = playback();
  p.h.context.navigator.language = 'tr-TR';
  assert.equal(p.render().props.children.length, 2);
  assert.equal(p.render().props.children[0].props['aria-pressed'], undefined);
  p.click();
  assert.equal(p.h.utterances[0].lang, 'en-US');
  assert.equal(p.h.utterances[0].voice, p.h.voices[0]);
  assert.equal(p.notice(), '');
});

test('empty/code-only content and unsupported APIs do not activate playback', () => {
  const p = playback(''); p.click();
  assert.match(p.notice(), /No text/); assert.equal(p.h.utterances.length, 0);
  delete p.h.context.window.speechSynthesis; p.click();
  assert.match(p.notice(), /not supported/); assert.equal(p.label(), 'Read aloud');
});

test('pin voice identity across chunks even if another matching voice moves to the front', () => {
  const p = playback(); p.click();
  const selected = p.h.utterances[0].voice;
  p.h.voices.unshift({ name: 'Other', voiceURI: 'Other', lang: 'en-US' });
  p.h.utterances[0].onend(); p.h.advance(120);
  assert.equal(p.h.utterances[1].voice, selected);
  assert.equal(p.h.utterances[1].lang, selected.lang);
});

test('an English voice is pinned across chunks even if the available list later changes', () => {
  const p = playback(); p.click();
  const selected = p.h.utterances[0].voice;
  p.h.voices.splice(0, 1, { name: 'Turkish', voiceURI: 'Turkish', lang: 'tr-TR' });
  p.h.utterances[0].onend(); p.h.advance(120);
  assert.equal(p.h.utterances[1].voice, selected);
  assert.equal(p.h.utterances[1].lang, 'en-US');
});

test('prefer US English, then another English voice; never select a non-English voice', () => {
  const p = playback();
  const british = { name: 'Daniel', voiceURI: 'Daniel', lang: 'en-GB' };
  const nonEnglish = { name: 'Other', voiceURI: 'Other', lang: 'tr-TR', default: true };
  const american = p.h.voices[0];
  p.h.voices.unshift(nonEnglish, british);
  p.click(); assert.equal(p.h.utterances[0].voice, american); p.click();
  p.h.voices.splice(p.h.voices.indexOf(american), 1);
  p.click();
  assert.equal(p.h.utterances[1].voice, british);
  assert.equal(p.h.utterances[1].lang, 'en-US');
});

test('empty or non-English voice lists use the browser with en-US, consistently across chunks', () => {
  for (const voices of [[], [{ name: 'Yelda', voiceURI: 'Yelda', lang: 'tr-TR' }]]) {
    const p = playback(); p.h.voices.splice(0, p.h.voices.length, ...voices); p.click();
    assert.equal(p.h.utterances[0].voice, null);
    assert.equal(p.h.utterances[0].lang, 'en-US');
    p.h.voices.push({ name: 'New English', voiceURI: 'new', lang: 'en-US' });
    p.h.utterances[0].onend(); p.h.advance(120);
    assert.equal(p.h.utterances[1].voice, null);
    assert.equal(p.h.utterances[1].lang, 'en-US');
  }
});

test('unavailable voice enumeration falls back to en-US without blocking playback', () => {
  const p = playback(); p.h.synth.getVoices = () => { throw Error('unavailable'); }; p.click();
  assert.equal(p.h.utterances[0].voice, null);
  assert.equal(p.h.utterances[0].lang, 'en-US');
  assert.equal(p.label(), 'Stop reading aloud');
});
