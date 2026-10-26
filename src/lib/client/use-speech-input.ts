"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

// SpeechRecognition is not included in TypeScript's standard DOM declarations.
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

const errors: Record<string, string> = {
  "not-allowed": "Speech recognition permission was denied. Check site microphone permission and system speech recognition restrictions, then try again.",
  "service-not-allowed": "The speech recognition service is unavailable or restricted, even if microphone access is allowed. In Safari, check that Siri is enabled and not restricted in macOS settings. You can still type your message.",
  "audio-capture": "No microphone is available. Check your microphone and system permissions.",
  "no-speech": "No speech was detected. Try again when you're ready.",
  network: "Speech recognition couldn't connect. Check your connection and try again.",
  "language-not-supported": "This recognition language isn't supported. Choose another language.",
  aborted: "Listening was interrupted. Start again when you're ready.",
};

export function useSpeechInput(setText: Dispatch<SetStateAction<string>>, beforeStart: () => void) {
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState("");
  const [language, setLanguage] = useState("");
  const session = useRef<Recognition | null>(null);

  const stop = () => {
    const current = session.current;
    if (!current) return;
    session.current = null; // Invalidate before abort, which may dispatch events synchronously.
    current.onresult = current.onerror = current.onend = null;
    try { current.abort(); } catch { /* Already stopped by the browser. */ }
    setListening(false);
  };

  useEffect(() => () => {
    const current = session.current;
    session.current = null;
    if (!current) return;
    current.onresult = current.onerror = current.onend = null;
    try { current.abort(); } catch { /* Already stopped. */ }
  }, []);

  const toggle = () => {
    if (session.current) {
      stop();
      setNotice("Listening stopped. Review your text before sending.");
      return;
    }
    const browser = window as SpeechWindow;
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) {
      setNotice("Speech input isn't supported in this browser. You can still type your message.");
      return;
    }
    let recognition: Recognition | undefined;
    try {
      beforeStart();
      recognition = new Constructor();
      const current = recognition;
      current.lang = language || navigator.language || "en-US";
      current.continuous = true;
      current.interimResults = false;
      const consumed = new Set<number>();
      let heardSpeech = false;
      current.onresult = (event) => {
        if (session.current !== current) return;
        const additions: string[] = [];
        // Final results stay in the result list; append each index only once.
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result.isFinal || consumed.has(i)) continue;
          consumed.add(i);
          const transcript = result[0].transcript.trim();
          if (transcript) additions.push(transcript);
        }
        if (!additions.length) return;
        heardSpeech = true;
        const addition = additions.join(" ");
        setText((previous) => `${previous}${previous && !/\s$/.test(previous) ? " " : ""}${addition}`);
      };
      current.onerror = (event) => {
        if (session.current !== current) return;
        stop();
        setNotice(errors[event.error] ?? "Speech recognition failed. Try again or type your message.");
      };
      current.onend = () => {
        if (session.current !== current) return;
        stop();
        setNotice(heardSpeech ? "Listening ended. Review your text before sending." : errors["no-speech"]);
      };
      session.current = current;
      setNotice("");
      setListening(true); // Includes the browser's permission prompt/startup period.
      current.start();
    } catch {
      if (recognition && session.current === recognition) stop();
      setNotice("Couldn't start speech input. Check microphone permissions and speech recognition service settings, or type your message.");
    }
  };

  return { listening, notice, language, setLanguage, toggle, stop };
}
