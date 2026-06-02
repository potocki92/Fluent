"use client";

import { motion } from "framer-motion";

const COLORS = ["#d4a574", "#4299e1", "#48bb78", "#f56565", "#ecc94b"];
const PIECES = 40;

/** Deterministic pseudo-random in [0, 1) — keeps the render pure (no Math.random). */
function rand(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const pieces = Array.from({ length: PIECES }).map((_, i) => ({
  id: i,
  left: rand(i + 1) * 100,
  color: COLORS[i % COLORS.length],
  delay: rand(i + 2) * 0.5,
  duration: 1.8 + rand(i + 3) * 1.2,
  drift: (rand(i + 4) - 0.5) * 160,
  rotate: rand(i + 5) * 720,
}));

/**
 * Lightweight celebratory confetti built on framer-motion (no extra deps).
 * Renders a one-shot burst of coloured pieces falling from the top.
 */
export function Confetti() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute top-0 size-2 rounded-[2px]"
          style={{ left: `${p.left}%`, backgroundColor: p.color }}
          initial={{ y: -20, x: 0, opacity: 1, rotate: 0 }}
          animate={{
            y: "105vh",
            x: p.drift,
            opacity: [1, 1, 0],
            rotate: p.rotate,
          }}
          transition={{ duration: p.duration, delay: p.delay, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}
