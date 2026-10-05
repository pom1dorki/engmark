import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const themes = ['Светлая тема', 'Сепия', 'Альтернативная тёмная', 'Тёмная тема']

test('opens a card, steps forward, and switches themes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')
  const word = page.locator('.card__word')
  await expect(word).toBeVisible()
  const first = (await word.innerText()).trim()
  await page.keyboard.press('Space')
  await expect(word).not.toHaveText(first)

  for (const name of themes) {
    await page.getByRole('radio', { name }).click()
    const results = await new AxeBuilder({ page }).analyze()
    const broken = results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')
    expect(broken, JSON.stringify(broken, null, 2)).toEqual([])
  }

  expect(errors).toEqual([])
})

test('changes the card on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const word = page.locator('.card__word')
  await expect(word).toBeVisible()
  const first = (await word.innerText()).trim()
  await page.getByRole('button', { name: 'Другое слово' }).click()
  await expect(word).not.toHaveText(first)
  const results = await new AxeBuilder({ page }).analyze()
  const broken = results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')
  expect(broken, JSON.stringify(broken, null, 2)).toEqual([])
})
