# Engmark

Тренажёр английской лексики. Монорепозиторий: Go API в `backend/`, экран занятий на Vite и React в `frontend/`.

## Запуск

- `make dev` поднимает Postgres, затем в одном переднем плане запускает API на `:5050` и экран на `:5173`. Ctrl+C останавливает оба процесса. Postgres продолжает работать. При старте API применяет миграции и синхронизирует `data/cards.json`.
- `make env-down` останавливает локальный контейнер Postgres. Файлы базы в `out/pgdata` остаются. Серверный стек этой командой не затрагивается.
- `make run` собирает API и слушает `:5050`.
- `make web` запускает только экран на `:5173`.
- `make test` гоняет тесты Go. Нужен Docker: тесты поднимают свой Postgres и не пользуются базой от `make run`.
- `make test-race` то же с детектором гонок.
- `make host-up` собирает серверный образ и поднимает сайт только из `docker-compose.yaml`. `make host-down` останавливает этот стек и сохраняет том базы.

## Окружение

Скопируйте пример и заполните локальные значения:

```sh
cp .env.example .env
```

В `.env` задайте `POSTGRES_USER`, `POSTGRES_PASSWORD` и `POSTGRES_DB` для контейнера Postgres. `DATABASE_URL` — тот же аккаунт на опубликованном порту `127.0.0.1:5433`:

```
DATABASE_URL=postgres://engmark:changeme@localhost:5433/engmark?sslmode=disable
```

```sh
make dev
```

`make dev` остаётся на переднем плане. При старте API применяет миграции и синхронизирует колоду admin из `data/cards.json` в рабочем каталоге процесса. Ctrl+C останавливает API и экран. `make env-down` убирает локальный контейнер Postgres.

API слушает `http://localhost:5050`. Экран ходит в `/api` своего origin. Vite проксирует этот префикс на API, браузер напрямую на `:5050` не ходит.

`docker-compose.yaml` — серверный стек: Postgres, API и Caddy. `docker-compose.override.yaml` на ноутбуке подключается сам: публикует `127.0.0.1:5433` и хранит данные в `out/pgdata`. `make host-up` передаёт `-f docker-compose.yaml` и этот файл пропускает.

Если переменные пула не заданы, действуют значения по умолчанию: `DB_MAX_CONNS=10`, `DB_MIN_CONNS=1`, `DB_MAX_CONN_IDLE_TIME=5m`, `DB_HEALTH_CHECK_PERIOD=30s`. `LOGGER_LEVEL` по умолчанию `info`. `LOGGER_FORMAT` на ноутбуке `console`, в серверном контейнере `json`.

Таймауты HTTP, если их не переопределить: заголовок 5 с, чтение 10 с, запись 15 с, простой 60 с, заголовки до 65536 байт.

## API

- `GET /healthz` отвечает 200 и в базу не ходит. Процесс всё равно проверяет Postgres при старте и не начинает слушать, если проверка не прошла. В JSON может быть поле `version`.
- `GET /readyz` отвечает 200, когда Postgres доступен и каталог уже лежит в памяти. Пока процесс завершается, ответ 503. Образ проверяет готовность командой `engmark ready`.
- `GET /api/v1/cards?limit=1000` отдаёт колоду по умолчанию: `items`, `total`, `limit`, `offset`. `limit` от 1 до 1000, по умолчанию 50. Ответ несёт слабый `ETag` (SHA-256 тела JSON) и `Cache-Control: public, max-age=0, must-revalidate`. Повтор с тем же `If-None-Match` — 304. Выбранная колода: `GET /api/v1/decks/{id}/cards`.

Список карточек читается из снимка в памяти. Снимок строится после синхронизации файла. Если `data/cards.json` не изменился, строки в базе и `ETag` остаются прежними между перезапусками. Ошибка имеет вид `{"error":{"code","message"},"request_id"}`. Запись карточек идёт через файл каталога.

## Каталог

Первый старт создаёт таблицы и одну колоду `default` с `kind` `admin`. Каталог — `data/cards.json`. Старт записывает файл в колоду admin. Ключ карточки: колода, слово в нижнем регистре, `pos` и перевод. Совпавшая карточка сохраняет `id`, версию и `created_at`. Карточка, которой больше нет в файле, удаляется. Колода с `kind` `user` остаётся как есть. `pos` — одно из `verb`, `noun`, `adj`, `adv`. Слово состоит из английских букв, апострофа, дефиса и одиночных пробелов внутри.

Поправьте `data/cards.json` и запустите `make dev`, чтобы опубликовать изменение. `make migrate-create`, `make migrate-up` и `make migrate-down` по-прежнему гоняют CLI миграций на базу разработки.

## Схема базы

Схема лежит в одной миграции `backend/migrations/000001_init.up.sql`. Данные базы не хранятся: каталог каждый раз загружается из `data/cards.json`.

После изменения `000001_init` базу нужно пересоздать.

Локально:

```sh
make env-down && rm -rf out/pgdata && make dev
```

На сервере:

```sh
docker compose --env-file .env -f docker-compose.yaml -p engmark-prod --profile host down -v && make host-up
```

`down -v` удаляет базу целиком. Если при старте в логе есть `database schema is from another build`, пересоздайте базу этими командами.

## Экран занятий

`make dev` запускает экран вместе с API. Ctrl+C останавливает оба. Чтобы поднять только экран, когда API уже слушает:

```sh
make web
```

Откройте http://localhost:5173. Слова приходят одним `GET /api/v1/cards?limit=1000`. Если колода больше, загрузка продолжается со следующего `offset`. Следующее слово — случайная карточка, которая ещё не была в этом проходе. После последней карточки колода перемешивается снова.

Место запоминается в `ew-progress` (`index`, `order`, `wordsLen`), тема — в `ew-theme`: `dark`, `light`, `sepia`, `alt-dark`. Если набор id изменился, сохранённый порядок сверяется с каталогом: пропавшие id убираются, новые встают среди ещё не показанных. Повреждённая запись перемешивает колоду заново.

Пробел, стрелка вправо и `J` идут вперёд. Стрелка влево и `K` — назад. Озвучка идёт через синтез речи браузера. Шрифты лежат в сборке как woff2: Manrope, Fraunces, Space Grotesk, Syne и IBM Plex Mono. Темы `alt-*` подгружают свой набор отдельно.

## Сервер

Сервер — один Docker-стек. Caddy отдаёт экран и проксирует API на том же хосте, сжимает ответы (zstd и gzip) и ставит заголовки безопасности. HSTS начинается с `max-age=300`. Postgres слушает только сеть Docker. Процесс Go говорит по HTTP внутри этой сети. Caddy включает TLS, когда `ENGMARK_SITE` — доменное имя.

Поставьте Docker и откройте порты 80 и 443. Скопируйте туда тот же пример и поправьте `.env`. В репозиторий его не кладут.

```sh
cp .env.example .env
```

Замените `POSTGRES_PASSWORD` и поставьте тот же пароль в `DATABASE_URL`. Направьте DNS на машину и задайте:

```
ENGMARK_SITE=words.example.com
```

Для машины без домена оставьте `ENGMARK_SITE=:80`. `DATABASE_URL` в `.env` — адрес ноутбука, порт 5433. `make host-up` направляет API на Postgres внутри Docker-сети. Чтобы API ходил в другую базу, задайте `ENGMARK_DATABASE_URL` полным URL `postgres://`, включая `sslmode` и при необходимости `sslrootcert`.

```sh
make host-up
```

Откройте сайт. Страница и API на одном хосте. Там же `GET /healthz` и `GET /readyz`. Логи:

```sh
docker compose --env-file .env -f docker-compose.yaml -p engmark-prod --profile host logs -f app
```

`make host-down` останавливает серверные контейнеры и сохраняет том базы. Эта команда удаляет серверный том вместе с базой:

```sh
docker compose --env-file .env -f docker-compose.yaml -p engmark-prod --profile host down -v
```

Каждый старт сервера применяет встроенные миграции и синхронизирует колоду admin из `data/cards.json` в образе. Рабочий каталог процесса — `/`, файл каталога — `/data/cards.json`. Образ distroless, процесс без root. Карточка с тем же словом, частью речи и переводом сохраняет id, поэтому прогресс в браузере переживает выкладку. Поправьте `data/cards.json` и запустите `make host-up`, чтобы опубликовать новый каталог.

Браузер вызывает `/api/v1/cards` на хосте сайта.

`make db-backup` пишет локальную базу в `engmark-backup.dump`. `make dist-src` собирает zip исходников текущего коммита в `engmark-src.zip`.

## Тесты

`make test` запускает `go test ./...` в `backend/` и требует Docker.

Во `frontend/`: `npm run lint`, `npm test`, `npm run build`, `npm run check:size`. Сквозной прогон экрана: `npm run test:e2e`.

## CI

Push в `main` и pull request запускают четыре задачи. Секрет GitHub не нужен.

- API: `go vet`, staticcheck, govulncheck и `make test-race`.
- Фронтенд: `npm run lint`, `npm test`, `npm run build` и `npm run check:size`.
- Сборка образа без публикации в реестр.
- Playwright на Chromium против поднятого стека.

Dependabot раз в неделю проверяет Go-модули в `/backend`, npm в `/frontend`, GitHub Actions и Docker.
