import { AxeBuilder } from '@axe-core/playwright'
import { type APIRequestContext, type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const password = process.env.E2E_ADMIN_PASSWORD ?? ''
const fixture = fileURLToPath(new URL('../src/admin/fixtures/travel-words.json', import.meta.url))

type Session = Awaited<ReturnType<BrowserContext['storageState']>>
type CardJSON = { word: string; pos: string; translation: string; example: string }

test.describe.configure({ mode: 'serial' })
test.skip(!password, 'E2E_ADMIN_PASSWORD не задан: админка в этом прогоне не проверяется')

let session: Session | null = null
let start = 0

async function expectAccessible(page: Page) {
  await page.locator('body').evaluate((body) => {
    const animations = body.getAnimations({ subtree: true })
    return Promise.all(animations.map((animation: { finished: Promise<unknown> }) => animation.finished))
  })
  const results = await new AxeBuilder({ page }).analyze()
  const broken = results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')
  expect(broken, JSON.stringify(broken, null, 2)).toEqual([])
}

function watchErrors(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
}

async function openAdmin(browser: Browser, errors: string[] = []) {
  if (!session) throw new Error('нет сессии: первый тест (вход) не прошёл')
  const context = await browser.newContext({ storageState: session })
  const page = await context.newPage()
  watchErrors(page, errors)
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Слова', level: 1 })).toBeVisible()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  return { context, page }
}

async function deckRevision(request: APIRequestContext): Promise<number> {
  const response = await request.get('/api/v1/admin/deck')
  expect(response.status()).toBe(200)
  return (await response.json()).revision
}

async function openCard(page: Page, word: string) {
  await page.getByRole('searchbox', { name: 'Поиск' }).fill(word)
  await page.getByRole('row', { name: new RegExp(`^${word} `) }).click()
  const editor = page.getByRole('complementary', { name: 'Редактор карточки' })
  await expect(editor.getByRole('heading', { name: word })).toBeVisible()
  await expect(editor.getByLabel('Слово', { exact: true })).toHaveValue(word)
  return editor
}

async function save(page: Page, revision: number) {
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()
  const dialog = page.getByRole('dialog', { name: 'Сохранить изменения' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText(`Сохранено как r${revision}. Каталог для учеников обновлён`)).toBeVisible()
}

async function studyCards(page: Page): Promise<CardJSON[]> {
  const [response] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/v1/cards') && r.status() === 200), page.goto('/')])
  await expect(page.locator('.card__word')).toBeVisible()
  return (await response.json()).items
}

async function adminCard(request: APIRequestContext, word: string) {
  const response = await request.get(`/api/v1/admin/cards?q=${encodeURIComponent(word)}&limit=50`)
  const items: (CardJSON & { id: number; version: number })[] = (await response.json()).items
  const card = items.find((item) => item.word === word)
  if (!card) throw new Error(`нет карточки ${word}`)
  return card
}

test('signs in: one message for a wrong password, then the words', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors: string[] = []
  watchErrors(page, errors)
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Вход в админку' })).toBeVisible()
  await expectAccessible(page)

  await page.getByLabel('Пароль').fill(`${password}-wrong`)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('alert')).toHaveText('Неверный пароль или слишком много попыток. Подождите минуту.')

  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Слова', level: 1 })).toBeVisible()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await expectAccessible(page)

  start = await deckRevision(page.request)
  session = await context.storageState()
  expect(errors.filter((text) => !text.includes('401'))).toEqual([])
  await context.close()
})

test('creates, edits and archives words: one save is one revision, and the study screen follows', async ({ browser }) => {
  const errors: string[] = []
  const { context, page } = await openAdmin(browser, errors)
  const base = await deckRevision(page.request)

  await page.getByRole('button', { name: 'Новое слово' }).click()
  let editor = page.getByRole('complementary', { name: 'Редактор карточки' })
  await editor.getByLabel('Слово', { exact: true }).fill('ferret')
  await editor.getByLabel('Часть речи', { exact: true }).selectOption('noun')
  await editor.getByLabel('Перевод', { exact: true }).fill('хорёк')
  await editor.getByRole('button', { name: 'В черновик' }).click()

  editor = await openCard(page, 'when')
  await editor.getByLabel('Перевод', { exact: true }).fill('когда, в то время как')
  await editor.getByRole('button', { name: 'В черновик' }).click()

  editor = await openCard(page, 'why')
  await editor.getByRole('button', { name: 'В архив' }).click()

  const bar = page.getByRole('region', { name: 'Черновик' })
  await expect(bar).toContainText('1 новых')
  await expect(bar).toContainText('1 изменено')
  await expect(bar).toContainText('1 в архив')
  await expect(bar).toContainText(`основан на ревизии r${base} · сохранится как r${base + 1}`)

  await page.getByRole('button', { name: 'Просмотреть' }).click()
  const dialog = page.getByRole('dialog', { name: 'Сохранить изменения' })
  await expect(dialog).toContainText(`r${base} → r${base + 1} · +1 ~1 −1`)
  await expectAccessible(page)
  await dialog.getByRole('button', { name: 'Назад' }).click()

  await save(page, base + 1)
  await expect(bar).toBeHidden()
  expect(await deckRevision(page.request)).toBe(base + 1)

  const study = await studyCards(page)
  expect(study.some((card) => card.word === 'ferret' && card.translation === 'хорёк')).toBe(true)
  expect(study.find((card) => card.word === 'when')?.translation).toBe('когда, в то время как')
  expect(study.some((card) => card.word === 'why')).toBe(false)

  expect(errors).toEqual([])
  await context.close()
})

test('imports a file with errors and a duplicate, and the history shows the right numbers', async ({ browser }) => {
  const errors: string[] = []
  const { context, page } = await openAdmin(browser, errors)
  const base = await deckRevision(page.request)

  await page.getByRole('button', { name: 'Загрузить JSON' }).click()
  const dialog = page.getByRole('dialog', { name: 'Загрузка слов из JSON' })
  await dialog.getByLabel('Выбрать файл').setInputFiles(fixture)
  const stats = dialog.getByRole('group', { name: 'Результат проверки' })
  await expect(stats.locator('.stat.ok b')).toHaveText('7')
  await expect(stats.locator('.stat.skip b')).toHaveText('1')
  await expect(stats.locator('.stat.bad b')).toHaveText('3')
  await expectAccessible(page)
  await dialog.getByRole('button', { name: 'Добавить 7 в черновик' }).click()
  await expect(page.getByRole('row', { name: /Из файла · travel-words\.json · 7 новых слов/ })).toBeVisible()

  await save(page, base + 1)

  await page.getByRole('button', { name: /История ревизий/ }).click()
  await expect(page.getByRole('heading', { name: 'История ревизий', level: 1 })).toBeVisible()
  const top = page.getByRole('list', { name: 'Ревизии, новые сверху' }).locator(':scope > li').first()
  await expect(top.locator('.r')).toHaveText(`r${base + 1}`)
  await expect(top).toContainText('Импорт: travel-words.json')
  await expect(top).toContainText('текущая')
  await expect(top.getByRole('list', { name: 'Загруженные файлы' })).toHaveText('travel-words.json · +7')
  await expect(top.locator('.tag.new')).toHaveText('+7')

  await page.getByRole('button', { name: `Показать карточки r${base + 1}` }).click()
  await expect(page.getByRole('list', { name: `Карточки r${base + 1}` }).getByRole('listitem')).toHaveCount(7)
  await expectAccessible(page)

  expect(errors).toEqual([])
  await context.close()
})

test('conflict between two browsers: only the field both changed is asked about, the other one merges by itself', async ({ browser }) => {
  test.setTimeout(60_000)
  const first = await openAdmin(browser)
  const second = await openAdmin(browser)
  const base = await deckRevision(first.page.request)
  const before = await adminCard(first.page.request, 'how')

  let editor = await openCard(second.page, 'how')
  await editor.getByLabel('Перевод', { exact: true }).fill('как, каким образом')
  await editor.getByLabel('Предложение', { exact: true }).fill('How do you explain a smell to someone?')
  await editor.getByRole('button', { name: 'В черновик' }).click()
  await expect(second.page.getByRole('region', { name: 'Черновик' })).toContainText(`основан на ревизии r${base}`)

  editor = await openCard(first.page, 'how')
  await editor.getByLabel('Перевод', { exact: true }).fill('как, насколько')
  await editor.getByRole('button', { name: 'В черновик' }).click()
  await save(first.page, base + 1)

  await second.page.getByRole('button', { name: 'Сохранить изменения' }).click()
  await second.page.getByRole('dialog', { name: 'Сохранить изменения' }).getByRole('button', { name: 'Сохранить' }).click()
  const conflict = second.page.getByRole('dialog', { name: 'Колода изменилась, пока вы работали' })
  await expect(conflict).toBeVisible()
  await expect(conflict).toContainText(`Вы начали с ревизии r${base}, на сервере уже r${base + 1}. Ничего не записано.`)
  const fields = conflict.getByRole('group', { name: 'Поля карточки «how», которые изменили и вы, и сервер' })
  await expect(fields).toContainText('Перевод')
  await expect(fields).not.toContainText('Предложение')
  await expect(conflict.getByRole('radio')).toHaveCount(2)
  await expectAccessible(second.page)

  await conflict.getByRole('radio', { name: 'На сервере: как, насколько' }).check()
  await conflict.getByRole('button', { name: `Применить поверх r${base + 1}` }).click()
  await expect(second.page.getByText(`Сохранено как r${base + 2}. Каталог для учеников обновлён`)).toBeVisible()

  const after = await adminCard(second.page.request, 'how')
  expect(after.translation).toBe('как, насколько')
  expect(after.example).toBe('How do you explain a smell to someone?')
  expect(after.version).toBe(before.version + 2)
  expect(await deckRevision(second.page.request)).toBe(base + 2)

  await first.context.close()
  await second.context.close()
})

test('reverts to the first revision through a draft, and the deck matches its export', async ({ browser }) => {
  const errors: string[] = []
  const { context, page } = await openAdmin(browser, errors)
  const base = await deckRevision(page.request)

  const editor = await openCard(page, 'when')
  await editor.getByRole('tab', { name: 'Версии' }).click()
  await editor.getByRole('button', { name: /^v1 / }).click()
  await expect(editor.getByRole('table')).toContainText('когда, в то время как')
  await expectAccessible(page)
  await editor.getByRole('button', { name: 'Закрыть редактор' }).click()

  await page.getByRole('button', { name: /История ревизий/ }).click()
  await page.getByRole('button', { name: `Откатить к r${start}` }).click()
  await expect(page.getByRole('heading', { name: 'Слова', level: 1 })).toBeVisible()
  const bar = page.getByRole('region', { name: 'Черновик' })
  await expect(bar).toContainText(`«Откат к r${start}»`)
  expect(await deckRevision(page.request)).toBe(base)

  await save(page, base + 1)

  const now = await page.request.get('/api/v1/admin/export')
  const then = await page.request.get(`/api/v1/admin/revisions/${start}/export`)
  expect(now.status()).toBe(200)
  expect(await now.json()).toEqual(await then.json())

  const study = await studyCards(page)
  expect(study.some((card) => card.word === 'ferret')).toBe(false)
  expect(study.some((card) => card.word === 'luggage')).toBe(false)
  expect(study.some((card) => card.word === 'why')).toBe(true)

  expect(errors).toEqual([])
  await context.close()
})

test('signs out: the session is gone on the server too', async ({ browser }) => {
  const { context, page } = await openAdmin(browser)
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('heading', { name: 'Вход в админку' })).toBeVisible()
  expect((await page.request.get('/api/v1/admin/session')).status()).toBe(401)
  await context.close()
})
