/**
 * Speak a German string with the browser's speech synthesis. No-ops on the
 * server and on browsers without the Web Speech API. Shared by the dictionary
 * card and the flashcard review so the pronunciation behaviour stays in one
 * place (de-DE voice, slightly slowed down for learners).
 */
export function speakGerman(text: string): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "de-DE";
  utterance.rate = 0.8;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
