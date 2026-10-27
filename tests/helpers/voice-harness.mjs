import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parseHTML } from 'linkedom';

export function harness() {
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
    useMemo(fn) { owner.index++; return fn(); },
  };
  const recognizers = [], utterances = [], sent = [];
  let resolveSend;
  class Recognition {
    constructor() { recognizers.push(this); this.aborts = 0; }
    start() {}
    abort() { this.aborts++; }
  }
  let cancellations = 0, throwOnSpeak = false;
  const voices = [{ name: "Samantha", voiceURI: "Samantha", lang: "en-US", default: true }];
  const synth = { getVoices: () => voices, cancel() { cancellations++; }, speak(utterance) {
    if (throwOnSpeak) throw Error('speech failed');
    utterances.push(utterance);
  } };
  let now = 0, timerId = 0;
  const timers = new Map();
  const advance = (ms) => {
    const target = now + ms;
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = target;
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const appState = { active: "dm:one", bots: [{ id: "one" }, { id: "two" }], rooms: [], transcripts: { "dm:one": [], "dm:two": [] }, summaries: {} };
  const ui = { IconButton: 'button', Button: 'button' };
  const api = { send(id, value) { sent.push({ id, value }); return new Promise(resolve => { resolveSend = resolve; }); } };
  const context = vm.createContext({
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: { documentElement: { lang: 'en' } },
    window: { SpeechRecognition: Recognition, speechSynthesis: synth, SpeechSynthesisUtterance: class {} },
    navigator: { language: 'en-US' },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    sessionStorage: { getItem() { return null; } },
  });
  const modules = {};
  function load(path) {
    const exports = {};
    const require = name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'lucide-react') return {};
      if (name === 'clsx') return { default: (...args) => args.filter(Boolean).join(' ') };
      if (name === './ui') return ui;
      if (name === '@/lib/client/read-aloud') return modules.text;
      if (name === '@/lib/client/use-speech-input') return modules.input;
      if (name === './ReadAloud') return modules.output;
      if (name === '@/lib/client/api') return { api };
      if (name === './OpenDuetApp') return { useApp: () => ({ toast() {}, state: appState }) };
      return {};
    };
    const source = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInContext(`(function(require, exports) {${source}\n})`, context)(require, exports);
    return exports;
  }
  modules.text = load('src/lib/client/read-aloud.ts');
  modules.input = load('src/lib/client/use-speech-input.ts');
  modules.output = load('src/components/ReadAloud.tsx');
  const { Composer, ChatView } = load('src/components/ChatView.tsx');
  const instance = () => ({ slots: [], index: 0 });
  const render = (instance, fn) => { owner = instance; owner.index = 0; return fn(); };
  const cleanup = instance => instance.slots.forEach(slot => { if (typeof slot === 'function') slot(); });
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    return [node.props?.children].flat(Infinity).map(child => find(child, predicate)).find(Boolean);
  };
  const { document } = parseHTML('<div id="reply"><div data-read-aloud-text>Assistant reply</div></div>');
  const content = { current: document.querySelector('#reply') };
  return { instance, render, cleanup, find, recognizers, utterances, sent, finishSend: () => resolveSend(),
    advance, timers, voices, synth, context, cancellations: () => cancellations,
    throwOnSpeak: () => { throwOnSpeak = true; },
    text: modules.text, input: modules.input, output: modules.output, Composer, ChatView, appState, content };
}
