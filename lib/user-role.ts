/** Ključ u Supabase user_metadata za razlikovanje vlasnika salona i kupca. */
export const APP_ROLE_KEY = 'app_role' as const

export type AppRole = 'salon_owner' | 'customer'

export function getAppRole(user: { user_metadata?: Record<string, unknown> } | null | undefined): AppRole | null {
  const v = user?.user_metadata?.[APP_ROLE_KEY]
  if (v === 'salon_owner' || v === 'customer') return v
  return null
}

export function isSalonOwnerMetadata(user: { user_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return getAppRole(user) === 'salon_owner'
}

export function isCustomerMetadata(user: { user_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return getAppRole(user) === 'customer'
}
