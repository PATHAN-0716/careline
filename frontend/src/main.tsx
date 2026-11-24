import { createRoot } from 'react-dom/client'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  AudioLines,
  CalendarCheck,
  CalendarDays,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutDashboard,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Search,
  Stethoscope,
  Sun,
  X,
} from 'lucide-react'
import { MotionConfig } from 'motion/react'
import { useEffect, useState } from 'react'
import { CallPanel, Wave } from './call-panel'
import {
  clock,
  dayKey,
  dayLabel,
  initials,
  isOpen,
  phone,
  request,
  timer,
  type Appointment,
  type CareEvent,
  type DoctorData,
  type Health,
  type Session,
} from './data'
import {
  ActivityList,
  AppointmentTable,
  Brand,
  Drawer,
  Empty,
  ErrorState,
  FilterSearch,
  Loading,
  Status,
  VoiceIcon,
} from './ui'
import { useVoice } from './voice'
import './styles.css'

const nav = [
  { path: '/', title: 'Overview', icon: LayoutDashboard },
  { path: '/doctors', title: 'Doctors', icon: Stethoscope },
  { path: '/appointments', title: 'Appointments', icon: CalendarDays },
  { path: '/activity', title: 'Call activity', icon: Activity },
]
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 20_000 } },
})
const matchAppointment = (row: Appointment, term: string) =>
  [row.reference, row.phone_tail, row.doctor].some((value) =>
    value.toLowerCase().includes(term.trim().toLowerCase()),
  )

function Workspace() {
  const client = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [dark, setDark] = useState(
    () => localStorage.getItem('careline-theme') === 'dark',
  )
  const [command, setCommand] = useState(false)
  const [commandText, setCommandText] = useState('')
  const [highlight, setHighlight] = useState<{
    reference?: string
    slot?: string
    eventId: number | string
  }>()
  const search = new URLSearchParams(location.search)
  const appointmentRef = search.get('appointment')
  const selectedDoctor = search.get('doctor')
  const sessionId = search.get('session')

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => request<Health>('health'),
    refetchInterval: 30000,
  })
  const directory = useQuery({
    queryKey: ['doctors'],
    queryFn: () => request<DoctorData>('doctors'),
  })
  const appointments = useQuery({
    queryKey: ['appointments'],
    queryFn: () => request<Appointment[]>('appointments'),
  })
  const activity = useQuery({
    queryKey: ['activity'],
    queryFn: () => request<CareEvent[]>('activity'),
  })
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => request<Session[]>('sessions'),
  })
  const events = useQuery({
    queryKey: ['sessions', sessionId],
    queryFn: () => request<CareEvent[]>('sessions/' + sessionId + '/events'),
    enabled: Boolean(sessionId),
  })
  const today = health.data?.clinicDate ?? dayKey(new Date())

  function invalidate() {
    for (const key of ['doctors', 'appointments', 'sessions', 'activity'])
      void client.invalidateQueries({ queryKey: [key] })
  }

  function applyEvent(event: CareEvent) {
    if (
      event.type === 'booking_completed' ||
      event.type === 'cancellation_completed'
    ) {
      setHighlight((previous) =>
        previous?.eventId === event.id
          ? previous
          : {
              reference: event.payload.reference,
              slot: event.payload.slot_id,
              eventId: event.id,
            },
      )
    }
    if (
      [
        'booking_completed',
        'cancellation_completed',
        'availability_check_completed',
        'call_connected',
        'call_ended',
      ].includes(event.type)
    )
      invalidate()
  }

  const voice = useVoice(applyEvent)
  useEffect(() => {
    const stream = new EventSource('/api/events')
    stream.onopen = invalidate
    stream.onmessage = (event) =>
      applyEvent(JSON.parse(event.data) as CareEvent)
    return () => stream.close()
  }, [client])
  useEffect(() => {
    if (!highlight) return
    const timeout = setTimeout(() => setHighlight(undefined), 2700)
    return () => clearTimeout(timeout)
  }, [highlight])
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('careline-theme', dark ? 'dark' : 'light')
  }, [dark])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (document.querySelector('.call-panel[aria-modal="true"]')) return
        setCommand((current) => !current)
      }
      if (event.key === 'Escape') setMobileNav(false)
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])

  const hasCall =
    voice.visible && !['ended', 'failed', 'idle'].includes(voice.state)
  const ready = health.data?.voiceConfigured === true
  const callButton = () => {
    if (hasCall) voice.setMinimized(false)
    else void voice.start()
  }
  const callLabel = hasCall ? 'Return to call' : 'Try Call'
  const currentPage =
    nav.find((item) => item.path === location.pathname)?.title ?? 'Overview'
  const openAppointment = (reference: string) =>
    navigate('/appointments?appointment=' + encodeURIComponent(reference))
  const closeDetails = () => navigate(location.pathname, { replace: true })
  const doctorRow = directory.data?.doctors.find(
    (row) => row.id === selectedDoctor,
  )
  const appointment = appointments.data?.find(
    (row) => row.reference === appointmentRef,
  )
  const session = sessions.data?.find((row) => row.id === sessionId)
  const commandTerm = commandText.trim().toLowerCase()
  const commandDoctors = commandTerm
    ? (directory.data?.doctors ?? [])
        .filter((row) =>
          (row.name + ' ' + row.specialty).toLowerCase().includes(commandTerm),
        )
        .slice(0, 5)
    : []
  const commandAppointments = commandTerm
    ? (appointments.data ?? [])
        .filter((row) => matchAppointment(row, commandTerm))
        .slice(0, 5)
    : []
  const commandPages = nav.filter((row) =>
    row.title.toLowerCase().includes(commandTerm),
  )
  const selectCommand = (path: string) => {
    setCommand(false)
    setCommandText('')
    navigate(path)
  }
  const status = ready
    ? 'Voice ready'
    : health.isError
      ? 'Backend offline'
      : health.isPending
        ? 'Checking connection'
        : 'Setup required'

  return (
    <div className={'workspace ' + (collapsed ? 'collapsed' : '')}>
      {mobileNav && (
        <button
          className="mobile-shade"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className={'sidebar ' + (mobileNav ? 'mobile-open' : '')}
        aria-label="Workspace sidebar"
      >
        <div className="side-brand">
          <Link
            to="/"
            aria-label="Careline overview"
            onClick={() => setMobileNav(false)}
          >
            <Brand small={collapsed && !mobileNav} />
          </Link>
          <button
            className="icon-button collapse-button"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
        </div>
        <nav aria-label="Main navigation">
          {nav.map(({ path, title, icon: Icon }) => (
            <NavLink
              to={path}
              end={path === '/'}
              key={path}
              title={title}
              onClick={() => setMobileNav(false)}
            >
              <Icon size={18} strokeWidth={1.85} />
              <span>{title}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            onClick={() => setDark(!dark)}
            title={dark ? 'Light theme' : 'Dark theme'}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
            <span>{dark ? 'Light theme' : 'Dark theme'}</span>
          </button>
          <div className="side-status">
            <span className={'connection-dot ' + (ready ? 'ready' : '')} />
            <span>{status}</span>
          </div>
          <div className="workspace-indicator">
            <span>C</span>
            <div>
              <strong>Demo workspace</strong>
              <small>Careline</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-button"
              aria-label="Open navigation"
              aria-expanded={mobileNav}
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{currentPage}</strong>
          </div>
          <div className="top-actions">
            <button
              className="quick-search"
              onClick={() => setCommand(true)}
              aria-label="Quick search"
            >
              <Search size={17} />
              <span>Quick search</span>
              <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd>
            </button>
            <span className="top-status">
              <i className={'connection-dot ' + (ready ? 'ready' : '')} />
              {status}
            </span>
            <button
              className="primary"
              disabled={!ready && !hasCall}
              title={ready ? undefined : status}
              onClick={callButton}
            >
              <Phone size={15} />
              {callLabel}
            </button>
          </div>
        </header>
        <main id="content">
          <Routes>
            <Route
              path="/"
              element={
                <Overview
                  directory={directory.data}
                  appointments={appointments.data ?? []}
                  events={activity.data ?? []}
                  today={today}
                  ready={ready}
                  status={status}
                  onCall={callButton}
                  callLabel={callLabel}
                  hasCall={hasCall}
                  loading={directory.isPending || appointments.isPending}
                  error={directory.isError || appointments.isError}
                  retry={invalidate}
                  select={openAppointment}
                  highlight={highlight}
                />
              }
            />
            <Route
              path="/doctors"
              element={
                <Doctors
                  data={directory.data}
                  loading={directory.isPending}
                  error={directory.isError}
                  retry={invalidate}
                  select={(id) => navigate('/doctors?doctor=' + id)}
                />
              }
            />
            <Route
              path="/appointments"
              element={
                <Appointments
                  rows={appointments.data ?? []}
                  doctors={directory.data?.doctors ?? []}
                  today={today}
                  loading={appointments.isPending}
                  error={appointments.isError}
                  retry={invalidate}
                  select={openAppointment}
                  highlight={highlight?.reference}
                />
              }
            />
            <Route
              path="/activity"
              element={
                <CallActivity
                  sessions={sessions.data ?? []}
                  loading={sessions.isPending}
                  error={sessions.isError}
                  retry={invalidate}
                  select={(id) => navigate('/activity?session=' + id)}
                />
              }
            />
            <Route
              path="*"
              element={
                <Empty
                  title="Page not found"
                  detail="Use the sidebar to return to the workspace."
                />
              }
            />
          </Routes>
        </main>
      </div>
      {doctorRow && (
        <Drawer
          title={doctorRow.name}
          description={doctorRow.specialty + ' · Fictional demo profile'}
          close={closeDetails}
        >
          <DoctorSchedule
            slots={(directory.data?.slots ?? []).filter(
              (slot) => slot.doctor_id === doctorRow.id,
            )}
            today={today}
          />
        </Drawer>
      )}
      {appointment && (
        <Drawer
          title={appointment.reference}
          description={appointment.doctor}
          close={closeDetails}
        >
          <AppointmentDetails row={appointment} />
        </Drawer>
      )}
      {session && (
        <Drawer
          title="Call details"
          description={session.id.slice(0, 10).toUpperCase()}
          close={closeDetails}
        >
          <dl className="details">
            <dt>Outcome</dt>
            <dd className="capitalize">{session.outcome}</dd>
            <dt>Caller</dt>
            <dd>{phone(session.phone_tail)}</dd>
            <dt>Duration</dt>
            <dd>{sessionDuration(session)}</dd>
          </dl>
          {events.isPending ? (
            <Loading />
          ) : events.isError ? (
            <ErrorState retry={() => void events.refetch()} />
          ) : (
            <>
              <h3>Actions</h3>
              <ActivityList events={events.data ?? []} />
              <h3>Transcript</h3>
              {events.data
                ?.filter((event) => event.type === 'transcript')
                .map((event) => (
                  <div className="turn" key={event.id}>
                    <div>
                      <strong>
                        {event.payload.speaker === 'caller'
                          ? 'Caller'
                          : 'Assistant'}
                      </strong>
                      <time>{clock(event.timestamp)}</time>
                    </div>
                    <p>{event.payload.text}</p>
                  </div>
                ))}
            </>
          )}
        </Drawer>
      )}
      <Dialog.Root
        open={command}
        onOpenChange={(open) => {
          setCommand(open)
          if (!open) setCommandText('')
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="command">
            <div className="command-heading">
              <Dialog.Title>Quick search</Dialog.Title>
              <Dialog.Close className="icon-button" aria-label="Close search">
                <X size={18} />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Find pages, doctors and appointments.
            </Dialog.Description>
            <FilterSearch
              value={commandText}
              onChange={setCommandText}
              placeholder="Search pages, doctors or appointments"
            />
            <div className="command-results">
              {commandPages.map(({ title, path, icon: Icon }) => (
                <button key={path} onClick={() => selectCommand(path)}>
                  <Icon size={17} />
                  {title}
                  <ArrowRight size={15} />
                </button>
              ))}
              {commandDoctors.map((row) => (
                <button
                  key={row.id}
                  onClick={() => selectCommand('/doctors?doctor=' + row.id)}
                >
                  <Stethoscope size={17} />
                  {row.name}
                  <small>{row.specialty}</small>
                </button>
              ))}
              {commandAppointments.map((row) => (
                <button
                  key={row.reference}
                  onClick={() =>
                    selectCommand('/appointments?appointment=' + row.reference)
                  }
                >
                  <CalendarDays size={17} />
                  {row.reference}
                  <small>{row.doctor}</small>
                </button>
              ))}
              {!commandPages.length &&
                !commandDoctors.length &&
                !commandAppointments.length && (
                  <p className="muted">No results match your search.</p>
                )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <CallPanel voice={voice} select={openAppointment} />
    </div>
  )
}

function PageHeader({
  title,
  sub,
  children,
}: {
  title: string
  sub: string
  children?: React.ReactNode
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {children}
    </header>
  )
}

function Overview({
  directory,
  appointments,
  events,
  today,
  ready,
  status,
  onCall,
  callLabel,
  hasCall,
  loading,
  error,
  retry,
  select,
  highlight,
}: {
  directory?: DoctorData
  appointments: Appointment[]
  events: CareEvent[]
  today: string
  ready: boolean
  status: string
  onCall: () => void
  callLabel: string
  hasCall: boolean
  loading: boolean
  error: boolean
  retry: () => void
  select: (ref: string) => void
  highlight?: { reference?: string; slot?: string }
}) {
  const [term, setTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [scheduleOffset, setScheduleOffset] = useState(0)
  const date = new Date(today + 'T12:00:00+05:30')
  date.setUTCDate(date.getUTCDate() + scheduleOffset)
  const slots = directory?.slots ?? []
  const openSlots = slots.filter(isOpen)
  const metrics = [
    {
      label: 'Available doctors',
      value: new Set(openSlots.map((slot) => slot.doctor_id)).size,
      icon: Stethoscope,
      tone: 'green',
    },
    {
      label: 'Open slots',
      value: openSlots.length,
      icon: Clock3,
      tone: 'sand',
    },
    {
      label: 'Confirmed',
      value: appointments.filter((row) => row.status === 'confirmed').length,
      icon: CalendarCheck,
      tone: 'green',
    },
    {
      label: 'Cancelled',
      value: appointments.filter((row) => row.status === 'cancelled').length,
      icon: CalendarX,
      tone: 'rose',
    },
  ]
  const schedule = slots.filter(
    (slot) => dayKey(slot.starts_at) === dayKey(date),
  )
  const upcomingSlots = schedule.filter(
    (slot) => Date.parse(slot.starts_at) > Date.now(),
  )
  const visibleSchedule = [
    ...upcomingSlots,
    ...schedule.filter((slot) => Date.parse(slot.starts_at) <= Date.now()),
  ]
  return (
    <>
      <PageHeader
        title="Appointment overview"
        sub="Intelligent appointment assistance."
      >
        <span className="date-chip">
          <CalendarDays size={16} />
          {dayLabel(today + 'T12:00:00+05:30')}
        </span>
      </PageHeader>
      {error && <ErrorState retry={retry} />}
      {loading ? (
        <Loading />
      ) : (
        <div className="metrics">
          {metrics.map(({ label, value, icon: Icon, tone }) => (
            <div className="metric surface" key={label}>
              <span className={'metric-icon ' + tone}>
                <Icon size={18} />
              </span>
              <div>
                <small>{label}</small>
                <strong className="mono">{error ? '—' : value}</strong>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="overview-grid">
        <section
          className="assistant-feature"
          aria-labelledby="assistant-title"
        >
          <div className="assistant-content">
            <VoiceIcon />
            <div className="assistant-name">
              <h2 id="assistant-title">Careline Assistant</h2>
              <span>
                <i className={'connection-dot ' + (ready ? 'ready' : '')} />
                {status}
              </span>
            </div>
            <p>
              {status === 'Setup required'
                ? 'Configure ElevenLabs and Gemini on the backend to start a voice call.'
                : 'Check availability, book a visit, or cancel an appointment by voice.'}
            </p>
            <button
              className="primary feature-button"
              disabled={!ready && !hasCall}
              onClick={onCall}
            >
              <Phone size={16} />
              {hasCall ? callLabel : 'Start voice call'}
              <ArrowDownRight size={16} />
            </button>
            <div className="capabilities">
              <span>
                <Search size={14} />
                Availability
              </span>
              <span>
                <CalendarCheck size={14} />
                Booking
              </span>
              <span>
                <CalendarX size={14} />
                Cancellation
              </span>
            </div>
          </div>
          <div className="signal-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="signal-center">
              <Wave />
            </div>
          </div>
        </section>
        <section className="surface schedule-panel">
          <div className="section-head">
            <div>
              <h2>{scheduleOffset ? 'Schedule' : 'Today’s schedule'}</h2>
              <p>{dayLabel(date)} · IST</p>
            </div>
            <div className="schedule-nav">
              <button
                className="icon-button"
                aria-label="Previous day"
                disabled={scheduleOffset <= 0}
                onClick={() => setScheduleOffset(scheduleOffset - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Next day"
                disabled={scheduleOffset >= 13}
                onClick={() => setScheduleOffset(scheduleOffset + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          {loading ? (
            <Loading />
          ) : !schedule.length ? (
            <Empty title="No slots scheduled" />
          ) : (
            <ul
              className="schedule-list"
              aria-label="Clinic slots"
              tabIndex={0}
            >
              {visibleSchedule.map((slot) => (
                <li
                  key={slot.id}
                  className={highlight?.slot === slot.id ? 'highlight' : ''}
                >
                  <time>{clock(slot.starts_at)}</time>
                  <Link to={'/doctors?doctor=' + slot.doctor_id}>
                    <strong>{slot.doctor}</strong>
                    <small>{slot.specialty}</small>
                  </Link>
                  {slot.reference ? (
                    <button
                      className="text-button slot-booked"
                      onClick={() => select(slot.reference!)}
                    >
                      Booked
                    </button>
                  ) : (
                    <span
                      className={'slot-status ' + (isOpen(slot) ? 'open' : '')}
                    >
                      {isOpen(slot) ? 'Open' : 'Past'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="overview-grid lower-grid">
        <section className="surface">
          <div className="section-head">
            <div>
              <h2>Recent appointments</h2>
              <p>Bookings and cancellations made by voice.</p>
            </div>
            <Link className="text-button" to="/appointments">
              View all <ArrowRight size={15} />
            </Link>
          </div>
          <div className="filters inline-filters">
            <FilterSearch
              value={term}
              onChange={setTerm}
              placeholder="Search appointments"
            />
            <select
              aria-label="Appointment status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          {loading ? (
            <Loading />
          ) : (
            <AppointmentTable
              rows={appointments
                .filter(
                  (row) =>
                    matchAppointment(row, term) &&
                    (!statusFilter || row.status === statusFilter),
                )
                .slice(0, 6)}
              onSelect={select}
              highlight={highlight?.reference}
            />
          )}
        </section>
        <section className="surface">
          <div className="section-head">
            <div>
              <h2>Live activity</h2>
              <p>Recent call and appointment events.</p>
            </div>
            <Link
              className="icon-button"
              aria-label="Open call activity"
              to="/activity"
            >
              <ArrowRight size={17} />
            </Link>
          </div>
          <ActivityList events={events.slice(0, 7)} />
        </section>
      </div>
    </>
  )
}

function Doctors({
  data,
  loading,
  error,
  retry,
  select,
}: {
  data?: DoctorData
  loading: boolean
  error: boolean
  retry: () => void
  select: (id: string) => void
}) {
  const [term, setTerm] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [availability, setAvailability] = useState('')
  const rows = (data?.doctors ?? []).map((doctor) => ({
    ...doctor,
    slots: (data?.slots ?? []).filter(
      (slot) => slot.doctor_id === doctor.id && isOpen(slot),
    ),
  }))
  const filtered = rows.filter(
    (doctor) =>
      doctor.name.toLowerCase().includes(term.trim().toLowerCase()) &&
      (!specialty || doctor.specialty === specialty) &&
      (!availability ||
        (availability === 'open' ? doctor.slots.length : !doctor.slots.length)),
  )
  return (
    <>
      <PageHeader
        title="Doctors"
        sub="Browse the directory and upcoming availability."
      />
      <div className="filters">
        <FilterSearch
          value={term}
          onChange={setTerm}
          placeholder="Search doctor names"
        />
        <select
          value={specialty}
          aria-label="Specialty"
          onChange={(event) => setSpecialty(event.target.value)}
        >
          <option value="">All specialties</option>
          {rows.map((row) => (
            <option key={row.specialty}>{row.specialty}</option>
          ))}
        </select>
        <select
          value={availability}
          aria-label="Availability"
          onChange={(event) => setAvailability(event.target.value)}
        >
          <option value="">Any availability</option>
          <option value="open">Open slots</option>
          <option value="full">Fully booked</option>
        </select>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState retry={retry} />
      ) : !filtered.length ? (
        <Empty
          title="No doctors match"
          detail="Try another name or adjust the filters."
        />
      ) : (
        <div className="doctor-grid">
          {filtered.map((doctor, index) => (
            <button
              className="surface doctor-card"
              key={doctor.id}
              onClick={() => select(doctor.id)}
            >
              <div className="doctor-top">
                <span className={'doctor-avatar tone-' + (index % 3)}>
                  {initials(doctor.name)}
                </span>
                <ChevronRight size={18} />
              </div>
              <h2>{doctor.name}</h2>
              <p>{doctor.specialty}</p>
              <div className="doctor-foot">
                <span>
                  <i
                    className={
                      'connection-dot ' + (doctor.slots.length ? 'ready' : '')
                    }
                  />
                  {doctor.slots.length} open slots
                </span>
                <small>
                  {doctor.slots[0]
                    ? 'Next · ' +
                      dayLabel(doctor.slots[0].starts_at) +
                      ', ' +
                      clock(doctor.slots[0].starts_at)
                    : 'No upcoming slots'}
                </small>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function DoctorSchedule({
  slots,
  today,
}: {
  slots: DoctorData['slots']
  today: string
}) {
  const [day, setDay] = useState(today)
  const dates = [...new Set(slots.map((slot) => dayKey(slot.starts_at)))].sort()
  const rows = slots.filter((slot) => dayKey(slot.starts_at) === day)
  const upcoming = slots.filter(
    (slot) => slot.reference && Date.parse(slot.starts_at) >= Date.now(),
  )
  return (
    <>
      <div className="drawer-section">
        <h3>Clinic schedule</h3>
        <select
          aria-label="Schedule date"
          value={day}
          onChange={(event) => setDay(event.target.value)}
        >
          {dates.map((value) => (
            <option key={value} value={value}>
              {dayLabel(value + 'T12:00:00+05:30')}
            </option>
          ))}
        </select>
        {rows.length ? (
          <ul className="drawer-slots">
            {rows.map((slot) => (
              <li key={slot.id}>
                <time>{clock(slot.starts_at)}</time>
                <span className={'slot-status ' + (isOpen(slot) ? 'open' : '')}>
                  {slot.reference
                    ? 'Booked'
                    : isOpen(slot)
                      ? 'Available'
                      : 'Unavailable'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No slots on this date" />
        )}
        <h3>Upcoming booked visits</h3>
        {upcoming.length ? (
          <ul className="drawer-slots">
            {upcoming.map((slot) => (
              <li key={slot.id}>
                <span>
                  {dayLabel(slot.starts_at)} · {clock(slot.starts_at)}
                </span>
                <span className="mono">{slot.reference}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No upcoming booked visits.</p>
        )}
      </div>
    </>
  )
}

function AppointmentDetails({ row }: { row: Appointment }) {
  return (
    <>
      <Status value={row.status} />
      <dl className="details">
        <dt>Specialty</dt>
        <dd>{row.specialty}</dd>
        <dt>Scheduled</dt>
        <dd>
          {dayLabel(row.starts_at)} · {clock(row.starts_at)} IST
        </dd>
        <dt>Caller</dt>
        <dd>{phone(row.phone_tail)}</dd>
        <dt>Created</dt>
        <dd>
          {dayLabel(row.created_at)} · {clock(row.created_at)}
        </dd>
        {row.cancelled_at && (
          <>
            <dt>Cancelled</dt>
            <dd>
              {dayLabel(row.cancelled_at)} · {clock(row.cancelled_at)}
            </dd>
          </>
        )}
      </dl>
    </>
  )
}

function Appointments({
  rows,
  doctors,
  today,
  loading,
  error,
  retry,
  select,
  highlight,
}: {
  rows: Appointment[]
  doctors: DoctorData['doctors']
  today: string
  loading: boolean
  error: boolean
  retry: () => void
  select: (ref: string) => void
  highlight?: string
}) {
  const [mode, setMode] = useState<'list' | 'calendar'>('list')
  const [term, setTerm] = useState('')
  const [doctor, setDoctor] = useState('')
  const [status, setStatus] = useState('')
  const [date, setDate] = useState('')
  const [week, setWeek] = useState(0)
  const rowsFiltered = rows.filter(
    (row) =>
      matchAppointment(row, term) &&
      (!doctor || row.doctor_id === doctor) &&
      (!status || row.status === status) &&
      (!date || dayKey(row.starts_at) === date),
  )
  const start = new Date((date || today) + 'T12:00:00+05:30')
  start.setUTCDate(
    start.getUTCDate() - ((start.getUTCDay() + 6) % 7) + week * 7,
  )
  const columns = Array.from(
    { length: 7 },
    (_, index) => new Date(start.getTime() + index * 86400000),
  )
  return (
    <>
      <PageHeader
        title="Appointments"
        sub="Review booked and cancelled visits."
      >
        <div className="segmented">
          <button
            aria-pressed={mode === 'list'}
            onClick={() => setMode('list')}
          >
            List
          </button>
          <button
            aria-pressed={mode === 'calendar'}
            onClick={() => setMode('calendar')}
          >
            Calendar
          </button>
        </div>
      </PageHeader>
      <div className="filters">
        <FilterSearch
          value={term}
          onChange={setTerm}
          placeholder="Search reference or phone digits"
        />
        <select
          aria-label="Doctor"
          value={doctor}
          onChange={(event) => setDoctor(event.target.value)}
        >
          <option value="">All doctors</option>
          {doctors.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input
          aria-label="Filter date"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value)
            setWeek(0)
          }}
        />
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState retry={retry} />
      ) : (
        <section className="surface">
          {mode === 'list' ? (
            <AppointmentTable
              rows={rowsFiltered}
              onSelect={select}
              highlight={highlight}
            />
          ) : (
            <>
              <div className="section-head">
                <div>
                  <h2>
                    {dayLabel(columns[0])} – {dayLabel(columns[6])}
                  </h2>
                  <p>Weekly schedule · IST</p>
                </div>
                <div className="schedule-nav">
                  <button
                    className="icon-button"
                    aria-label="Previous week"
                    onClick={() => {
                      setDate('')
                      setWeek(
                        date
                          ? Math.round(
                              (columns[0].getTime() -
                                new Date(today + 'T12:00:00+05:30').getTime()) /
                                604800000,
                            ) - 1
                          : week - 1,
                      )
                    }}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next week"
                    onClick={() => {
                      setDate('')
                      setWeek(
                        date
                          ? Math.round(
                              (columns[0].getTime() -
                                new Date(today + 'T12:00:00+05:30').getTime()) /
                                604800000,
                            ) + 1
                          : week + 1,
                      )
                    }}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
              <div className="calendar-grid">
                {columns.map((value) => {
                  const day = dayKey(value)
                  const daily = rowsFiltered
                    .filter((row) => dayKey(row.starts_at) === day)
                    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                  return (
                    <div
                      key={day}
                      className={day === today ? 'current-day' : ''}
                    >
                      <h3>{dayLabel(value)}</h3>
                      {daily.length ? (
                        daily.map((row) => (
                          <button
                            className={
                              'calendar-item ' +
                              row.status +
                              (highlight === row.reference ? ' highlight' : '')
                            }
                            key={row.reference}
                            onClick={() => select(row.reference)}
                          >
                            <strong>{clock(row.starts_at)}</strong>
                            <span>{row.doctor}</span>
                            <small>{row.status}</small>
                          </button>
                        ))
                      ) : (
                        <small className="muted">No visits</small>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </section>
      )}
    </>
  )
}

function sessionDuration(session: Session) {
  if (!session.connected_at) return '—'
  return timer(
    Math.max(
      0,
      Math.floor(
        ((session.ended_at ? Date.parse(session.ended_at) : Date.now()) -
          Date.parse(session.connected_at)) /
          1000,
      ),
    ),
  )
}

function CallActivity({
  sessions,
  loading,
  error,
  retry,
  select,
}: {
  sessions: Session[]
  loading: boolean
  error: boolean
  retry: () => void
  select: (id: string) => void
}) {
  return (
    <>
      <PageHeader
        title="Call activity"
        sub="Review voice sessions and their scheduling actions."
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState retry={retry} />
      ) : (
        <section className="surface session-list">
          {!sessions.length ? (
            <Empty
              icon={<AudioLines size={21} />}
              title="No calls yet"
              detail="Start a voice call to create a session."
            />
          ) : (
            sessions.map((session) => (
              <button key={session.id} onClick={() => select(session.id)}>
                <span className="event-icon">
                  <Phone size={17} />
                </span>
                <span>
                  <strong>Call {session.id.slice(0, 8).toUpperCase()}</strong>
                  <small>
                    {dayLabel(session.started_at)} · {clock(session.started_at)}
                  </small>
                </span>
                <span>{phone(session.phone_tail)}</span>
                <span className="mono">{sessionDuration(session)}</span>
                <span>
                  {session.action_count}{' '}
                  {session.action_count === 1 ? 'action' : 'actions'}
                </span>
                <span className="capitalize">{session.outcome}</span>
                <ChevronRight size={17} />
              </button>
            ))
          )}
        </section>
      )}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <Workspace />
      </MotionConfig>
    </BrowserRouter>
  </QueryClientProvider>,
)
