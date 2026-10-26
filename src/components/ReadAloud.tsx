"use client";

import { Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { stopSpeechInput } from "@/lib/client/use-speech-input";
import { Button } from "./ui";

// Shared across replies so starting one always releases the previous owner.
let stopCurrent: (() => void) | undefined;

export function stopReadAloud() {
  stopCurrent?.();
}

/** Use the same Markdown rendering as chat, never tool cards or reasoning. */
function spokenText(root: HTMLElement | null): string {
  if (!root) return "";
  return Array.from(root.querySelectorAll(".prose-chat"), (node) => {
    const copy = node.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("pre, script, style, [aria-hidden='true']").forEach((el) => el.remove());
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

export function ReadAloud({ contentRef }: { contentRef: RefObject<HTMLDivElement | null> }) {
  const [active, setActive] = useState(false);
  const [notice, setNotice] = useState("");
  const ownedStop = useRef<(() => void) | undefined>(undefined);

  useEffect(() => () => ownedStop.current?.(), []);

  const toggle = () => {
    if (ownedStop.current) {
      ownedStop.current();
      return;
    }
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setNotice("Read aloud is not supported in this browser.");
      return;
    }
    const text = spokenText(contentRef.current);
    if (!text) {
      setNotice("No text to read aloud. Code blocks are skipped.");
      return;
    }
    stopSpeechInput();
    stopCurrent?.();
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    const finish = () => {
      if (ownedStop.current !== stop) return;
      ownedStop.current = undefined;
      if (stopCurrent === stop) stopCurrent = undefined;
      utterance.onend = null;
      utterance.onerror = null;
      setActive(false);
    };
    const stop = () => {
      finish(); // Ignore cancellation events, including late events from older replies.
      synth.cancel();
    };
    ownedStop.current = stop;
    stopCurrent = stop;
    utterance.onend = finish;
    utterance.onerror = () => {
      if (ownedStop.current !== stop) return;
      finish();
      setNotice("Couldn't read this reply aloud. Try again or use another browser.");
    };
    setNotice("");
    setActive(true);
    try {
      synth.cancel();
      synth.speak(utterance);
    } catch {
      stop();
      setNotice("Couldn't read this reply aloud. Try again or use another browser.");
    }
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="ghost" onClick={toggle} aria-pressed={active}
        aria-label={active ? "Stop reading aloud" : "Read aloud"}
        className={active ? "bg-accent-soft text-link" : undefined}>
        {active ? <Square size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
        {active ? "Stop reading" : "Read aloud"}
      </Button>
      <span role="status" className="text-[12px] text-mute">{active ? "Reading aloud…" : notice}</span>
    </div>
  );
}
