/** Runtime deployment origins avoid baking the public hostname into the container. */
export function withWebSocketOrigins(policy: string, configuredOrigins: string): string {
  const sockets = configuredOrigins.split(',').map(value => value.trim()).filter(Boolean).map(value => {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== value) throw new Error('Invalid allowed Origin')
    return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`
  })
  const directives = policy.split(';').map(value => value.trim()).filter(value => value && !value.startsWith('connect-src '))
  directives.push(`connect-src 'self' ${[...new Set(sockets)].join(' ')}`.trim())
  return directives.join('; ')
}
