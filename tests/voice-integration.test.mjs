// Load production components; mock only React/UI and browser/service boundaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/voice-harness.mjs';

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
  assert.equal(read(first).props.children[0].props['aria-label'], 'Read aloud');
  const lateResult = h.recognizers[0].onresult;
  clickRead(second);
  assert.equal(h.recognizers[0].aborts, 1);
  assert.equal(renderInput().listening, false);
  lateResult(result('bot speech')); oldEnd(); oldError();
  assert.equal(draft, '');
  assert.equal(read(second).props.children[0].props['aria-label'], 'Stop reading aloud');
  clickRead(first);
  const latest = h.utterances.at(-1);
  oldError();
  assert.equal(read(first).props.children[1].props.children, '');
  const before = h.cancellations();
  h.cleanup(second); // Inactive reply cleanup must not affect the current owner.
  assert.equal(read(first).props.children[0].props['aria-label'], 'Stop reading aloud');
  assert.equal(h.cancellations(), before);
  h.cleanup(first);
  assert.equal(latest.onend, null);
});

test('sending clears a stale recognition notice, including when recognition is inactive', async () => {
  const h = harness(), composer = h.instance();
  const render = () => h.render(composer, () => h.Composer({ conversationId: 'dm:one', name: 'Bot', members: [], running: false }));
  h.find(render(), n => n.props?.label === 'Start speech input').props.onClick();
  h.recognizers[0].onerror({ error: 'network' });
  assert.match(h.find(render(), n => n.props?.role === 'status').props.children, /connection/);
  h.find(render(), n => n.type === 'textarea').props.onChange({ target: { value: 'Manual message', selectionStart: 14 } });
  const pending = h.find(render(), n => n.props?.label === 'Send').props.onClick();
  h.finishSend(); await pending;
  assert.equal(h.find(render(), n => n.props?.role === 'status').props.children, '');
});

test('the actual ChatView assigns different Composer keys on conversation changes', () => {
  const h = harness(), view = h.instance();
  const render = () => h.render(view, () => h.ChatView());
  const first = h.find(render(), n => n.type === h.Composer);
  h.appState.active = 'dm:two';
  const next = h.find(render(), n => n.type === h.Composer);
  assert.equal(first.key, 'dm:one:0');
  assert.equal(next.key, 'dm:two:0');
});

test('unsupported recognition leaves the actual textarea and manual Send usable', async () => {
  const h = harness(), composer = h.instance();
  delete h.context.window.SpeechRecognition;
  const render = () => h.render(composer, () => h.Composer({ conversationId: 'dm:one', name: 'Bot', members: [], running: false }));
  const mic = h.find(render(), n => n.props?.label === 'Start speech input');
  assert.equal(mic.props['aria-pressed'], undefined);
  mic.props.onClick();
  assert.match(h.find(render(), n => n.props?.role === 'status').props.children, /isn't supported/);
  h.find(render(), n => n.type === 'textarea').props.onChange({ target: { value: 'Typed normally', selectionStart: 14 } });
  const pending = h.find(render(), n => n.props?.label === 'Send').props.onClick();
  h.finishSend(); await pending;
  assert.equal(h.sent[0].value, 'Typed normally');
});
