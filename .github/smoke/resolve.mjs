// `claude-code` is the engine's own module; the smoke needs none of what disk.ts takes from it.
export async function resolve(specifier, context, next) {
  if (specifier === 'claude-code') return { url: new URL('./claude-code.mjs', import.meta.url).href, shortCircuit: true }

  return next(specifier, context)
}
