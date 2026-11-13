/** Prefer the API's explanation to ofetch's generic '[POST] ...: 400' message. */
export function requestErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error==='object') {
    const value=error as { data?: {message?:unknown;statusMessage?:unknown}; message?:unknown; statusMessage?:unknown }
    for (const message of [value.data?.message,value.data?.statusMessage,value.statusMessage,value.message]) {
      if(typeof message==='string'&&message.trim())return message
    }
  }
  return fallback
}
