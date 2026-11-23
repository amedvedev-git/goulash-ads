# Запуск, настройки и восстановление

## Локальная проверка

Нужны Node.js 24.12+ ветки 24, Git и tar. В чистом клоне выполните `npm run training`, откройте адрес учебного входа из терминала и пройдите [пять сценариев](ACCEPTANCE.md). Дополнительный учебный запуск — `npm run training:rollstar`. Каталоги данных по умолчанию — `output/training` и `output/training-rollstar`. Для нового профиля можно запустить `node tests/fixtures/e4-browser.ts output/another-training 0`. Для тестов выполните `npm test`. Windows DPAPI проверяется на Windows, Linux-права и systemd credentials проверяются на Linux. Приложение использует встроенную SQLite.

Для локального ручного кабинета задайте `GOULASH_DATA_DIR` и свободный `GOULASH_PORT`, затем выполните `npm start`. Без OAuth локальный кабинет использует одного локального владельца. Для учётных записей задайте `YANDEX_CLIENT_ID` и `YANDEX_CLIENT_SECRET`, зарегистрируйте точный callback этого стенда `/auth/yandex/callback`. Локальные учебные команды выше обходятся без ключей.

## Чистая установка на Linux x64

1. Подготовьте один домен с DNS на сервер, рабочий HTTPS через Caddy, Git, tar, Bash, systemd с DynamicUser и LoadCredential, flock, curl, Node.js 24.12+ ветки 24. В примере исполняемый Node установлен в `/opt/goulash-ads/bin/node`, доступен службе на чтение и исполнение. На машине сборки из чистого клона выполните `node scripts/Build-SelectelPackage.ts`. Сохраните напечатанные commit, releaseId и SHA-256. Файлы для установки находятся в `output`.
2. На сервере в отдельном каталоге с архивом и его файлом контрольной суммы выполните команды ниже. В конфигурации укажите фактический домен, пути Node/Caddy и свободный порт. Пустой `suppliersOrigin` означает установку на один домен. Для существующей установки с соседним сервисом можно задать его HTTPS origin. При отдельном контейнере Caddy настройте доступный ему bind и путь конфигурации внутри контейнера.

```sh
sha256sum -c goulash-ads-update.tar.gz.sha256
tar -xzf goulash-ads-update.tar.gz
cd goulash-ads-update
sudo install -d -m 0700 /etc/goulash-ads
sudo install -m 0600 deploy/deployment.config.example.json /etc/goulash-ads/deployment.json
sudoedit /etc/goulash-ads/deployment.json
sudo install -d -m 0755 /etc/caddy/sites
```

3. Для нативного Caddy в действующем Caddyfile подключите `import /etc/caddy/sites/*.caddy`. У службы Caddy должен быть доступ на чтение каталога и файла сайта. Пример использует `/etc/caddy/sites/goulash-ads.caddy`; установщик создаёт его сам. Если Caddy уже обслуживает этот домен, согласуйте перенос существующего блока до чистой установки. Установщик ожидает свободные app/data, имя systemd unit и путь файла сайта.
4. Зарегистрируйте своё приложение Яндекс ID с доступом к профилю и callback `https://ваш-домен/auth/yandex/callback`. В `/etc/goulash-ads` создайте принадлежащие root файлы `yandex_client_id` и `yandex_client_secret` с соответствующими значениями и режимом 0600. Каталог должен иметь режим 0700. Не помещайте значения в репозиторий. Выполните из распакованного пакета:

```sh
sudo env GOULASH_BOOTSTRAP_NODE=/opt/goulash-ads/bin/node bash deploy/install-clean.sh --config /etc/goulash-ads/deployment.json
```

5. На своём домене откройте главную и `/how-it-works`, войдите через Яндекс ID. В `/pilot` после входа доступен отдельный учебный кабинет. Для живых интеграций установите нужные credentials и один drop-in согласно таблице. Начните с [примера systemd](../../deploy/runtime.conf.example). Выполните `sudo systemctl daemon-reload` и `sudo systemctl restart goulash-ads.service`. Если меняли пути, поправьте их также в итоговом ExecStart и LoadCredential. Сохраните распакованный пакет и закрытую копию итоговых настроек для сопровождения.

## Параметры интеграций

| Интеграция | Что требуется |
| --- | --- |
| Яндекс ID | Системные credentials `yandex_client_id`, `yandex_client_secret`. Общие параметры сервиса — `GOULASH_DATA_DIR`, `GOULASH_PUBLIC_ORIGIN`, `GOULASH_BIND`, `GOULASH_PORT`. |
| Директ | Отдельное зарегистрированное OAuth-приложение с доступом к API Директа, scope `direct:api` и callback `https://oauth.yandex.ru/verification_code`. Флаг `--connect-direct`, файлы `yandex_direct_client_id`, `yandex_direct_client_secret`, `direct_token_key`. Последний — 32 случайных **бинарных** байта в закрытом файле root. Например, в привилегированном терминале для нового ключа выполните `(umask 077; openssl rand 32 > direct_token_key)` в каталоге credentials. Создайте ключ один раз. В Windows возможны DPAPI и переменные `YANDEX_DIRECT_CLIENT_ID`, `YANDEX_DIRECT_CLIENT_SECRET`. В кабинете владельца нужен главный представитель, тип CLIENT, рубли и разрешение на изменение ЕПК. |
| Метрика | Для личных подключений включите `--connect-metrika`. У приложения Яндекс OAuth должны быть разрешение `metrika:read` и адрес возврата `https://oauth.yandex.ru/verification_code`. Сервис запрашивает только право чтения Метрики. В systemd укажите credentials `yandex_metrika_client_id`, `yandex_metrika_client_secret` и отдельный бинарный 32-байтный ключ `metrika_oauth_key`. Можно использовать уже зарегистрированное приложение с этими параметрами. Для ранее выданного доступа сохраните одновременно `--metrika-read`, credential `metrika_token`, `GOULASH_METRIKA_OWNER=yandex:<ID>` и прежнюю `GOULASH_METRIKA_CONFIG_VERSION`. При замене этого токена повысьте версию и проверьте выбор цели. |
| Вордстат и ИИ | Для платной подготовки нужны флаги `--wordstat --phrase-ai`, credentials `wordstat_api_key`, `phrase_ai_key`, каталог `GOULASH_WORDSTAT_FOLDER`, `GOULASH_RESEARCH_OWNER=yandex:<ID>`, `GOULASH_RESEARCH_CONFIG_VERSION`, `GOULASH_RESEARCH_ENABLED=1` и согласие пользователя в форме. Для выключения оставьте режим исследования отключённым. Расходы зависят от тарифов владельца ключей. |
| Рекламные показы | Черновик этапа создаётся с выключенными показами. Допуск на модерацию и расход — отдельная конфигурация для конкретного объекта, она не нужна для пяти сценариев. |

Для смены ключа модели обновите `phrase_ai_key` и версию конфигурации, перезапустите службу. Адаптер вызывает DeepSeek `/chat/completions`, разбирает JSON-ответ и проверяет его структуру. При замене модели сверьте идентификатор в [адаптере](../../src/phrase-intelligence.ts) и [запросе оценки фраз](../../src/phrase-policy.ts), поддержку параметров и валидацию ответов. Генерация и проверка в учебном режиме идут через отдельные имитации.

Для доступа к DeepSeek всех пользователей, вошедших через Яндекс ID, задайте `GOULASH_RESEARCH_ENABLED=ai-all` и подключите systemd credential `phrase_ai_key`. Запросы сохраняют подтверждение в форме. Вордстат в этом режиме выключен. Чтобы отключить ИИ, верните `GOULASH_RESEARCH_ENABLED=0` и перезапустите службу.

### Дополнительные параметры

| Где используются | Имена и назначение |
| --- | --- |
| Локальный Директ | `GOULASH_DIRECT_CLIENT_ID_FILE` и `GOULASH_DIRECT_APP_SECRET_FILE` указывают путь к ID и защищённому DPAPI секрету. `GOULASH_DIRECT_TOKEN_KEY_FILE` задаёт файл ключа шифрования. Старый локальный режим `--direct` требует `GOULASH_DIRECT_ACCOUNT` и, при входе через Яндекс ID, `GOULASH_DIRECT_OWNER`. |
| Локальная Метрика | `YANDEX_METRIKA_CLIENT_ID` и `YANDEX_METRIKA_CLIENT_SECRET` задают отдельное приложение. Альтернативный защищённый файл секрета — `GOULASH_METRIKA_APP_SECRET_FILE`, ключ хранения токенов — `GOULASH_METRIKA_OAUTH_KEY_FILE`. |
| Учебная история Rollstar | На новом стенде параметры по умолчанию вымышлены. Для уже существующего учебного состояния сохраните его прежнюю пару `GOULASH_TRAINING_COUNTER_ID` и `GOULASH_TRAINING_GOAL_ID` при обновлении. |
| Запуск и развёртывание | `GOULASH_BOOTSTRAP_NODE` указывает Node для установочного скрипта, `GOULASH_DEPLOY_CONFIG` — файл конфигурации. systemd предоставляет `CREDENTIALS_DIRECTORY` и `INVOCATION_ID` автоматически. Обёртки обновления сами управляют блокировкой. Дополнительный файл `GOULASH_DIRECT_LAUNCH_APPROVAL_FILE` относится к отдельно согласованному запуску реальной рекламы. |

## Обновление, резервирование и восстановление

Соберите и проверьте новый пакет. Перед обновлением остановите службу и сделайте закрытую копию по процедуре ниже. После запуска прежней службы запустите из нового распакованного пакета `sudo bash deploy/update-selectel.sh`. Для отката последнего обновления используется `sudo bash deploy/rollback-selectel.sh`. Журнал обновления и быстрый откат относятся к рабочей базе. Для возврата всей пары баз и ключей используйте полный резерв. При нестандартном размещении укажите `GOULASH_DEPLOY_CONFIG` и `GOULASH_BOOTSTRAP_NODE` в окружении команд.

Команды выполняет администратор из распакованного **соответствующего выпуска**. Для примера ниже нужны новые закрытые пути назначения. Передайте отдельный каталог с копиями конфигурации установки и unit/drop-in, если их нужно восстановить вместе с данными. Файлы секретов утилита сохраняет из настроенного каталога credentials. Пример использует стандартные пути:

```sh
sudo install -d -m 0700 /var/backups/goulash-ads
sudo systemctl stop goulash-ads.service
sudo /opt/goulash-ads/bin/node deploy/backup-restore.ts backup /var/backups/goulash-ads/handoff-backup --stopped
sudo /opt/goulash-ads/bin/node deploy/backup-restore.ts restore /var/backups/goulash-ads/handoff-backup /var/backups/goulash-ads/handoff-check --stopped
sudo systemctl start goulash-ads.service
```

Если учебная база существует, копия формата 3 содержит рабочую и учебную SQLite под одной проверкой целостности. Прежние копии формата 2 восстанавливают рабочую базу. В каталоге результата находятся `app`, `credentials`, `data/stage2.sqlite` и, для пары, `data/pilot-demo/stage2.sqlite`. Проверочное восстановление пишет в новый каталог. При восстановлении службы поставьте код и credentials из одного комплекта, сохраните актуальные unit/drop-in, остановите все процессы-писатели и отложите прежнее состояние целиком, включая WAL/SHM. Установите обе восстановленные базы в их StateDirectory с владельцем и правами действующего сервиса, каталог учебной базы 0700 и файлы 0600. Запустите службу, проверьте HTTPS, прежнюю кампанию и прежнее состояние учебного Rollstar. Резерв содержит закрытые ключи и остаётся в доверенном хранилище.
