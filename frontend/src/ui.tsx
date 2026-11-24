import * as Dialog from '@radix-ui/react-dialog'
import {
  Activity,
  AudioLines,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Phone,
  Search,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
  clock,
  dayLabel,
  labels,
  phone,
  type Appointment,
  type CareEvent,
} from './data'

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-icon">
        <Activity size={20} strokeWidth={2.4} />
      </span>
      {!small && <span>Careline</span>}
    </span>
  )
}

export function Empty({
  title,
  detail,
  icon = <CalendarDays size={21} />,
}: {
  title: string
  detail?: string
  icon?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
    </div>
  )
}

export function Loading() {
  return (
    <div className="loading" role="status" aria-label="Loading workspace">
      <span />
      <span />
      <span />
    </div>
  )
}

export function ErrorState({ retry }: { retry: () => void }) {
  return (
    <div className="notice" role="alert">
      <CircleAlert size={18} />
      <span>Careline could not reach the backend.</span>
      <button className="quiet" onClick={retry}>
        Retry
      </button>
    </div>
  )
}

export function Status({ value }: { value: Appointment['status'] }) {
  return (
    <span className={'status ' + value}>
      <i />
      {value === 'confirmed' ? 'Confirmed' : 'Cancelled'}
    </span>
  )
}

export function FilterSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="search-input">
      <Search size={16} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </label>
  )
}

export function Drawer({
  title,
  description,
  close,
  children,
}: {
  title: string
  description: string
  close: () => void
  children: ReactNode
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="drawer">
          <div className="drawer-head">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close details">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function AppointmentTable({
  rows,
  onSelect,
  highlight,
}: {
  rows: Appointment[]
  onSelect: (reference: string) => void
  highlight?: string
}) {
  if (!rows.length)
    return (
      <Empty
        title="No appointments found"
        detail="Appointments booked through Careline will appear here."
      />
    )
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Doctor</th>
            <th>Schedule</th>
            <th>Caller</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.reference}
              className={highlight === row.reference ? 'highlight' : ''}
            >
              <td>
                <button
                  className="text-button mono"
                  onClick={() => onSelect(row.reference)}
                >
                  {row.reference}
                </button>
              </td>
              <td>
                <strong>{row.doctor}</strong>
                <small>{row.specialty}</small>
              </td>
              <td>
                {dayLabel(row.starts_at)}
                <small>{clock(row.starts_at)}</small>
              </td>
              <td className="caller-cell">{phone(row.phone_tail)}</td>
              <td>
                <Status value={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mobile-appointments">
        {rows.map((row) => (
          <button
            key={row.reference}
            onClick={() => onSelect(row.reference)}
            className={highlight === row.reference ? 'highlight' : ''}
          >
            <span>
              <strong>{row.doctor}</strong>
              <small>
                {dayLabel(row.starts_at)} · {clock(row.starts_at)}
              </small>
              <small className="mono">
                {row.reference} · {phone(row.phone_tail)}
              </small>
            </span>
            <Status value={row.status} />
          </button>
        ))}
      </div>
    </div>
  )
}

export function ActivityList({ events }: { events: CareEvent[] }) {
  const feed = events.filter((event) => labels[event.type])
  if (!feed.length)
    return (
      <Empty
        icon={<Activity size={20} />}
        title="No activity yet"
        detail="Call and appointment updates will appear here."
      />
    )
  return (
    <ol className="activity-list">
      {feed.map((event) => {
        const Icon = event.type.startsWith('call')
          ? Phone
          : event.type.startsWith('availability')
            ? Search
            : event.type.endsWith('completed')
              ? CheckCircle2
              : event.type === 'phone_confirmed'
                ? Check
                : Clock3
        const detail =
          event.payload.doctor ||
          event.payload.slots?.[0]?.doctor ||
          event.payload.reference
        return (
          <li key={event.id}>
            <span className="event-icon">
              <Icon size={15} />
            </span>
            <span>
              <strong>{labels[event.type]}</strong>
              {detail && <small>{detail}</small>}
            </span>
            <time>{clock(event.timestamp)}</time>
          </li>
        )
      })}
    </ol>
  )
}

export function VoiceIcon() {
  return (
    <span className="voice-icon">
      <AudioLines size={23} />
    </span>
  )
}
