import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  checkHealth,
  sendChatMessageLive,
  type ChatResponse,
  type LiveStatusEvent,
  type McpBlock,
} from './api'

type Activity = {
  step: string
  message: string
  elapsedMs: number
}

type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; payload: ChatResponse; trace: Activity[] }
  | { role: 'error'; message: string }

const SUGGESTIONS = [
  'Plan a road trip from Paris to Lyon and Geneva',
  'Trip from Mumbai to Goa via Pune',
  'Best route from NYC to LA with stops',
]

function FloatingOrbs() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="animate-float-slow absolute top-16 -left-20 h-72 w-72 rounded-full bg-gold-400/12 blur-3xl" />
      <div className="animate-float-medium absolute top-1/3 right-[-4rem] h-56 w-56 rounded-full bg-chocolate-700/8 blur-3xl" />
      <div className="animate-float-fast absolute bottom-24 left-1/4 h-44 w-44 rounded-full bg-gold-500/10 blur-3xl" />
    </div>
  )
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="animate-bounce-dot h-1.5 w-1.5 rounded-full bg-chocolate-700/60" style={{ animationDelay: '0ms' }} />
      <span className="animate-bounce-dot h-1.5 w-1.5 rounded-full bg-chocolate-700/60" style={{ animationDelay: '150ms' }} />
      <span className="animate-bounce-dot h-1.5 w-1.5 rounded-full bg-chocolate-700/60" style={{ animationDelay: '300ms' }} />
    </span>
  )
}

function ActivityTimeline({ items, loading }: { items: Activity[]; loading?: boolean }) {
  return (
    <div className="rounded-2xl border border-chocolate-800/12 bg-white/70 p-4 shadow-sm backdrop-blur-sm">
      <p className="mb-3 text-xs font-semibold tracking-wide text-chocolate-700/70 uppercase">
        Behind the scenes
      </p>
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <div key={`${item.step}-${i}`} className="animate-fade-in flex items-start gap-2.5 text-sm text-chocolate-800">
            <span
              className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                i === items.length - 1 && loading ? 'bg-gold-500 animate-pulse' : 'bg-chocolate-800/50'
              }`}
            />
            <div className="min-w-0">
              <p>{item.message}</p>
              <p className="text-[11px] text-chocolate-700/50">{(item.elapsedMs / 1000).toFixed(1)}s</p>
            </div>
          </div>
        ))}
        {!items.length && loading && (
          <div className="flex items-center gap-2 text-sm text-chocolate-700/70">
            <TypingDots /> Starting up...
          </div>
        )}
      </div>
    </div>
  )
}

function McpCallout({
  toolName,
  args,
  ollamaSnippet,
}: {
  toolName: string
  args: Record<string, unknown>
  ollamaSnippet: string
}) {
  const [openRaw, setOpenRaw] = useState(false)
  return (
    <div className="animate-fade-in rounded-2xl border border-chocolate-800/15 bg-white/75 p-4 shadow-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-chocolate-800 px-3 py-1 text-xs font-semibold tracking-wide text-cream-50 uppercase">
          MCP called
        </span>
        <code className="rounded-lg bg-cream-200/80 px-2 py-0.5 font-mono text-sm text-chocolate-900">
          {toolName}
        </code>
      </div>
      <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-chocolate-900/90 p-3 font-mono text-xs text-cream-100">
        {JSON.stringify(args, null, 2)}
      </pre>
      <button
        type="button"
        onClick={() => setOpenRaw((o) => !o)}
        className="mt-2 text-xs font-medium text-chocolate-700 underline-offset-2 hover:underline"
      >
        {openRaw ? 'Hide' : 'Show'} tool-decision JSON
      </button>
      {openRaw && (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-cream-200/90 p-3 font-mono text-[11px] text-chocolate-800">
          {ollamaSnippet}
        </pre>
      )}
    </div>
  )
}

type LegGroup = {
  heading: string
  blocks: McpBlock[]
}

function groupBlocksIntoLegs(blocks: McpBlock[]): { summary: McpBlock[]; legs: LegGroup[] } {
  const summary: McpBlock[] = []
  const legs: LegGroup[] = []
  let currentLeg: LegGroup | null = null

  for (const block of blocks) {
    if (block.type === 'text') {
      const legMatch = block.text.match(/###\s*Leg\s+\d+/)
      if (legMatch) {
        if (currentLeg) legs.push(currentLeg)
        const title = block.text.match(/###\s*(Leg\s+\d+[^\n]*)/)?.[1] ?? legMatch[0].replace('### ', '')
        currentLeg = { heading: title, blocks: [block] }
        continue
      }
    }
    if (currentLeg) {
      currentLeg.blocks.push(block)
    } else {
      summary.push(block)
    }
  }
  if (currentLeg) legs.push(currentLeg)
  return { summary, legs }
}

function McpBlocks({ blocks }: { blocks: McpBlock[] }) {
  const { summary, legs } = groupBlocksIntoLegs(blocks)

  return (
    <div className="space-y-4">
      {summary.map((block, i) => (
        <RenderBlock key={`s-${i}`} block={block} />
      ))}
      {legs.map((leg, li) => (
        <div key={li} className="rounded-2xl border border-chocolate-800/10 bg-cream-50/80 shadow-sm">
          <div className="flex items-center gap-2 border-b border-chocolate-800/8 px-4 py-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chocolate-800 text-[10px] font-bold text-cream-50">
              {li + 1}
            </span>
            <span className="text-sm font-semibold text-chocolate-900">{leg.heading}</span>
          </div>
          <div className="space-y-3 px-4 py-3">
            {leg.blocks.map((block, bi) => (
              <RenderBlock key={`l${li}-${bi}`} block={block} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function RenderBlock({ block }: { block: McpBlock }) {
  if (block.type === 'text') {
    return (
      <div className="prose-mcp text-[15px] leading-relaxed text-chocolate-800">
        <ReactMarkdown>{block.text}</ReactMarkdown>
      </div>
    )
  }
  const mime = block.mime ?? 'image/png'
  return (
    <figure className="overflow-hidden rounded-2xl shadow-md ring-1 ring-chocolate-800/10">
      <img
        src={`data:${mime};base64,${block.data}`}
        alt="Route map"
        className="h-auto w-full object-cover"
      />
    </figure>
  )
}

function AssistantMessage({
  payload,
  trace,
  showBuilder,
}: {
  payload: ChatResponse
  trace: Activity[]
  showBuilder: boolean
}) {
  if (payload.kind === 'text_only') {
    return (
      <div className="animate-fade-in space-y-3">
        <div className="rounded-3xl rounded-tl-md bg-white px-5 py-4 shadow-md ring-1 ring-chocolate-800/8">
          <div className="prose-mcp text-[15px] text-chocolate-800">
            <ReactMarkdown>{payload.assistant_markdown}</ReactMarkdown>
          </div>
        </div>
        {showBuilder && <ActivityTimeline items={trace} />}
      </div>
    )
  }

  const stops = payload.tool_arguments.stops

  return (
    <div className="animate-fade-in space-y-4">
      {showBuilder && (
        <McpCallout
          toolName={payload.tool_name}
          args={payload.tool_arguments as Record<string, unknown>}
          ollamaSnippet={payload.ollama_first_raw}
        />
      )}
      {!showBuilder && stops.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-xs font-medium text-chocolate-700/60">Stops extracted:</span>
          {stops.map((s, i) => (
            <span
              key={i}
              className="rounded-full bg-chocolate-800/8 px-2.5 py-1 text-xs text-chocolate-800"
            >
              {s}
            </span>
          ))}
        </div>
      )}
      <div className="rounded-3xl rounded-tl-md bg-white px-5 py-4 shadow-md ring-1 ring-chocolate-800/8">
        <p className="mb-3 text-xs font-semibold tracking-wide text-chocolate-700/70 uppercase">
          Route
        </p>
        <McpBlocks blocks={payload.mcp_blocks} />
      </div>
      <div className="rounded-3xl rounded-tl-md border border-gold-500/30 bg-gradient-to-br from-cream-50 to-cream-200/80 px-5 py-4 shadow-sm">
        <p className="mb-2 text-xs font-semibold tracking-wide text-chocolate-800/70 uppercase">
          Travel advice
        </p>
        <div className="prose-mcp text-[15px] text-chocolate-800">
          <ReactMarkdown>{payload.consultant_advice}</ReactMarkdown>
        </div>
      </div>
      {showBuilder && <ActivityTimeline items={trace} />}
    </div>
  )
}

export default function App() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const [liveTrace, setLiveTrace] = useState<Activity[]>([])
  const [viewMode, setViewMode] = useState<'simple' | 'builder'>('simple')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    checkHealth()
      .then(() => setApiOk(true))
      .catch(() => setApiOk(false))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, loading, liveTrace])

  const doSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return
      setInput('')
      setLiveTrace([])
      setTurns((t) => [...t, { role: 'user', text: trimmed }])
      setLoading(true)

      const traceBuffer: Activity[] = []
      const onStatus = (event: LiveStatusEvent) => {
        const item: Activity = {
          step: event.step,
          message: event.message,
          elapsedMs: event.elapsed_ms,
        }
        traceBuffer.push(item)
        setLiveTrace((prev) => [...prev, item])
      }

      try {
        const payload = await sendChatMessageLive(trimmed, (event) => {
          if (event.type === 'status') onStatus(event)
        })
        const finalTrace = traceBuffer.length
          ? traceBuffer
          : [{ step: 'done', message: 'Response ready.', elapsedMs: 0 }]
        setTurns((t) => [...t, { role: 'assistant', payload, trace: finalTrace }])
      } catch (e) {
        setTurns((t) => [
          ...t,
          { role: 'error', message: e instanceof Error ? e.message : 'Unknown error' },
        ])
      } finally {
        setLoading(false)
        setLiveTrace([])
      }
    },
    [loading],
  )

  const onSend = useCallback(() => doSend(input), [input, doSend])

  const isEmpty = turns.length === 0 && !loading

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-gradient-to-b from-cream-50 via-cream-100 to-cream-200/40">
      <FloatingOrbs />

      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-chocolate-800/8 bg-cream-50/80 px-4 py-3 backdrop-blur-lg">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-chocolate-800 text-sm text-cream-50 shadow-md">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-chocolate-900">Atlas</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="inline-flex rounded-full border border-chocolate-800/12 bg-white/70 p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode('simple')}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                viewMode === 'simple'
                  ? 'bg-chocolate-800 text-cream-50 shadow-sm'
                  : 'text-chocolate-700 hover:bg-cream-200/70'
              }`}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setViewMode('builder')}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                viewMode === 'builder'
                  ? 'bg-chocolate-800 text-cream-50 shadow-sm'
                  : 'text-chocolate-700 hover:bg-cream-200/70'
              }`}
            >
              Builder
            </button>
          </div>

          {/* Status dot */}
          <div
            className={`h-2.5 w-2.5 rounded-full shadow-sm ${
              apiOk === true
                ? 'bg-emerald-500'
                : apiOk === false
                  ? 'bg-red-500'
                  : 'animate-pulse bg-cream-200'
            }`}
            title={apiOk === true ? 'API online' : apiOk === false ? 'API down' : 'Checking...'}
          />
        </div>
      </header>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
          <div className="animate-float-slow mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-chocolate-800 shadow-xl">
            <svg viewBox="0 0 24 24" fill="none" className="h-10 w-10 text-cream-50" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-chocolate-900">Where to next?</h2>
          <p className="mt-1.5 text-sm text-chocolate-700/75">Tell me the places and I'll map the route.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  doSend(s)
                  inputRef.current?.focus()
                }}
                className="rounded-full border border-chocolate-800/12 bg-white/80 px-3.5 py-2 text-xs text-chocolate-800 shadow-sm transition hover:bg-white hover:shadow-md active:scale-95"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat area */}
      {!isEmpty && (
        <main className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          {turns.map((turn, idx) =>
            turn.role === 'user' ? (
              <div key={idx} className="animate-slide-up flex justify-end">
                <div className="max-w-[85%] rounded-3xl rounded-tr-md bg-chocolate-800 px-4 py-3 text-[15px] text-cream-50 shadow-md">
                  {turn.text}
                </div>
              </div>
            ) : turn.role === 'error' ? (
              <div
                key={idx}
                className="animate-fade-in rounded-2xl border border-red-800/20 bg-red-50 px-4 py-3 text-sm text-red-900"
              >
                {turn.message}
              </div>
            ) : (
              <div key={idx} className="flex justify-start">
                <div className="max-w-full min-w-0 flex-1">
                  <AssistantMessage
                    payload={turn.payload}
                    trace={turn.trace}
                    showBuilder={viewMode === 'builder'}
                  />
                </div>
              </div>
            ),
          )}
          {loading && (
            <div className="animate-fade-in space-y-3">
              <div className="flex justify-start">
                <div className="rounded-3xl rounded-tl-md bg-white px-5 py-4 shadow-md ring-1 ring-chocolate-800/8">
                  <div className="flex items-center gap-2 text-sm text-chocolate-800">
                    <TypingDots />
                    <span className="text-chocolate-700/80">Thinking...</span>
                  </div>
                </div>
              </div>
              {viewMode === 'builder' && <ActivityTimeline items={liveTrace} loading />}
            </div>
          )}
          <div ref={bottomRef} />
        </main>
      )}

      {/* Input */}
      <footer className="border-t border-chocolate-800/8 bg-cream-50/85 p-3 backdrop-blur-lg">
        <div className="flex items-end gap-2 rounded-3xl bg-white py-2 pr-2 pl-4 shadow-lg ring-1 ring-chocolate-800/8 transition-shadow focus-within:ring-2 focus-within:ring-gold-500/40">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSend()
              }
            }}
            placeholder="Where should we go?"
            rows={1}
            className="min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-snug text-chocolate-900 outline-none placeholder:text-chocolate-700/40"
            disabled={loading}
            aria-label="Trip message"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={loading || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chocolate-800 text-sm font-semibold text-cream-50 shadow-md transition enabled:hover:bg-chocolate-900 enabled:active:scale-95 disabled:opacity-35"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  )
}
