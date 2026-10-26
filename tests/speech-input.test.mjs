// Run with: node --test tests/speech-input.test.mjs
// Exercise the hook using installed TypeScript and Node, without adding a DOM/test dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync('src/lib/client/use-speech-input.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function harness({ prefix = false, unsupported = false, throws = false } = {}) {
  const slots = [];
  let index = 0, cleanup, draft = 'Typed draft', playbackStops = 0;
  const instances = [];
  class Recognition {
    constructor() { instances.push(this); this.aborts = 0; }
    start() { if (throws) throw Error('start failed'); }
    abort() { this.aborts++; }
  }
  const context = {
    exports: {}, navigator: { language: 'tr-TR' },
    window: unsupported ? {} : { [prefix ? 'webkitSpeechRecognition' : 'SpeechRecognition']: Recognition },
    require(name) {
      assert.equal(name, 'react');
      return {
        useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
        useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
        useEffect(effect) { cleanup ??= effect(); },
      };
    },
  };
  vm.runInNewContext(source, context);
  const render = () => {
    index = 0;
    return context.exports.useSpeechInput(update => { draft = update(draft); }, () => { playbackStops++; });
  };
  return {
    render, instances,
    draft: () => draft, type: value => { draft = value; },
    unmount: () => cleanup(), playbackStops: () => playbackStops,
  };
}
const result = (text, isFinal = true) => ({ isFinal, 0: { transcript: text } });

test('only explicit toggle starts; browser language and read-aloud stop are applied', () => {
  const h = harness();
  h.render(); assert.equal(h.instances.length, 0);
  h.render().toggle();
  assert.equal(h.instances[0].lang, 'tr-TR');
  assert.equal(h.playbackStops(), 1);
  assert.equal(h.render().listening, true);
});

test('prefixed API and explicit recognition language work', () => {
  const h = harness({ prefix: true });
  h.render().setLanguage('ar-SA'); h.render().toggle();
  assert.equal(h.instances[0].lang, 'ar-SA');
});

test('interim/repeated finals do not duplicate; concurrent typing and repeated words survive', () => {
  const h = harness(); h.render().toggle();
  const r = h.instances[0];
  r.onresult({ results: [result('hello', false)] });
  assert.equal(h.draft(), 'Typed draft');
  h.type('Edited draft');
  r.onresult({ results: [result('hello')] });
  r.onresult({ results: [result('hello'), result('hello', false)] });
  r.onresult({ results: [result('hello'), result('hello')] });
  assert.equal(h.draft(), 'Edited draft hello hello');
});

test('Stop/restart ignores captured stale results, errors and end callbacks', () => {
  const h = harness(); h.render().toggle();
  const old = h.instances[0];
  const { onresult, onerror, onend } = old;
  h.render().toggle();
  assert.equal(old.aborts, 1);
  h.render().toggle();
  onresult({ results: [result('stale')] }); onerror({ error: 'network' }); onend();
  assert.equal(h.draft(), 'Typed draft');
  assert.equal(h.render().listening, true);
  assert.equal(h.render().notice, '');
});

test('composer unmount invalidates captured callbacks before abort', () => {
  const h = harness(); h.render().toggle();
  const old = h.instances[0], late = old.onresult;
  h.unmount(); late({ results: [result('wrong conversation')] });
  assert.equal(old.aborts, 1);
  assert.equal(old.onresult, null);
  assert.equal(h.draft(), 'Typed draft');
});

test('explicit stop (also used by Send) blocks subsequent transcripts', () => {
  const h = harness(); h.render().toggle();
  const late = h.instances[0].onresult;
  h.render().stop(); h.type('');
  late({ results: [result('late text')] });
  assert.equal(h.draft(), '');
});

for (const [error, message] of [
  ['not-allowed', /denied/], ['service-not-allowed', /service is unavailable or restricted/],
  ['audio-capture', /No microphone/], ['no-speech', /No speech/],
  ['network', /connection/], ['language-not-supported', /language/],
  ['unknown', /failed/],
]) test(`recognition error: ${error}`, () => {
  const h = harness(); h.render().toggle(); h.instances[0].onerror({ error });
  assert.equal(h.render().listening, false);
  assert.match(h.render().notice, message);
  assert.equal(h.draft(), 'Typed draft');
});

test('no-speech end, startup failures and unsupported API leave typing usable', () => {
  const normal = harness(); normal.render().toggle(); normal.instances[0].onend();
  assert.match(normal.render().notice, /No speech/);
  const failed = harness({ throws: true }); failed.render().toggle();
  assert.equal(failed.render().listening, false);
  assert.equal(failed.instances[0].aborts, 1);
  const missing = harness({ unsupported: true }); missing.render().toggle();
  assert.match(missing.render().notice, /isn't supported/);
  assert.equal(missing.playbackStops(), 0);
  missing.type('Still typing'); assert.equal(missing.draft(), 'Still typing');
});

test('service restrictions are distinguished from microphone permission', () => {
  const h = harness(); h.render().toggle();
  h.instances[0].onerror({ error: 'service-not-allowed' });
  assert.match(h.render().notice, /even if microphone access is allowed/);
  assert.equal(h.instances[0].onend, null);
});
