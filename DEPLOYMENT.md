# Nova без Docker на HOSTKEY

Для Nova на двух пользователей Docker не требуется. Основной production-вариант использует обычные процессы Ubuntu.

```text
Nginx → статический React Mini App
     → Node.js API → PostgreSQL
     → Node.js Telegram bot
```

Docker Compose остаётся в репозитории как необязательный альтернативный способ запуска и не нужен для локальной разработки или VPS.

## Что подготовить

Создайте VPS HOSTKEY с Ubuntu 24.04 LTS, статическим IPv4 и доменом. Для MVP достаточно 2 vCPU, 4 ГБ RAM и 40 ГБ NVMe. Во внешнем firewall откройте только SSH, HTTP и HTTPS.

Установите Node.js 22 LTS, PostgreSQL 16, Nginx, Certbot, age и Git.

```bash
sudo apt update
sudo apt install -y postgresql nginx certbot python3-certbot-nginx age git
```

Создайте отдельного системного пользователя `nova`, каталог `/var/www/nova` и каталог `/etc/nova`.

```bash
sudo adduser --system --group --home /var/www/nova nova
sudo mkdir -p /var/www/nova /etc/nova /var/backups/nova
sudo chown -R nova:nova /var/www/nova
sudo chmod 700 /etc/nova /var/backups/nova
```

В BotFather создайте бота и получите токен. DNS A-запись домена должна указывать на IPv4 VPS.

## Конфигурация

Скопируйте [.env.production.example](.env.production.example) в `/etc/nova/nova.env` и задайте реальные значения. Файл должен принадлежать root и иметь права 600. Для backup создайте отдельный `/etc/nova/backup.env` с публичным age-ключом.

```bash
sudo cp .env.production.example /etc/nova/nova.env
sudo chown root:root /etc/nova/nova.env
sudo chmod 600 /etc/nova/nova.env
sudo nano /etc/nova/nova.env
sudo nano /etc/nova/backup.env
sudo chown root:root /etc/nova/backup.env
sudo chmod 600 /etc/nova/backup.env
```

Для native deployment добавьте PostgreSQL URL:

```env
NODE_ENV=production
PORT=3000
BIND_HOST=127.0.0.1
DATABASE_URL=postgres://nova:CHANGE_ME@127.0.0.1:5432/nova
WEBAPP_URL=https://nova.example.com
ALLOWED_ORIGINS=https://nova.example.com
DEV_AUTH_BYPASS=false
BOT_ENABLED=false
```

Создайте отдельную базу и пользователя PostgreSQL. PostgreSQL должен слушать только localhost или внутреннюю сеть сервера.

```bash
sudo -u postgres createuser --pwprompt nova
sudo -u postgres createdb -O nova nova
```

## Первый запуск

Склонируйте проект в `/var/www/nova`, затем соберите backend и Mini App.

```bash
sudo -u nova git clone YOUR_REPOSITORY_URL /var/www/nova
cd /var/www/nova/backend
sudo -u nova npm ci
sudo -u nova npm run build
cd /var/www/nova/miniapp
sudo -u nova npm install
sudo -u nova npm run build
```

Примените миграции до первого запуска API.

```bash
cd /var/www/nova/backend
sudo -u nova env NOVA_ENV_FILE=/etc/nova/nova.env node dist/migrate.js
```

Скопируйте systemd units из `ops/nova-api.service` и `ops/nova-bot.service` в `/etc/systemd/system/`, затем включите API и бота.

```bash
sudo cp /var/www/nova/ops/nova-api.service /etc/systemd/system/
sudo cp /var/www/nova/ops/nova-bot.service /etc/systemd/system/
sudo cp /var/www/nova/ops/nova-backup.service /etc/systemd/system/
sudo cp /var/www/nova/ops/nova-backup.timer /etc/systemd/system/
sudo cp /var/www/nova/ops/nova-backup.service /etc/systemd/system/
sudo install -m 700 /var/www/nova/ops/backup-native.sh /usr/local/sbin/nova-backup
sudo install -m 600 /dev/null /etc/nova/backup.env
sudo systemctl daemon-reload
sudo systemctl enable --now nova-api
sudo systemctl enable --now nova-bot
sudo systemctl enable --now nova-backup.timer
sudo systemctl status nova-api nova-bot
```

Бот запускается отдельно и использует тот же `/etc/nova/nova.env`. Не запускайте второй polling-процесс с тем же Telegram token.

## Nginx и HTTPS

Скопируйте `ops/nginx.conf` в `/etc/nginx/sites-available/nova`, замените домен и включите сайт.

```bash
sudo cp /var/www/nova/ops/nginx.conf /etc/nginx/sites-available/nova
sudo ln -s /etc/nginx/sites-available/nova /etc/nginx/sites-enabled/nova
sudo nginx -t
sudo systemctl reload nginx
```

Получите HTTPS-сертификат через Certbot.

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d nova.example.com
```

Проверьте API:

```bash
curl -fsS https://nova.example.com/health
```

## Обновление

Перед обновлением создайте backup. Затем пересоберите backend и Mini App, примените новые миграции и перезапустите процессы.

```bash
cd /var/www/nova
sudo -u nova git pull
cd backend
sudo -u nova npm ci
sudo -u nova npm run build
sudo -u nova node dist/migrate.js
cd ../miniapp
sudo -u nova npm install
sudo -u nova npm run build
sudo systemctl restart nova-api nova-bot
sudo systemctl reload nginx
curl -fsS https://nova.example.com/health
```

## Backup и восстановление

Используйте `ops/backup-native.sh`. Скрипт передаёт `pg_dump` через age и не создаёт plaintext dump на диске. Создайте age-ключ и сохраните приватную часть вне VPS.

```bash
age-keygen -o nova-backup-key.txt
AGE_PUBLIC_KEY=$(grep '^# public key:' nova-backup-key.txt | cut -d: -f2- | xargs)
printf 'NOVA_BACKUP_RECIPIENT=%s\n' "$AGE_PUBLIC_KEY" | sudo tee /etc/nova/backup.env >/dev/null
sudo chmod 600 /etc/nova/backup.env
sudo install -m 700 /var/www/nova/ops/backup-native.sh /usr/local/sbin/nova-backup
sudo systemctl enable --now nova-backup.timer
```

Храните зашифрованные файлы вне VPS. Восстановление проверяйте минимум раз в месяц в отдельную временную базу через `ops/restore-native.sh`.

```bash
sudo bash /var/www/nova/ops/restore-native.sh /var/backups/nova/nova-YYYYMMDDTHHMMSSZ.dump.age /path/to/nova-backup-key.txt
```

## Безопасность

- `.env` и `/etc/nova/nova.env` не коммитятся и имеют права 600.
- `DEV_AUTH_BYPASS=false`.
- PostgreSQL не принимает внешние подключения.
- Nginx принимает только 80 и 443, Node.js слушает localhost.
- `ALLOWED_ORIGINS` содержит только HTTPS-домен Mini App.
- Telegram initData проверяется backend и не попадает в логи.
- Приглашения хранятся в базе только как хеш.
- Доступ партнёра к каждой категории проверяется backend при каждом запросе.
- Зашифрованные backup-файлы копируются за пределы VPS.
- SSH работает с отдельным deploy-пользователем и закреплённым host key.

## Ежедневные советы в Telegram

Процесс `nova-bot` раз в день отправляет партнёру сообщение с советом по текущему дню цикла. Отдельный сервис не нужен, но после обновления обязательно выполните `node dist/migrate.js` (появилась таблица `tip_deliveries`) и перезапустите `nova-bot`.

Сообщение уходит только если одновременно выполнены три условия: партнёр сам включил «Советы в Telegram» в настройках приложения, владелица открыла ему категорию «Цикл» в разделе «Пара» и партнёр хотя бы раз нажал /start в чате с ботом. Время и часовой пояс задаются в `/etc/nova/nova.env`.

```text
TIPS_HOUR=10
TIPS_TIMEZONE=Europe/Moscow
```

Тексты советов лежат в `miniapp/src/tips.ts`. Файл `backend/src/tips.ts` должен быть его точной копией, после правок скопируйте его: `cp miniapp/src/tips.ts backend/src/tips.ts`.

