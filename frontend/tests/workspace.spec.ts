import { expect, test, type Page } from '@playwright/test'

const now = new Date()
const doctor = {
  id: 'anika',
  name: 'Dr. Anika Rao',
  specialty: 'General Medicine',
}
const start = new Date(now.getTime() + 86400000).toISOString()
const appointment = {
  reference: 'CL-TEST001',
  doctor_id: doctor.id,
  doctor: doctor.name,
  specialty: doctor.specialty,
  starts_at: start,
  phone_tail: '3210',
  status: 'confirmed',
  created_at: now.toISOString(),
  cancelled_at: null,
  slot_id: 'slot-1',
}

async function seed(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const values: Record<string, unknown> = {
      '/api/health': {
        voiceConfigured: false,
        clinicDate: now.toISOString().slice(0, 10),
        timezone: 'Asia/Kolkata',
      },
      '/api/doctors': {
        doctors: [doctor],
        slots: [
          {
            id: 'slot-1',
            doctor_id: doctor.id,
            doctor: doctor.name,
            specialty: doctor.specialty,
            starts_at: start,
            available: 0,
            reference: appointment.reference,
          },
        ],
      },
      '/api/appointments': [appointment],
      '/api/activity': [],
      '/api/sessions': [],
    }
    await route.fulfill({ json: values[path] ?? [] })
  })
  await page.goto('/')
}

test('overview, search, appointment drawer, calendar and theme', async ({
  page,
}) => {
  await seed(page)
  await expect(
    page.getByRole('heading', { name: 'Appointment overview' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Try Call', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Quick search' }).click()
  await page
    .getByRole('textbox', { name: 'Search pages, doctors or appointments' })
    .fill('Anika')
  await page
    .getByRole('button', { name: /Dr. Anika Rao General Medicine/ })
    .click()
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: doctor.name }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'Appointments', exact: true }).click()
  await page
    .getByRole('button', { name: appointment.reference, exact: true })
    .click()
  await expect(page.getByRole('dialog').getByText('•••• 3210')).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(page.getByText('Weekly schedule · IST')).toBeVisible()
  await page.getByRole('button', { name: 'Dark theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

for (const width of [390, 768, 1280, 1440]) {
  test('dashboard fits ' + width + ' pixels', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await seed(page)
    await expect(page.getByText('Available doctors')).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width)
  })
}
