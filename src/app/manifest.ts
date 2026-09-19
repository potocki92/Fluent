import type { MetadataRoute } from "next";

/**
 * The installable identity of the app.
 *
 * WHY A MANIFEST AT ALL. Fluent is opened daily, from a phone, and without one
 * Android names the home-screen shortcut after the <title> and draws whatever
 * favicon it can find on a white plate. This file is what makes that shortcut
 * say "Fluent" and carry the symbol.
 *
 * TWO PURPOSES, TWO ARTWORKS. `any` is the icon shown as-is; `maskable` is the
 * one a launcher may crop to a circle, so its symbol is drawn smaller to stay
 * inside the 80% safe zone. Shipping only one of them is how a logo ends up
 * either floating in a white box or with its edges shaved off.
 *
 * The colours are the app's own surface (`--background` in `globals.css`), not
 * a second palette invented for the installer.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fluent — niemiecki dla Polaków",
    short_name: "Fluent",
    description:
      "Ucz się niemieckiego słownictwa przez czytanie, fiszki i adaptacyjne testy.",
    lang: "pl",
    start_url: "/",
    display: "standalone",
    background_color: "#1a202c",
    theme_color: "#1a202c",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
