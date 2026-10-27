/** Only completed assistant text is marked by the renderer; never query styling classes. */
export function spokenText(root: HTMLElement | null): string {
  if (!root) return "";
  return Array.from(root.querySelectorAll("[data-read-aloud-text]"), (node) => {
    const copy = node.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("pre, script, style, [hidden], [aria-hidden='true']").forEach((el) => el.remove());
    copy.querySelectorAll("img").forEach((el) => el.replaceWith(el.alt));
    copy.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
    copy.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, tr").forEach((el) => {
      el.prepend("\n");
      el.append("\n");
    });
    copy.querySelectorAll("td, th").forEach((el) => el.append(" "));
    return copy.textContent ?? "";
  }).join("\n").replace(/[^\S\n]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}

export const MAX_SPEECH_CHARS = 240;
export const SPEECH_TIMEOUT_MS = 45_000;

/** Prefer paragraph/sentence boundaries; hard-split unpunctuated text without losing characters. */
export function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  for (let rest of text.split(/\n+/).map((part) => part.trim()).filter(Boolean)) {
    while (rest.length > MAX_SPEECH_CHARS) {
      const prefix = rest.slice(0, MAX_SPEECH_CHARS);
      const sentences = [...prefix.matchAll(/[.!?。！？؟](?:\s|$)/g)];
      const sentence = sentences[sentences.length - 1];
      let end = sentence ? sentence.index! + 1 : prefix.lastIndexOf(" ");
      if (!sentence && end < MAX_SPEECH_CHARS / 2) end = MAX_SPEECH_CHARS;
      // Do not split a UTF-16 surrogate pair (for example, emoji).
      if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
      chunks.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    if (rest) chunks.push(rest);
  }
  return chunks;
}
