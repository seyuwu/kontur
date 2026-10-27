# Контур демонстрации

Один Docker Compose: PostgreSQL, однократные миграции, web, worker; HTTPS включается профилем Caddy. Это самостоятельная база с синтетическими данными. Существующая локалка `localhost:3000` и её PostgreSQL не подключаются к этому контуру.

## Локальная проверка

Выполнять из корня проекта. Требуются Docker Engine с Linux-контейнерами и Compose с поддержкой `service_completed_successfully`.

```powershell
npm run deploy:prepare
docker compose --env-file .local/deploy/.env -f infra/deploy/compose.yaml config --quiet
docker compose --env-file .local/deploy/.env -f infra/deploy/compose.yaml up -d --build --wait
docker compose --env-file .local/deploy/.env -f infra/deploy/compose.yaml run --rm seed
```

Открыть `http://localhost:3080`. Генератор создаёт `.local/deploy/.env` с отдельными случайными секретами; существующий файл не заменяет и значения не выводит. Не копируйте в него `.env` локальной разработки. Seed запускается явно и меняет пароли демонстрационных аккаунтов по `DEMO_PASSWORD`; не запускайте его при обычном обновлении. Локальный HTTP-вариант служит проверке контейнеров на этой машине.

Web и worker работают от пользователя `node`, с файловой системой для чтения и временным каталогом. Миграции применяются до старта обоих. База не публикует порт на хост, web доступен только через loopback `3080`. Данные PostgreSQL 18 хранятся в отдельном volume на `/var/lib/postgresql`; старый volume PostgreSQL 17 не переиспользуется.

## HTTPS на демонстрационном сервере

Для **нового** контура создать настройки с фактическим доменом:

```powershell
npm run deploy:prepare -- https://your-domain.example
```

Для уже существующего `.local/deploy/.env` изменить только `APP_ORIGIN`, `BETTER_AUTH_URL` и `SITE_ADDRESS`, сохранив пароли / секрет сессий. Оба origin должны быть одинаковыми корневыми HTTPS-адресами, SITE_ADDRESS — их hostname. На сервере задать `DEPLOY_BIND=0.0.0.0`; по умолчанию опубликованные порты прокси доступны только с этого компьютера. Направить DNS на выбранный сервер, открыть входящие TCP 80/443 и включить HTTPS:

```powershell
docker compose --env-file .local/deploy/.env -f infra/deploy/compose.yaml --profile https up -d --build --wait
```

Caddy получает и обновляет публичный сертификат для подходящего домена. Каталог сертификатов сохраняется в volume; в нём есть приватные ключи. Логи доступа с query-параметрами не включаются. Прокси ограничивает тело запроса до 1 MB, приложение отдельно проверяет собственные меньшие лимиты. Внешние AI / SMTP по умолчанию отключены; их включение описано в основном README.

Для локальной проверки TLS можно использовать `https://localhost` в обоих origin, `SITE_ADDRESS=localhost` и loopback-привязку. Caddy создаёт локальный CA; контейнер не устанавливает его в доверенные на компьютере. Без отдельного доверия браузер предупреждает о сертификате. Это не публичный сертификат и не проверка доступа с телефона. Приватный ключ CA не копировать клиентам.

## Проверка готовности и сбои

- `/api/health` проверяет базовое соединение с БД.
- `/api/ready` дополнительно требует свежий heartbeat worker: оба пула задач запущены, heartbeat обновляется раз в 10 секунд. Ответ содержит только технические статусы, без ID, секретов и сведений пациентов; кэш отключён.
- Worker проверяется внутри своего контейнера по файлу heartbeat, времени и существованию процесса. При остановке readiness снимается, задачи завершаются с ограниченным ожиданием. При аварийном уничтожении процесса запись БД устаревает через 45 секунд.
- Readiness не доказывает отсутствие зависшего задания, доставку email, ответ провайдера или наличие дежурного врача. Состояния доставки и попыток остаются в доменной истории.

```powershell
docker compose --env-file .local/deploy/.env -f infra/deploy/compose.yaml ps
docker compose --env-file .local/deploy/.env -f infra/deploy/compose.yaml logs --tail 60 worker
```

Логи могут содержать технические ID. Не публиковать полный `docker inspect`, `docker compose config` без `--quiet`, `.env` или архив базы: они могут содержать приватные данные / секреты.

## Копии контейнерной базы

Выполнять с хоста из корня проекта, при работающем контейнере PostgreSQL:

```powershell
npm run db:backup-container
npm run db:restore-container-check
```

Команды создают согласованный snapshot через pg_dump, копируют бинарный архив через Docker cp (без текстового перенаправления PowerShell), сохраняют SHA-256 / манифест в `.local/backups`. Режим проверки восстанавливает архив в отдельную БД с проверенным временным именем, проверяет загрузку схемы / основных таблиц, затем удаляет только временную БД. Основная база не перезаписывается. Эта проверка не сравнивает все строки с меняющимся источником и не является аварийным переключением приложения.

Архив содержит все данные приложения и аутентификации. На POSIX для архива задаётся 0600; на Windows доступ определяется ACL каталога. Для независимого хранения требуется отдельное защищённое место вне этого компьютера. Нативные `db:backup` / `db:restore-check` остаются командами для базы разработки на порту 55432.

## Обновление и остановка

Перед обновлением сохранить копию БД. Затем собрать новую версию и применить миграции до замены web / worker:

```powershell
docker compose --env-file .local/deploy/.env -f infra/deploy/compose.yaml build
docker compose --env-file .local/deploy/.env -f infra/deploy/compose.yaml run --rm migrate
docker compose --env-file .local/deploy/.env -f infra/deploy/compose.yaml up -d --wait web worker
```

Для согласованного обновления останавливайте web / worker перед миграцией, если новая миграция несовместима с работающей версией. Zero-downtime и автоматический откат схемы не обещаются. Обновление не запускает seed. Не менять major-версию PostgreSQL поверх существующего volume без отдельного переноса.

```powershell
docker compose --env-file .local/deploy/.env -f infra/deploy/compose.yaml stop
```

`stop` сохраняет тома. Не использовать `down --volumes` для обычного перезапуска. Независимое резервирование вне этой машины, RPO, регламент восстановления и боевой мониторинг остаются отдельными эксплуатационными задачами.

## Источники решений

- [Next.js standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) — web-образ с трассированными зависимостями и отдельными static/public.
- [Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/) — миграции как условие запуска.
- [PostgreSQL image](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata) — путь тома PostgreSQL 18.
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) — условия публичного сертификата и границы локального TLS.

### Web Push

Сервис web и worker должны получать одну постоянную пару `WEB_PUSH_PUBLIC_KEY`/`WEB_PUSH_PRIVATE_KEY`; ключи не генерируются при запуске контейнера. Установите `WEB_PUSH_ENABLED=true`, `WEB_PUSH_SUBJECT=mailto:<контакт оператора>` и доступный телефону HTTPS `APP_ORIGIN` (такой же `BETTER_AUTH_URL`). Для DEMO дополнительно `ALLOW_DEMO_WEB_PUSH=true`. Пара создаётся один раз через `web-push.generateVAPIDKeys()` и хранится как секрет конфигурации; не выводите приватный ключ в общие логи. При ротации устройства требуют переподключения. Подписка создаётся врачом в интерфейсе, по значку телефона; разрешение не запрашивается автоматически.

Требуется исходящий HTTPS к браузерным push-провайдерам. На iOS/iPadOS 16.4+ сайт запускается с экрана «Домой». Localhost-проверка на компьютере не заменяет испытания телефона через HTTPS и его фактического провайдера. Получение push сервисом не является доставкой/прочтением. Этот пакет не проверялся повторным запуском Docker: пользователь попросил оставить Docker выключенным.
