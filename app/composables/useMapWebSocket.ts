import type { WebSocketMapMessage } from '~/types'

type MessageHandler = (msg: WebSocketMapMessage) => void

export function useMapWebSocket(encounterId: Ref<string | null>, basePath: 'encounters' | 'campaigns' = 'encounters') {
  const ws = ref<WebSocket | null>(null)
  const connected = ref(false)
  const accessRequired = ref(false)
  const accessError = ref<string | null>(null)
  const messageQueue: string[] = []
  const handlers = new Set<MessageHandler>()
  const reconnectHandlers = new Set<() => void>()
  // True once this encounter's socket has opened; the next open after a drop is a reconnect.
  let hasOpened = false
  let retryCount = 0
  let retryTimeout: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  function connect() {
    if (!encounterId.value || destroyed || accessRequired.value) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/api/${basePath}/${encounterId.value}/ws`

    const socket = new WebSocket(url)
    ws.value = socket

    socket.onopen = () => {
      if (socket !== ws.value) return
      connected.value = true
      retryCount = 0
      // Pushes sent while the socket was down are gone for good; let the page resync.
      if (hasOpened) for (const handler of reconnectHandlers) handler()
      hasOpened = true
      // Flush queued messages
      while (messageQueue.length > 0) {
        const raw = messageQueue.shift()!
        try { socket.send(raw) } catch { /* ignore */ }
      }
    }

    socket.onmessage = (event) => {
      if (socket !== ws.value) return
      try {
        const msg: WebSocketMapMessage = JSON.parse(event.data)
        for (const handler of handlers) handler(msg)
      } catch { /* ignore malformed */ }
    }

    socket.onclose = (event) => {
      if (socket !== ws.value) return
      connected.value = false
      ws.value = null
      if (event.code === 1008) {
        accessRequired.value = true
        accessError.value = 'Campaign access has changed. Verify access and reload to reconnect.'
        messageQueue.length = 0
        if (retryTimeout) clearTimeout(retryTimeout)
        return
      }
      if (!destroyed && retryCount < 5) {
        const delay = Math.pow(2, retryCount) * 1000
        retryTimeout = setTimeout(connect, delay)
        retryCount++
      }
    }

    socket.onerror = () => {
      socket.close()
    }
  }

  function send(msg: WebSocketMapMessage) {
    if (accessRequired.value || destroyed) return
    const raw = JSON.stringify(msg)
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(raw)
    } else {
      if (messageQueue.length < 60) messageQueue.push(raw)
    }
  }

  function onMessage(handler: MessageHandler) {
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  /** Called when the socket reopens after a drop (not on the first connection). */
  function onReconnect(handler: () => void) {
    reconnectHandlers.add(handler)
    return () => reconnectHandlers.delete(handler)
  }

  function disconnect() {
    destroyed = true
    messageQueue.length = 0
    if (retryTimeout) clearTimeout(retryTimeout)
    if (ws.value) { ws.value.close(); ws.value = null }
    connected.value = false
  }

  watch(encounterId, (id) => {
    disconnect()
    destroyed = false
    retryCount = 0
    hasOpened = false
    accessRequired.value = false
    accessError.value = null
    if (id) connect()
  })

  onMounted(() => { if (encounterId.value) connect() })
  onUnmounted(disconnect)

  return { connected, accessRequired, accessError, send, onMessage, onReconnect, disconnect }
}
