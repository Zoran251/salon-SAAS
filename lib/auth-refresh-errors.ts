/** Poruke Supabase Auth koje znače da je refresh token nevažeći / obrisan u pregledniku. */
export function isInvalidRefreshTokenError(message: string | undefined | null): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return (
    m.includes('refresh token') ||
    m.includes('invalid refresh') ||
    m.includes('refresh token not found') ||
    m.includes('jwt expired')
  )
}
