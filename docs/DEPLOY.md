# Развёртывание на сервере (HTTP, без домена)

Подходит любой Linux-сервер с Docker и Docker Compose. Наружу открывается один порт (47310), доменное имя не нужно.

## Быстрый способ (с Windows)

Запустить `deploy.bat` в корне проекта. Скрипт упакует проект, по SSH запросит пароль пользователя `root` сервера (при каждом запуске, нигде не сохраняется), сам поставит Docker, создаст `.env` со случайными секретами и запустит контейнеры. Адрес сервера и пользователь задаются в начале `deploy.bat` (`HOST`, `USER`). Для первой сборки нужно около 2 ГБ свободной памяти и 5-10 минут.

Ручной вариант описан ниже.

## Сервер

1. Зайти на сервер по SSH и поставить Docker (`curl -fsSL https://get.docker.com | sh`).
2. Скопировать проект на сервер (`scp -r Project user@СЕРВЕР:~/masshtablab` или `git clone`).
3. В каталоге проекта:

```bash
cp .env.example .env
nano .env
```

В `.env` задать `JWT_SECRET` (длинная случайная строка) и `POSTGRES_PASSWORD`. `WEB_PORT=47310` уже стоит по умолчанию. `COOKIE_SECURE` оставить `0`, пока сайт работает по HTTP.

4. Запустить:

```bash
docker compose up -d --build
docker compose ps
curl http://localhost:47310/api/m/health
```

Ответ `{"ok":true,"core":true}` означает, что сервер готов принимать фотографии.

5. Открыть порт 47310 в файрволе хостинга (`ufw allow 47310/tcp`, если используется ufw).

Веб-интерфейс доступен на `http://АДРЕС_СЕРВЕРА:47310/`, API мобильного приложения на `http://АДРЕС_СЕРВЕРА:47310/api/m/`.

Обновление: `git pull` (или копирование файлов), затем `docker compose up -d --build`. Данные лежат в томах `pgdata`, `mongodata`, `data` и при пересборке сохраняются.

## Мобильное приложение

Приложение подключается к серверу автоматически, вход не нужен. Адрес задаётся при сборке:

```
mobile\tools\setup.bat
mobile\tools\build.bat http://АДРЕС_СЕРВЕРА:47310
```

Готовый `app-release.apk` лежит в `mobile/build/app/outputs/flutter-apk/`. Его можно отправить на телефон и установить (разрешить установку из неизвестных источников).

## Ограничение доступа

Без домена и HTTPS трафик между телефоном и сервером не шифруется. Если нужно закрыть открытый раздел `/api/m/` от посторонних, задайте `MOBILE_KEY` в `.env`, перезапустите `docker compose up -d` и соберите приложение с тем же ключом:

```
mobile\tools\build.bat http://АДРЕС_СЕРВЕРА:47310
```

с добавлением `--dart-define=API_KEY=ключ` в команду сборки (`flutter build apk --release --dart-define=API_URL=... --dart-define=API_KEY=...`).

## Резервное копирование

```bash
docker compose exec postgres pg_dump -U masshtablab masshtablab > masshtablab.sql
docker run --rm -v masshtablab_data:/data -v $PWD:/backup alpine tar czf /backup/data.tgz -C /data .
```
