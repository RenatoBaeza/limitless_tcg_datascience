import { useState } from "react";
import { deckImage } from "../api";

/**
 * The composited sprite for a deck. Falls back to nothing rather than a broken
 * image: the deck's name is always beside it, so a missing sprite costs
 * recognition speed, not information.
 */
export function DeckIcon({ deckId, alt }: { deckId: string; alt?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;

  return (
    <img
      src={deckImage(deckId)}
      alt={alt ?? ""}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}
