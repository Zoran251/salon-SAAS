/**
 * Ključ za Google Maps Embed API (place).
 * NEXT_PUBLIC_* ili server-only GOOGLE_MAPS_EMBED_API_KEY (layout ga injektuje u window).
 */
export function getGoogleMapsEmbedApiKey(): string {
  return (
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_EMBED_API_KEY ||
    ''
  ).trim()
}
