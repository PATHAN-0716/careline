export type Doctor = { id: string; name: string; specialty: string }
export type Slot = {
  id: string
  doctor_id: string
  doctor: string
  specialty: string
  starts_at: string
  available: number
  reference: string | null
}
export type Appointment = {
  reference: string
  doctor_id: string
  doctor: string
  specialty: string
  starts_at: string
  phone_tail: string
  status: 'confirmed' | 'cancelled'
  created_at: string
  cancelled_at: string | null
  slot_id: string
}
export type Session = {
  id: string
  started_at: string
  connected_at: string | null
  ended_at: string | null
  outcome: string
  phone_tail: string | null
  action_count: number
}
type Payload = Partial<Appointment> & {
  outcome?: string
  actionId?: string
  state?: string
  slots?: Slot[]
  date?: string
  speaker?: 'caller' | 'assistant'
  turnId?: string
  text?: string
  final?: boolean
  code?: string
}
export type CareEvent = {
  id: number | string
  sessionId: string
  timestamp: string
  type: string
  payload: Payload
}
export type DoctorData = { doctors: Doctor[]; slots: Slot[] }
export type Health = {
  voiceConfigured: boolean
  clinicDate: string
  timezone: string
}

export async function request<T>(path: string): Promise<T> {
  const response = await fetch('/api/' + path)
  if (!response.ok) throw new Error('Careline could not load this data.')
  return response.json()
}

const zone = 'Asia/Kolkata'
const dateKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: zone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const dateLabelFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: zone,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})
const timeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: zone,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})
export const dayKey = (value: string | Date) => {
  const parts = Object.fromEntries(
    dateKeyFormat
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  )
  return [parts.year, parts.month, parts.day].join('-')
}
export const dayLabel = (value: string | Date) =>
  dateLabelFormat.format(new Date(value))
export const clock = (value: string) => timeFormat.format(new Date(value))
export const phone = (tail?: string | null) => (tail ? '•••• ' + tail : '—')
export const isOpen = (slot: Slot) =>
  Boolean(slot.available) && Date.parse(slot.starts_at) > Date.now()
export const initials = (name: string) =>
  name
    .replace(/^Dr\. /, '')
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
export const timer = (seconds: number) =>
  [Math.floor(seconds / 60), seconds % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
export const labels: Record<string, string> = {
  call_connected: 'Voice call connected',
  call_ended: 'Call ended',
  availability_check_started: 'Checking availability',
  availability_check_completed: 'Availability checked',
  booking_started: 'Booking appointment',
  booking_completed: 'Appointment booked',
  cancellation_started: 'Cancelling appointment',
  cancellation_completed: 'Appointment cancelled',
  phone_confirmation_required: 'Awaiting verbal confirmation',
  phone_confirmed: 'Phone confirmed',
  tool_failed: 'Action needs attention',
}
export const failures: Record<string, string> = {
  phone_required: 'A spoken phone number is required.',
  slot_conflict: 'That slot was just booked. Check availability again.',
  slot_unavailable: 'That slot is unavailable.',
  select_appointment: 'Several appointments match. Choose one verbally.',
  appointment_not_found: 'No upcoming appointment matches this caller.',
  invalid_arguments: 'The request needs clarification.',
  scheduling_unavailable: 'Scheduling is temporarily unavailable.',
}
