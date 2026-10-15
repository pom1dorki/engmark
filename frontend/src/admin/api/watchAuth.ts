import type { AdminApi } from './admin'

export function watchAuth(api: AdminApi, onUnauthenticated: () => void): AdminApi {
  const skip = new Set<string>(['login', 'session'])
  const wrapped: Record<string, unknown> = {}
  for (const [name, method] of Object.entries(api) as [string, (...args: unknown[]) => Promise<{ ok: boolean; error?: { kind: string } }>][]) {
    wrapped[name] = skip.has(name)
      ? method
      : async (...args: unknown[]) => {
          const result = await method(...args)
          if (!result.ok && result.error?.kind === 'unauthenticated') onUnauthenticated()
          return result
        }
  }
  return wrapped as unknown as AdminApi
}
