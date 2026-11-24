# Careline interview guide

## Trace one booking

1. The browser requests microphone permission and negotiates a peer connection with FastAPI. Pipecat’s SmallWebRTC transport handles audio and the RTVI data channel.
2. ElevenLabs Scribe produces interim and final transcripts. Silero supplies speech boundaries. A phone confirmation processor intercepts identity turns before they reach Gemini.
3. The server normalizes a spoken candidate, reads the digits through ElevenLabs TTS, waits for playback completion, and requires an explicit affirmative turn. Correcting the number invalidates the previous confirmation. Gemini receives a confirmation signal and resumes the pending scheduling request.
4. Gemini invokes the registered booking tool with an offered slot ID. The handler validates the schema and takes the caller identity from the call session.
5. SQLite checks the slot inside a write transaction. A partial unique index limits each slot to one confirmed booking. The appointment and dashboard event commit together.
6. The tool sends the committed result to Gemini and a structured event to the browser. ElevenLabs speaks Gemini’s response. The call displays the ticket and TanStack Query refreshes surrounding panels. SSE gives an independent dashboard tab the same committed change.

## Explain the choices

- Pipecat handles streaming media, voice events, turn-taking, service adapters, and native function calls. The application owns scheduling rules and durable data.
- SmallWebRTC supports local peer-to-peer calls with no hosted SFU. Local browser permissions and provider credentials still apply. NAT traversal is a separate concern if hosting remotely.
- A keyed digest allows repeat calls to match earlier bookings without storing the complete phone number. Confirming a number demonstrates the assessment’s identification rule.
- Cancellation preserves appointment history. Multiple matches make the caller pick a visit; the server applies the identity check again against that reference.
- The waveform uses local and remote audio-level events emitted by the browser transport. A requestAnimationFrame loop applies smoothing without re-rendering the call panel on every sample.
- Queries provide authoritative recovery after reconnect. Call-specific transcript data travels separately from the shared workspace activity stream.
