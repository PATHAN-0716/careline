import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDownLeft,
  AudioLines,
  Check,
  CircleAlert,
  Copy,
  Maximize2,
  Mic,
  MicOff,
  Minus,
  Phone,
  PhoneOff,
  X,
} from 'lucide-react'
import { clock, dayLabel, failures, labels, phone, timer } from './data'
import { VoiceIcon } from './ui'
import type { CallState, useVoice } from './voice'

const stateNames: Record<CallState, string> = {
  idle: 'Ready',
  permission: 'Requesting microphone',
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  ending: 'Ending call',
  ended: 'Call ended',
  failed: 'Call failed',
}
const bars = [
  12, 23, 32, 17, 42, 26, 14, 38, 30, 47, 22, 34, 16, 33, 24, 42, 19, 30, 22,
  13,
]

export function Wave({ voice }: { voice?: ReturnType<typeof useVoice> }) {
  const target = useRef<HTMLDivElement>(null)
  const levels = voice?.levels
  const active = voice?.state === 'connected'
  useEffect(() => {
    const element = target.current
    if (!element || !levels || !active) return
    let raf = 0
    let smoothed = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const tick = () => {
      const { caller, assistant } = levels.current
      const intensity = Math.min(1, Math.max(caller, assistant) * 3.4)
      smoothed += (intensity - smoothed) * 0.18
      element.style.setProperty(
        '--amplitude',
        String(reduced.matches ? 1 : 0.34 + smoothed),
      )
      element.dataset.speaker = assistant > caller ? 'assistant' : 'caller'
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
      element.style.removeProperty('--amplitude')
    }
  }, [levels, active])
  return (
    <div className="wave" ref={target} aria-hidden="true">
      {bars.map((height, index) => (
        <i key={index} style={{ height }} />
      ))}
    </div>
  )
}

export function CallPanel({
  voice,
  select,
}: {
  voice: ReturnType<typeof useVoice>
  select: (reference: string) => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const follow = useRef(true)
  const [copied, setCopied] = useState('')
  const [showTranscript, setShowTranscript] = useState(true)
  const [mobile, setMobile] = useState(() =>
    window.matchMedia('(max-width: 650px)').matches,
  )
  const active = [
    'permission',
    'connecting',
    'connected',
    'reconnecting',
    'ending',
  ].includes(voice.state)
  const latestPhone = voice.events.findLast(
    (event) => event.type === 'phone_confirmed',
  )?.payload.phone_tail
  const calls = voice.events.filter(
    (event) =>
      event.type === 'booking_completed' ||
      event.type === 'cancellation_completed',
  )
  const doctors = new Set(
    voice.events.flatMap(
      (event) => event.payload.slots?.map((slot) => slot.doctor) ?? [],
    ),
  )

  useEffect(() => {
    const viewport = window.matchMedia('(max-width: 650px)')
    const resize = () => setMobile(viewport.matches)
    viewport.addEventListener('change', resize)
    return () => viewport.removeEventListener('change', resize)
  }, [])

  useEffect(() => {
    const element = panel.current
    if (!mobile || !voice.visible || voice.minimized || !element) return
    const restore = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.focus()
    const keepFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const buttons = [
        ...element.querySelectorAll<HTMLElement>('button:not(:disabled)'),
      ]
      const first = buttons[0]
      const last = buttons.at(-1)
      if (!first || !last) return
      const focus = document.activeElement
      if (
        focus === element ||
        !element.contains(focus) ||
        (event.shiftKey ? focus === first : focus === last)
      ) {
        event.preventDefault()
        const next = event.shiftKey ? last : first
        next.focus()
      }
    }
    document.addEventListener('keydown', keepFocus)
    return () => {
      document.removeEventListener('keydown', keepFocus)
      document.body.style.overflow = overflow
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus()
    }
  }, [mobile, voice.visible, voice.minimized])

  useEffect(() => {
    if (!voice.visible || voice.minimized) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        if (active) voice.setMinimized(true)
        else voice.setVisible(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [
    active,
    voice.visible,
    voice.minimized,
    voice.setMinimized,
    voice.setVisible,
  ])

  useEffect(() => {
    const element = scroll.current
    if (element && follow.current) element.scrollTop = element.scrollHeight
  }, [voice.events, voice.minimized, showTranscript])

  async function copy(reference: string) {
    try {
      await navigator.clipboard.writeText(reference)
      setCopied(reference)
    } catch {
      setCopied('Copy unavailable')
    }
  }

  return (
    <>
      <audio ref={voice.audio} autoPlay playsInline />
      <AnimatePresence>
        {voice.visible &&
          (voice.minimized ? (
            <motion.button
              key="mini-call"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mini-call"
              onClick={() => voice.setMinimized(false)}
            >
              <Phone size={17} />
              <span>Careline Assistant</span>
              <span className="mono">{timer(voice.elapsed)}</span>
              <Maximize2 size={16} />
            </motion.button>
          ) : (
            <motion.aside
              key="full-call"
              ref={panel}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              className="call-panel"
              role={mobile ? 'dialog' : undefined}
              aria-modal={mobile || undefined}
              tabIndex={mobile ? -1 : undefined}
              aria-label="Careline voice call"
            >
              <header className="call-header">
                <VoiceIcon />
                <div>
                  <strong>Careline Assistant</strong>
                  <small>
                    {latestPhone ? phone(latestPhone) : 'Caller'} ·{' '}
                    {stateNames[voice.state]}
                  </small>
                </div>
                <span className="mono">{timer(voice.elapsed)}</span>
                <button
                  className="icon-button"
                  aria-label={active ? 'Minimize call' : 'Close call summary'}
                  title={active ? 'Minimize call' : 'Close'}
                  onClick={() =>
                    active ? voice.setMinimized(true) : voice.setVisible(false)
                  }
                >
                  {active ? <Minus size={19} /> : <X size={19} />}
                </button>
              </header>
              {active && (
                <div className="call-visual">
                  <Wave voice={voice} />
                  <span role="status">
                    {voice.state === 'connected'
                      ? voice.agent
                      : stateNames[voice.state]}
                  </span>
                </div>
              )}
              {voice.error && (
                <p className="notice call-error" role="alert">
                  <CircleAlert size={17} />
                  {voice.error}
                </p>
              )}
              {!active && (
                <div className="call-summary">
                  <h2>Call summary</h2>
                  <p>
                    {stateNames[voice.state]} · {timer(voice.elapsed)}
                  </p>
                  <div className="summary-stats">
                    <span>
                      <strong>{doctors.size}</strong>Doctors checked
                    </span>
                    <span>
                      <strong>
                        {
                          calls.filter(
                            (event) => event.type === 'booking_completed',
                          ).length
                        }
                      </strong>
                      Bookings
                    </span>
                    <span>
                      <strong>
                        {
                          calls.filter(
                            (event) => event.type === 'cancellation_completed',
                          ).length
                        }
                      </strong>
                      Cancellations
                    </span>
                  </div>
                </div>
              )}
              <div className="transcript-title">
                <strong>
                  {active ? 'Live transcript' : 'Call transcript'}
                </strong>
                <button
                  className="text-button"
                  onClick={() => setShowTranscript(!showTranscript)}
                  aria-expanded={showTranscript}
                >
                  {showTranscript ? 'Hide' : 'Show'}
                </button>
              </div>
              <div
                className="transcript"
                ref={scroll}
                onScroll={(event) => {
                  const el = event.currentTarget
                  follow.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 54
                }}
              >
                {!voice.events.length && showTranscript && (
                  <p className="muted">
                    Spoken turns and appointment actions appear here.
                  </p>
                )}
                {voice.events.map((event) => {
                  const p = event.payload
                  if (event.type === 'transcript')
                    return (
                      showTranscript && (
                        <div
                          key={p.turnId}
                          className={'turn ' + (p.final ? '' : 'partial')}
                        >
                          <div>
                            <strong>
                              {p.speaker === 'caller' ? 'Caller' : 'Assistant'}
                            </strong>
                            <time>{clock(event.timestamp)}</time>
                          </div>
                          <p>{p.text}</p>
                        </div>
                      )
                    )
                  if (event.type === 'availability_check_completed')
                    return (
                      <article className="action-card" key={event.id}>
                        <strong>
                          <AudioLines size={15} />
                          Availability checked
                        </strong>
                        {p.slots?.length ? (
                          <>
                            <p>
                              {p.slots[0].doctor} · {p.slots[0].specialty}
                            </p>
                            <ul>
                              {p.slots.slice(0, 3).map((slot) => (
                                <li key={slot.id}>
                                  {dayLabel(slot.starts_at)} ·{' '}
                                  {clock(slot.starts_at)}
                                  {slot.doctor !== p.slots?.[0].doctor
                                    ? ' · ' + slot.doctor
                                    : ''}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p>No open slots for {p.date ?? 'this request'}.</p>
                        )}
                      </article>
                    )
                  if (
                    event.type === 'phone_confirmation_required' &&
                    p.phone_tail
                  )
                    return (
                      <article className="action-card" key={event.id}>
                        <strong>
                          <Phone size={15} />
                          {phone(p.phone_tail)}
                        </strong>
                        <p>Awaiting verbal confirmation.</p>
                      </article>
                    )
                  if (
                    p.reference &&
                    (event.type === 'booking_completed' ||
                      event.type === 'cancellation_completed')
                  ) {
                    const reference = p.reference
                    return (
                      <motion.article
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={'action-card ticket ' + p.status}
                        key={event.id}
                      >
                        <strong>
                          <Check size={16} />
                          {labels[event.type]}
                        </strong>
                        <div className="ticket-body">
                          <b>{p.doctor}</b>
                          <small>{p.specialty}</small>
                          {p.starts_at && (
                            <span>
                              {dayLabel(p.starts_at)} · {clock(p.starts_at)}
                            </span>
                          )}
                          <small>
                            {phone(p.phone_tail)} ·{' '}
                            {p.status === 'confirmed'
                              ? 'Confirmed'
                              : 'Cancelled'}
                          </small>
                        </div>
                        <div className="ticket-foot">
                          <button
                            className="text-button mono"
                            onClick={() => {
                              select(reference)
                              voice.setMinimized(true)
                            }}
                            title="View appointment"
                          >
                            {reference}
                            <ArrowDownLeft size={13} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Copy appointment reference"
                            title="Copy reference"
                            onClick={() => void copy(reference)}
                          >
                            {copied === reference ? (
                              <Check size={15} />
                            ) : (
                              <Copy size={15} />
                            )}
                          </button>
                        </div>
                      </motion.article>
                    )
                  }
                  if (
                    event.type === 'tool_failed' &&
                    p.code &&
                    p.code !== 'phone_required'
                  )
                    return (
                      <p key={event.id} className="action-card">
                        {failures[p.code] ??
                          'The action could not be completed.'}
                      </p>
                    )
                  return null
                })}
                {copied === 'Copy unavailable' && (
                  <p role="status" className="muted">
                    Clipboard access is unavailable.
                  </p>
                )}
              </div>
              <footer className="call-controls">
                {active ? (
                  <>
                    <button
                      className={
                        'control ' + (voice.muted ? 'muted-control' : '')
                      }
                      disabled={voice.state !== 'connected'}
                      aria-label={
                        voice.muted ? 'Unmute microphone' : 'Mute microphone'
                      }
                      aria-pressed={voice.muted}
                      title={voice.muted ? 'Unmute' : 'Mute'}
                      onClick={voice.toggleMute}
                    >
                      {voice.muted ? <MicOff size={20} /> : <Mic size={20} />}
                    </button>
                    <button
                      className="control hangup"
                      disabled={voice.state === 'ending'}
                      aria-label="End call"
                      title="End call"
                      onClick={() => void voice.end()}
                    >
                      <PhoneOff size={20} />
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    onClick={() => {
                      follow.current = true
                      setShowTranscript(true)
                      void voice.start()
                    }}
                  >
                    <Phone size={16} /> Start another call
                  </button>
                )}
              </footer>
            </motion.aside>
          ))}
      </AnimatePresence>
    </>
  )
}
