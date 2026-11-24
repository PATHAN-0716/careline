import { useEffect, useRef, useState } from 'react'
import type { PipecatClient } from '@pipecat-ai/client-js'
import type { CareEvent } from './data'

export type CallState =
  | 'idle'
  | 'permission'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ending'
  | 'ended'
  | 'failed'
const messages = {
  denied:
    'Microphone access was denied. Allow it in browser settings and try again.',
  missing: 'No microphone was found. Connect one and try again.',
  busy: 'The microphone is busy. Close other apps using it and try again.',
  connect:
    'The voice connection could not be established. Check the backend configuration and try again.',
  disconnected: 'The voice connection dropped. Start another call to continue.',
}
function careEvent(value: unknown): value is CareEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'type' in value &&
    'payload' in value
  )
}

export function useVoice(onEvent: (event: CareEvent) => void) {
  const [state, updateState] = useState<CallState>('idle')
  const [visible, setVisible] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [events, setEvents] = useState<CareEvent[]>([])
  const [agent, setAgent] = useState('Listening')
  const stateRef = useRef<CallState>('idle')
  const clientRef = useRef<PipecatClient | null>(null)
  const attempt = useRef(0)
  const levels = useRef({ caller: 0, assistant: 0 })
  const audio = useRef<HTMLAudioElement>(null)
  const connectedAt = useRef(0)
  const callback = useRef(onEvent)
  const connectTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  useEffect(() => {
    callback.current = onEvent
  }, [onEvent])

  function change(next: CallState) {
    stateRef.current = next
    updateState(next)
  }

  async function release() {
    attempt.current++
    clearTimeout(connectTimeout.current)
    const client = clientRef.current
    clientRef.current = null
    levels.current = { caller: 0, assistant: 0 }
    if (audio.current) audio.current.srcObject = null
    if (client) {
      try {
        await client.disconnect()
      } catch {
        /* The peer may already be closed. */
      }
    }
  }

  useEffect(
    () => () => {
      void release()
    },
    [],
  )
  useEffect(() => {
    if (state !== 'connected' && state !== 'reconnecting') return
    const interval = setInterval(
      () => setElapsed(Math.floor((Date.now() - connectedAt.current) / 1000)),
      250,
    )
    return () => clearInterval(interval)
  }, [state])

  async function start() {
    setVisible(true)
    setMinimized(false)
    if (
      clientRef.current ||
      stateRef.current === 'permission' ||
      stateRef.current === 'ending'
    )
      return
    setEvents([])
    setError('')
    setElapsed(0)
    setMuted(false)
    setAgent('Listening')
    connectedAt.current = 0
    change('permission')
    const generation = ++attempt.current
    let libraries: [
      typeof import('@pipecat-ai/client-js'),
      typeof import('@pipecat-ai/small-webrtc-transport'),
    ]
    try {
      libraries = await Promise.all([
        import('@pipecat-ai/client-js'),
        import('@pipecat-ai/small-webrtc-transport'),
      ])
    } catch {
      if (generation === attempt.current) {
        setError(messages.connect)
        change('failed')
      }
      return
    }
    if (generation !== attempt.current) return
    const [{ PipecatClient, RTVIEvent }, { SmallWebRTCTransport }] = libraries
    const client = new PipecatClient({
      transport: new SmallWebRTCTransport(),
      enableCam: false,
      enableMic: true,
    })
    clientRef.current = client
    const current = () => clientRef.current === client
    const fail = (message: string) => {
      if (!current() || stateRef.current === 'ending') return
      setError(message)
      change('failed')
      void release()
    }
    client.on(RTVIEvent.BotReady, () => {
      if (!current() || stateRef.current === 'ending') return
      clearTimeout(connectTimeout.current)
      connectedAt.current ||= Date.now()
      change('connected')
    })
    client.on(RTVIEvent.Disconnected, () => fail(messages.disconnected))
    client.on(RTVIEvent.TransportStateChanged, (next) => {
      if (!current() || !connectedAt.current || stateRef.current === 'ending')
        return
      if (String(next) === 'reconnecting' || next === 'connecting')
        change('reconnecting')
      if (
        next === 'ready' ||
        (next === 'connected' && stateRef.current === 'reconnecting')
      )
        change('connected')
      if (next === 'error') fail(messages.disconnected)
    })
    client.on(RTVIEvent.Error, (event) => {
      const data = event.data
      if (
        typeof data === 'object' &&
        data !== null &&
        'fatal' in data &&
        data.fatal
      )
        fail(messages.connect)
    })
    client.on(RTVIEvent.TrackStarted, (track, participant) => {
      if (
        !current() ||
        track.kind !== 'audio' ||
        participant?.local ||
        !audio.current
      )
        return
      audio.current.srcObject = new MediaStream([track])
      void audio.current.play().catch(() => {})
    })
    client.on(RTVIEvent.LocalAudioLevel, (level) => {
      if (current()) levels.current.caller = level
    })
    client.on(RTVIEvent.RemoteAudioLevel, (level) => {
      if (current()) levels.current.assistant = level
    })
    client.on(RTVIEvent.BotStartedSpeaking, () => {
      if (current()) setAgent('Speaking')
    })
    client.on(RTVIEvent.BotStoppedSpeaking, () => {
      if (current()) {
        levels.current.assistant = 0
        setAgent('Listening')
      }
    })
    client.on(RTVIEvent.UserStoppedSpeaking, () => {
      if (current()) levels.current.caller = 0
    })
    client.on(RTVIEvent.ServerMessage, (message) => {
      if (!current() || !careEvent(message)) return
      setEvents((previous) => {
        if (previous.some((event) => event.id === message.id)) return previous
        const index = message.payload.turnId
          ? previous.findIndex(
              (event) => event.payload.turnId === message.payload.turnId,
            )
          : -1
        if (index < 0) return [...previous, message]
        if (previous[index].payload.final) return previous
        return previous.map((event, position) =>
          position === index ? message : event,
        )
      })
      const action = (
        {
          availability_check_started: 'Checking availability',
          phone_confirmation_required: 'Awaiting confirmation',
          booking_started: 'Booking appointment',
          cancellation_started: 'Cancelling appointment',
        } as Record<string, string>
      )[message.type]
      if (action || message.payload.state)
        setAgent(action || message.payload.state || 'Listening')
      if (
        message.type === 'phone_confirmed' ||
        message.type === 'tool_failed' ||
        message.type.endsWith('_completed')
      )
        setAgent('Listening')
      callback.current(message)
    })
    connectTimeout.current = setTimeout(() => fail(messages.connect), 35000)
    try {
      await client.initDevices()
      if (!current()) {
        await client.disconnect()
        return
      }
      const mic = client.mediaState.mic
      if (mic.state === 'error') {
        fail(
          mic.reason === 'blocked'
            ? messages.denied
            : mic.reason === 'not-found'
              ? messages.missing
              : mic.reason === 'already-in-use'
                ? messages.busy
                : messages.connect,
        )
        return
      }
      change('connecting')
      await client.connect({ webrtcRequestParams: { endpoint: '/api/offer' } })
      if (!current()) await client.disconnect()
    } catch (cause) {
      const denied =
        cause instanceof Error &&
        /denied|permission|notallowed/i.test(cause.name + ' ' + cause.message)
      fail(denied ? messages.denied : messages.connect)
    }
  }

  async function end() {
    const client = clientRef.current
    if (stateRef.current === 'ending') return
    change('ending')
    if (connectedAt.current && client) {
      setElapsed(Math.floor((Date.now() - connectedAt.current) / 1000))
      try {
        client.sendClientMessage('end-call', {})
        await new Promise((resolve) => setTimeout(resolve, 220))
      } catch {
        /* A lost data channel still needs local cleanup. */
      }
    }
    await release()
    change('ended')
  }

  function toggleMute() {
    const client = clientRef.current
    if (!client) return
    client.enableMic(muted)
    setMuted(!muted)
    levels.current.caller = 0
  }

  return {
    state,
    visible,
    setVisible,
    minimized,
    setMinimized,
    muted,
    error,
    elapsed,
    events,
    agent,
    levels,
    audio,
    start,
    end,
    toggleMute,
  }
}
