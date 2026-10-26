// These tests load production modules, mocking only React/UI and browser/service boundaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness() {
  let owner;
  const react = {
    useState(initial) {
      const instance = owner, index = instance.index++;
      if (!(index in instance.slots)) instance.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [instance.slots[index], value => { instance.slots[index] = typeof value === 'function' ? value(instance.slots[index]) : value; }];
    },
    useRef(initial) { return owner.slots[owner.index++] ??= { current: initial }; },
    useEffect(effect) { const index = owner.index++; if (!(index in owner.slots)) owner.slots[index] = effect(); },
    useLayoutEffect() {},
  };
  const recognizers = [], utterances = [], sent = [];
  let resolveSend;
  class Recognition {
    constructor() { recognizers.push(this); this.aborts = 0; }
    start() {}
    abort() { this.aborts++; }
  }
  const synth = { cancel() {}, speak(utterance) { utterances.push(utterance); } };
  const jsx = (type, props) => ({ type, props });
  const ui = { IconButton: 'button', Button: 'button' };
  const api = { send(id, value) { sent.push({ id, value }); return new Promise(resolve => { resolveSend = resolve; }); } };
  const context = vm.createContext({
    window: { SpeechRecognition: Recognition, speechSynthesis: synth, SpeechSynthesisUtterance: class {} },
    navigator: { language: 'en-US' },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    sessionStorage: { getItem() { return null; } },
  });
  const modules = {};
  function load(path, extra = '') {
    const exports = {};
    const require = name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'lucide-react') return {};
      if (name === 'clsx') return { default: (...args) => args.filter(Boolean).join(' ') };
      if (name === './ui') return ui;
      if (name === '@/lib/client/use-speech-input') return modules.input;
      if (name === './ReadAloud') return modules.output;
      if (name === '@/lib/client/api') return { api };
      if (name === './OpenDuetApp') return { useApp: () => ({ toast() {} }) };
      return {};
    };
    const source = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInContext(`(function(require, exports) {${source}\n${extra}\n})`, context)(require, exports);
    return exports;
  }
  modules.input = load('src/lib/client/use-speech-input.ts');
  modules.output = load('src/components/ReadAloud.tsx');
  // Composer is file-local; expose the actual compiled function only inside this test VM.
  const { Composer } = load('src/components/ChatView.tsx', 'exports.Composer = Composer;');
  const instance = () => ({ slots: [], index: 0 });
  const render = (instance, fn) => { owner = instance; owner.index = 0; return fn(); };
  const cleanup = instance => instance.slots.forEach(slot => { if (typeof slot === 'function') slot(); });
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    return [node.props?.children].flat(Infinity).map(child => find(child, predicate)).find(Boolean);
  };
  // DOM boundary fixture: lifecycle tests do not claim to test Markdown parsing/layout.
  const content = { current: { querySelectorAll: () => [{ cloneNode: () => ({ querySelectorAll: () => [], textContent: 'Assistant reply' }) }] } };
  return { instance, render, cleanup, find, recognizers, utterances, sent, finishSend: () => resolveSend(),
    input: modules.input, output: modules.output, Composer, content };
}
const result = text => ({ results: [{ isFinal: true, 0: { transcript: text } }] });

// This exercises the production Composer.send, not a hand-written approximation of it.
test('Send while listening prevents late results from repopulating the cleared draft', async () => {
  const h = harness(), composer = h.instance();
  const render = () => h.render(composer, () => h.Composer({ conversationId: 'dm:one', name: 'Bot', members: [], running: false }));
  const textarea = tree => h.find(tree, node => node.type === 'textarea');
  textarea(render()).props.onChange({ target: { value: 'Typed message', selectionStart: 13 } });
  h.find(render(), node => node.props?.label === 'Start speech input').props.onClick();
  const r = h.recognizers[0], late = r.onresult;
  const pending = h.find(render(), node => node.props?.label === 'Send').props.onClick();
  late(result('during request'));
  h.finishSend(); await pending;
  late(result('after clearing'));
  assert.equal(textarea(render()).props.value, '');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].value, 'Typed message');
  assert.equal(r.aborts, 1);
});

test('switching composers isolates the new conversation from captured callbacks', () => {
  const h = harness(), old = h.instance(), next = h.instance();
  const render = (instance, id) => h.render(instance, () => h.Composer({ conversationId: id, name: 'Bot', members: [], running: false }));
  h.find(render(old, 'dm:one'), n => n.props?.label === 'Start speech input').props.onClick();
  const late = h.recognizers[0].onresult;
  h.cleanup(old);
  late(result('old conversation'));
  assert.equal(h.find(render(next, 'dm:two'), n => n.type === 'textarea').props.value, '');
});

test('voice modes stop each other; stale read-aloud callbacks cannot reset playback', () => {
  const h = harness(), input = h.instance(), first = h.instance(), second = h.instance();
  let draft = '';
  const renderInput = () => h.render(input, () => h.input.useSpeechInput(update => { draft = update(draft); }, h.output.stopReadAloud));
  const read = instance => h.render(instance, () => h.output.ReadAloud({ contentRef: h.content }));
  const clickRead = instance => read(instance).props.children[0].props.onClick();
  clickRead(first);
  const oldEnd = h.utterances[0].onend, oldError = h.utterances[0].onerror;
  renderInput().toggle();
  assert.equal(read(first).props.children[0].props['aria-pressed'], false);
  const lateResult = h.recognizers[0].onresult;
  clickRead(second);
  assert.equal(h.recognizers[0].aborts, 1);
  assert.equal(renderInput().listening, false);
  lateResult(result('bot speech')); oldEnd(); oldError();
  assert.equal(draft, '');
  assert.equal(read(second).props.children[0].props['aria-pressed'], true);
  clickRead(first);
  const latest = h.utterances.at(-1);
  oldError();
  assert.equal(read(first).props.children[1].props.children, 'Reading aloud…');
  h.cleanup(second); // Inactive reply cleanup must not affect the current owner.
  assert.equal(latest.onend instanceof Function || typeof latest.onend === 'function', true);
  h.cleanup(first);
  assert.equal(latest.onend, null);
});
