# Архитектура

```
браузер ──► web (nginx) ──/api──► gateway (Fastify, TS) ──► core (FastAPI, Python)
                                     │   │                       │
                                     │   └──► MongoDB            │
                                     └──► PostgreSQL             │
                         общий том data (изображения по sha256) ◄┘
```

## Роли сервисов
- **core (Python)** — вся математика и работа с изображениями: калибровка, измерения, сегментация, сравнение, PDF/CSV/PNG. Состояния не хранит.
- **gateway (TypeScript)** — единственная точка входа: авторизация, права (пользователь видит только свои данные), валидация (zod), транзакции в БД, версии отчётов, экспорт.
- **web (React + TS)** — два набора экранов (`src/glass`, `src/classic`) на общем слое данных (`api.ts`, `state.tsx`, `useWorkspace.ts`).

## Данные
- **PostgreSQL**: users, sessions, images (sha256 уникален), samples, reference_standards, calibrations, measurements, report_versions, user_prefs.
- **MongoDB**: events (журнал), report_payloads (полный снимок версии), segmentations, ui_state.
- Версия отчёта: снимок → Mongo, `sha256` + ссылка → PostgreSQL. Целостность: хеш считается по снимку без поля `sha256`. Откат создаёт **новую** версию.

## Формулы
`K = side_px / side_mm`; площадь полигона по формуле Гаусса; `S_мм² = S_px / K²`; `P_мм = Σ|vᵢvᵢ₊₁| / K`; `δK/K = 0,5 / side_px`; `δS = 2·S·δK/K`.

## Переключение дизайна
`<html data-ui="glass|classic" data-theme="dark|light">`. Для `classic` в `classic.css` действует глобальное правило `animation:none!important; transition:none!important`. Переход в «Новый» выполняется через View Transitions. Настройка хранится в `user_prefs` и в `localStorage` (применяется до отрисовки, без мигания).

## Принятые допущения (ADR-006)
1. «NoSQL» = MongoDB.
2. Python — ядро изображений и расчётов; TypeScript-бэкенд — шлюз/BFF.
3. Docker Compose, внутренняя сеть, наружу только web.
