"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ReviewGrade } from "@/actions/update-srs";
import type { Word } from "@/types";

const GRADES: { grade: ReviewGrade; label: string; className: string }[] = [
  { grade: "again", label: "Jeszcze raz", className: "bg-red text-white" },
  { grade: "hard", label: "Trudne", className: "bg-[#374151] text-main" },
  { grade: "good", label: "Dobre", className: "bg-blue text-white" },
  { grade: "easy", label: "Łatwe", className: "bg-green text-white" },
];

/**
 * A single review flashcard. Shows the German side first; tap to flip and
 * reveal the translation, then grade recall.
 */
export function FlashCard({
  word,
  onGrade,
}: {
  word: Word;
  onGrade: (grade: ReviewGrade) => void;
}) {
  const [flipped, setFlipped] = useState(false);

  function grade(g: ReviewGrade) {
    setFlipped(false);
    onGrade(g);
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="w-full"
        aria-label="Odwróć fiszkę"
      >
        <Card className="relative min-h-48 items-center justify-center bg-[#2d3748] p-6 text-center">
          <AnimatePresence mode="wait">
            {flipped ? (
              <motion.div
                key="back"
                initial={{ rotateY: -90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ rotateY: 90, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <p className="text-2xl font-semibold text-gold">
                  {word.translation_pl ?? "—"}
                </p>
                {word.example_de && (
                  <p className="mt-3 text-sm text-muted2">{word.example_de}</p>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="front"
                initial={{ rotateY: -90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ rotateY: 90, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <p className="text-3xl font-bold">{word.display}</p>
                <p className="mt-2 text-xs text-muted2">Dotknij, aby odwrócić</p>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </button>

      {flipped && (
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
          {GRADES.map(({ grade: g, label, className }) => (
            <Button
              key={g}
              onClick={() => grade(g)}
              className={className}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
