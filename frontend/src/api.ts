export type McpBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mime?: string }

export type ChatResponse =
  | {
      kind: 'text_only'
      ollama_first_raw: string
      assistant_markdown: string
    }
  | {
      kind: 'mcp_flow'
      ollama_first_raw: string
      tool_name: string
      tool_arguments: { stops: string[] }
      mcp_blocks: McpBlock[]
      consultant_advice: string
    }

const base = import.meta.env.VITE_API_BASE ?? ''

export async function sendChatMessage(message: string): Promise<ChatResponse> {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const j = await res.json()
      if (typeof j.detail === 'string') detail = j.detail
      else if (Array.isArray(j.detail)) detail = j.detail.map((x: { msg?: string }) => x.msg ?? JSON.stringify(x)).join(', ')
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return res.json() as Promise<ChatResponse>
}

export async function checkHealth(): Promise<{ ok: boolean; model: string }> {
  const res = await fetch(`${base}/api/health`)
  if (!res.ok) throw new Error('API unreachable')
  return res.json()
}

export type LiveStatusEvent = {
  type: 'status'
  step: string
  message: string
  elapsed_ms: number
  meta?: Record<string, unknown>
}

export type LiveResultEvent = {
  type: 'result'
  payload: ChatResponse
  elapsed_ms: number
}

export type LiveErrorEvent = {
  type: 'error'
  message: string
  elapsed_ms: number
}

export type LiveEvent = LiveStatusEvent | LiveResultEvent | LiveErrorEvent

function parseSseBlock(block: string): { event: string; data: string } | null {
  const lines = block.split('\n')
  let event = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!dataLines.length) return null
  return { event, data: dataLines.join('\n') }
}

export async function sendChatMessageLive(
  message: string,
  onEvent: (event: LiveEvent) => void,
): Promise<ChatResponse> {
  const res = await fetch(`${base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })

  if (!res.ok) {
    let detail = res.statusText
    try {
      const j = await res.json()
      if (typeof j.detail === 'string') detail = j.detail
      else if (Array.isArray(j.detail)) {
        detail = j.detail.map((x: { msg?: string }) => x.msg ?? JSON.stringify(x)).join(', ')
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('Streaming response is not available')

  const decoder = new TextDecoder()
  let buffer = ''
  let finalPayload: ChatResponse | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const parsed = parseSseBlock(chunk)
      if (!parsed) continue
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(parsed.data) as Record<string, unknown>
      } catch {
        continue
      }

      if (parsed.event === 'status') {
        onEvent({
          type: 'status',
          step: String(payload.step ?? ''),
          message: String(payload.message ?? ''),
          elapsed_ms: Number(payload.elapsed_ms ?? 0),
          meta:
            payload.meta && typeof payload.meta === 'object'
              ? (payload.meta as Record<string, unknown>)
              : undefined,
        })
      } else if (parsed.event === 'result') {
        const resultPayload = payload.payload as ChatResponse
        finalPayload = resultPayload
        onEvent({
          type: 'result',
          payload: resultPayload,
          elapsed_ms: Number(payload.elapsed_ms ?? 0),
        })
      } else if (parsed.event === 'error') {
        const messageText = String(payload.message ?? 'Unknown backend error')
        onEvent({
          type: 'error',
          message: messageText,
          elapsed_ms: Number(payload.elapsed_ms ?? 0),
        })
        throw new Error(messageText)
      }
    }
  }

  if (!finalPayload) throw new Error('No final response received from backend')
  return finalPayload
}
