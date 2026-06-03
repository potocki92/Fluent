"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BodyContent } from "@/components/texts/BodyContent";
import type { Text } from "@/types";

export function ReadingText({ text }: { text: Text }) {
  const [unlocked, setUnlocked] = useState(false);

  // Read gate: unlock the test after 5s or once the learner scrolls to the end.
  useEffect(() => {
    const timer = window.setTimeout(() => setUnlocked(true), 5000);

    const onScroll = () => {
      const reachedBottom =
        window.innerHeight + window.scrollY >=
        document.body.offsetHeight - 80;
      if (reachedBottom) setUnlocked(true);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <>
      <BodyContent body={text.body} />

      <div className="sticky bottom-20 pt-4">
        {unlocked ? (
          <Button
            asChild
            className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
          >
            <Link href={`/learn/${text.id}/test`}>Przejdź do pytań →</Link>
          </Button>
        ) : (
          <Button
            disabled
            className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
          >
            Czytaj uważnie…
          </Button>
        )}
      </div>
    </>
  );
}
