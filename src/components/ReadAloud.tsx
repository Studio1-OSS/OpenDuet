"use client";

import { Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { stopSpeechInput } from "@/lib/client/use-speech-input";
import { spokenText, speechChunks, SPEECH_TIMEOUT_MS } from "@/lib/client/read-aloud";
import { Button } from "./ui";

// Shared across replies so starting one always releases the previous owner.
let stopCurrent: (() => void) | undefined;

export function stopReadAloud() {
  stopCurrent?.();
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
    const chunks = speechChunks(text);
    // English-only output, independent of the microphone language. Pin one voice per playback.
    let selectedVoice: SpeechSynthesisVoice | null = null;
    try {
      const english = synth.getVoices().filter((voice) => /^en(?:-|$)/i.test(voice.lang));
      const american = english.filter((voice) => voice.lang.toLowerCase() === "en-us");
      selectedVoice = american.find((voice) => voice.default) ?? american[0]
        ?? english.find((voice) => voice.default) ?? english[0] ?? null;
    } catch { /* Let the browser choose using en-US if the voice list is unavailable. */ }
    let index = 0;
    let current: SpeechSynthesisUtterance | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const detach = () => {
      clearTimeout(timer);
      if (current) current.onend = current.onerror = null;
      current = null;
    };
    const finish = () => {
      if (ownedStop.current !== stop) return;
      detach();
      ownedStop.current = undefined;
      if (stopCurrent === stop) stopCurrent = undefined;
      setActive(false);
    };
    const stop = () => {
      finish(); // Invalidate and detach before cancel can dispatch browser events.
      try { synth.cancel(); } catch { /* The owner is already released. */ }
    };
    const fail = (message: string) => {
      if (ownedStop.current !== stop) return;
      stop();
      setNotice(message);
    };
    const speakNext = () => {
      if (ownedStop.current !== stop) return;
      try {
        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        current = utterance; // Keep a strong reference until this chunk completes.
        utterance.voice = selectedVoice;
        utterance.lang = "en-US";
        const ownsChunk = () => ownedStop.current === stop && current === utterance;
        utterance.onend = () => {
          if (!ownsChunk()) return;
          detach();
          index++;
          if (index === chunks.length) finish();
          else timer = setTimeout(speakNext, 120); // One chunk at a time, with a short pause.
        };
        utterance.onerror = () => {
          if (ownsChunk()) fail("Couldn't read this reply aloud. Try again or use another browser.");
        };
        timer = setTimeout(() => {
          if (ownsChunk()) fail("Reading timed out. Try again or use another browser.");
        }, SPEECH_TIMEOUT_MS);
        synth.speak(utterance);
      } catch {
        fail("Couldn't read this reply aloud. Try again or use another browser.");
      }
    };
    ownedStop.current = stop;
    stopCurrent = stop;
    setNotice("");
    setActive(true);
    try {
      synth.cancel();
      speakNext();
    } catch {
      fail("Couldn't read this reply aloud. Try again or use another browser.");
    }
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="ghost" onClick={toggle}
        aria-label={active ? "Stop reading aloud" : "Read aloud"}
        className={active ? "bg-accent-soft text-link" : undefined}>
        {active ? <Square size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
        {active ? "Stop reading" : "Read aloud"}
      </Button>
      <span role="status" className="text-[12px] text-mute">{notice}</span>
    </div>
  );
}
