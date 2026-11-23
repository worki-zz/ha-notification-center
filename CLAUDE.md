# Notification Center: notes for Claude

Home Assistant custom integration (HACS) with a sidebar panel and dashboard cards.
Python backend in `custom_components/notification_center/`, TypeScript (Lit) frontend in
`frontend/src/`, built by esbuild into `custom_components/notification_center/frontend/`
(git-ignored, shipped in the release zip). Everything in the repo is in English.

## Reading rules (token budget)

- Never read a file over ~400 lines in full. Find the spot with `grep -n` and read a
  line range. Large files: `engine.py`, `model.py`, `devices.py`, `websocket_api.py`,
  `push.py`, `notification-editor.ts`, `step-editor.ts`, `channel-tables.ts`, and the
  big test files.
- `CHANGELOG.md`: read only the top section (`head -40`). `README.md` and `BACKLOG.md`:
  grep for the heading you need.
- Use the file map below instead of exploring the tree.

## Backend map (`custom_components/notification_center/`)

| File | What it holds |
| --- | --- |
| `__init__.py` | Setup and unload; wires store, engine, platforms, panel |
| `const.py` | Constants and keys |
| `model.py` | Config schema (voluptuous): sections at the `# ---` markers; buttons and category buttons (~520-920); `default_config` (~1077); reference checks (~1114); 0.x `upgrade_*` migrations (~1190-1700, removed at 1.0); `async_validate_config` (~1820) |
| `normalize.py` | Editor form to stored form |
| `store.py` | Storage of config and runtime state |
| `engine.py` | When a card shows and goes away: `Card` (~218), `StepRunner` (~468), `NotificationRunner` (~803), `Engine` (~850 to end) |
| `schedule.py`, `scheduler.py` | When a scheduled step is due; running the schedule |
| `channels.py` | Rules every channel follows before sending (modes, audience, timing) |
| `devices.py` | Light (~447), Speaker (~816), Siren (~1105) channels, `DeviceManager` (~202), colours and chimes (top) |
| `push.py` | Push channel (Companion app notify, priorities, buttons) |
| `modes.py` | Current home mode |
| `render.py` | Message and Info line text |
| `sensor.py`, `calendar.py` | Per-notification sensors, summary sensor, calendar |
| `listed.py`, `trigger.py`, `condition.py` | Notification entities / Notification state triggers and conditions |
| `services.py` (+ `services.yaml`) | Actions |
| `websocket_api.py` | Websocket commands for the panel |
| `issues.py`, `diagnostics.py` | Repairs, diagnostics download |
| `media_source.py`, `sounds/` | Built-in sounds |
| `frontend_setup.py` | Registers panel and card |
| `translations/en.json`, `hu.json` | UI strings (keep both in step) |

## Frontend map (`frontend/src/`)

- `shared/`: config types (`config.ts`), live card logic (`live.ts`, `live-card.ts`),
  look of a notification (`notification-view.ts`), formatting, text, store.
- `card/`: dashboard cards and their editors.
- `panel/notification-center-panel.ts`: the panel shell; `settings-page.ts`: Notifications
  list and settings tabs; `settings-*.ts`: General subpages (general, modes, people, lights,
  sound, colors); `category-editor.ts`; `channel-tables.ts` (Audience and Channels tables);
  `ha-elements.ts`, `fields.ts`, `confirm.ts`, `dialog-back.ts`: shared UI helpers.
- `panel/editor/`: notification editor (`notification-editor.ts`), one step
  (`step-editor.ts`), schedule, interaction (button) dialog, entity groups, `model.ts`
  (editor form and conversions).
- `shared/version.ts` must match the release version.

## Commands

```bash
cd frontend && npm ci && npm run lint && npm run typecheck && npm run build
uv pip install -r requirements_test.txt
ruff check . && ruff format --check . && mypy custom_components tests
pytest tests/test_engine.py -k <name>   # run only the affected tests while fixing
python scripts/check_version.py         # all version numbers equal
```

CI (`.github/workflows/ci.yml`) runs all of the above on every PR: rely on it for the full
suite instead of running everything locally.

## Conventions

- Versions `0.<phase>.<fix>` (fix may pass 9: `0.4.16`). Same number in `manifest.json`,
  `frontend/package.json`, `pyproject.toml`, `frontend/src/shared/version.ts`.
- Small fixes and CRs do not release on their own: CHANGELOG entry under `## Unreleased`,
  merged without a version bump. A release (once a day or on request) renames that
  section and bumps the versions; `release.yml` (workflow_dispatch with the version)
  builds the zip, tag and GitHub release.
- New deferred ideas go to `BACKLOG.md` under Low unless a priority is agreed.
- Use Home Assistant's own UI elements wherever possible; discuss exceptions first.
- Same padding at the sides, the top and between elements. Previews show real values.
- HA frontend gotcha: define custom elements after
  `customElements.whenDefined('home-assistant')` (see `shared/define.ts`).
- Test data in the repo is anonymized (the repo is public).
