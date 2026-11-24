import { expect, test, type Page } from '@playwright/test'

const stamp = new Date().toISOString()
const appointment = {
  reference: 'CL-FIXTURE01',
  doctor_id: 'anika',
  doctor: 'Dr. Anika Rao',
  specialty: 'General Medicine',
  starts_at: new Date(Date.now() + 86400000).toISOString(),
  phone_tail: '3210',
  status: 'confirmed',
  created_at: stamp,
  cancelled_at: null,
  slot_id: 'demo-slot',
}

async function setup(page: Page, denied = false) {
  let booked = false
  let slotUpdates = 0
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/doctors') slotUpdates++
    const values: Record<string, unknown> = {
      '/api/health': {
        voiceConfigured: true,
        clinicDate: stamp.slice(0, 10),
        timezone: 'Asia/Kolkata',
      },
      '/api/doctors': {
        doctors: [
          {
            id: 'anika',
            name: appointment.doctor,
            specialty: appointment.specialty,
          },
        ],
        slots: [
          {
            id: 'demo-slot',
            doctor_id: 'anika',
            doctor: appointment.doctor,
            specialty: appointment.specialty,
            starts_at: appointment.starts_at,
            available: booked ? 0 : 1,
            reference: booked ? appointment.reference : null,
          },
        ],
      },
      '/api/appointments': booked ? [appointment] : [],
      '/api/activity': [],
      '/api/sessions': [],
    }
    if (path === '/api/events') {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: ': fixture\n\n',
      })
      return
    }
    await route.fulfill({ json: values[path] ?? [] })
  })
  await page.route(
    (url) =>
      url.pathname.endsWith('/@pipecat-ai_client-js.js') &&
      !url.searchParams.has('careline-original'),
    async (route) => {
      const original = new URL(route.request().url())
      original.searchParams.set('careline-original', '1')
      await route.fulfill({
        contentType: 'application/javascript',
        body: `
        import { RTVIEvent } from ${JSON.stringify(original.pathname + original.search)};
        export * from ${JSON.stringify(original.pathname + original.search)};
        export class PipecatClient {
          handlers = new Map();
          mediaState = { mic: { state: 'granted' } };
          on(event, callback) { this.handlers.set(event, callback); }
          async initDevices() {
            if (${denied}) throw new DOMException('Microphone denied', 'NotAllowedError');
          }
          async connect() {
            window.carelineFixture = this;
            this.handlers.get(RTVIEvent.BotReady)?.();
          }
          async disconnect() { window.carelineDisconnected = true; }
          enableMic(value) { window.carelineMicEnabled = value; }
          sendClientMessage() {}
          message(value) { this.handlers.get(RTVIEvent.ServerMessage)?.(value); }
        }
      `,
      })
    },
  )
  await page.goto('/')
  return {
    book: () => {
      booked = true
    },
    refreshes: () => slotUpdates,
  }
}

type Fixture = Window & {
  carelineFixture?: { message: (value: unknown) => void }
  carelineDisconnected?: boolean
  carelineMicEnabled?: boolean
}
async function message(
  page: Page,
  id: number,
  type: string,
  payload: Record<string, unknown>,
) {
  await page.evaluate(
    (event) => (window as Fixture).carelineFixture?.message(event),
    {
      id,
      type,
      payload,
      sessionId: 'fixture',
      timestamp: stamp,
    },
  )
}

test('voice UI handles transcript replacement, booking, mute, minimize and end', async ({
  page,
}) => {
  const api = await setup(page)
  await page.getByRole('button', { name: 'Try Call', exact: true }).click()
  const call = page.getByRole('complementary', { name: 'Careline voice call' })
  await expect(call.getByText('Caller · Connected')).toBeVisible()
  await message(page, 1, 'transcript', {
    speaker: 'caller',
    turnId: '1',
    text: 'Check available',
    final: false,
  })
  await expect(call.getByText('Check available', { exact: true })).toBeVisible()
  await message(page, 2, 'transcript', {
    speaker: 'caller',
    turnId: '1',
    text: 'Check availability tomorrow',
    final: true,
  })
  await expect(
    call.getByText('Check availability tomorrow', { exact: true }),
  ).toBeVisible()
  await expect(call.getByText('Check available', { exact: true })).toHaveCount(
    0,
  )
  const before = api.refreshes()
  api.book()
  await message(page, 3, 'booking_completed', appointment)
  await expect(call.getByText('Appointment booked')).toBeVisible()
  await expect(
    page
      .getByRole('main')
      .getByRole('button', { name: appointment.reference, exact: true }),
  ).toBeVisible()
  expect(api.refreshes()).toBeGreaterThan(before)
  await call.getByRole('button', { name: 'Mute microphone' }).click()
  expect(
    await page.evaluate(() => (window as Fixture).carelineMicEnabled),
  ).toBe(false)
  if (process.env.CARELINE_SCREENSHOTS)
    await page.screenshot({
      path: '../docs/screenshots/booking-ui-fixture.png',
      animations: 'disabled',
    })
  await call.getByRole('button', { name: 'Minimize call' }).click()
  await page.getByRole('button', { name: /Careline Assistant/ }).click()
  await call.getByRole('button', { name: 'End call' }).click()
  await expect(
    call.getByRole('heading', { name: 'Call summary' }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => (window as Fixture).carelineDisconnected),
  ).toBe(true)
  if (process.env.CARELINE_SCREENSHOTS)
    await page.screenshot({
      path: '../docs/screenshots/summary-ui-fixture.png',
      animations: 'disabled',
    })
})

test('microphone permission failure is actionable', async ({ page }) => {
  await setup(page, true)
  await page.getByRole('button', { name: 'Try Call', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Microphone access was denied.',
  )
  await expect(
    page.getByRole('button', { name: 'Start another call' }),
  ).toBeEnabled()
})

test('mobile call covers the viewport and keeps keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 })
  await setup(page)
  await page.getByRole('button', { name: 'Try Call', exact: true }).click()
  const call = page.getByRole('dialog', { name: 'Careline voice call' })
  await expect(call.getByText('Caller · Connected')).toBeVisible()
  await expect(call).toHaveAttribute('aria-modal', 'true')
  expect((await call.boundingBox())?.width).toBe(390)
  await call.getByRole('button', { name: 'End call' }).focus()
  await page.keyboard.press('Tab')
  await expect(call.getByRole('button', { name: 'Minimize call' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /Careline Assistant/ })).toBeVisible()
})

test('capture actual workspace views', async ({ page }) => {
  test.skip(
    !process.env.CARELINE_SCREENSHOTS,
    'Opt-in screenshots require the running local backend.',
  )
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  await expect(page.getByText('Setup required').first()).toBeVisible()
  await expect(
    page.getByText('Dr. Anika Rao', { exact: true }).first(),
  ).toBeVisible()
  await page.screenshot({
    path: '../docs/screenshots/dashboard.png',
    animations: 'disabled',
  })
  await page.getByRole('link', { name: 'Doctors', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Dr. Anika Rao' }),
  ).toBeVisible()
  await page.screenshot({
    path: '../docs/screenshots/doctors.png',
    animations: 'disabled',
  })
  await page.getByRole('link', { name: 'Appointments', exact: true }).click()
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(page.getByText('Weekly schedule · IST')).toBeVisible()
  await page.screenshot({
    path: '../docs/screenshots/calendar.png',
    animations: 'disabled',
  })
  await page.getByRole('button', { name: 'Dark theme' }).click()
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Appointment overview' }),
  ).toBeVisible()
  await page.screenshot({
    path: '../docs/screenshots/dark.png',
    animations: 'disabled',
  })
  await page.getByRole('button', { name: 'Light theme' }).click()
  await page.setViewportSize({ width: 390, height: 850 })
  await page.screenshot({
    path: '../docs/screenshots/mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
})
