# Notification Center: notes for Claude

Home Assistant custom integration (HACS) with a sidebar panel and dashboard cards.
Python backend in `custom_components/notification_center/`, TypeScript (Lit) frontend in
`frontend/src/`, built by esbuild into `custom_components/notification_center/frontend/`
(git-ignored, shipped in the release zip). Everything in the repo is in English.

## Reading rules (token budget)

- Never read a file over ~400 lines in full. Find the spot with `grep -n` and read a
  line range. Large files: `engine.py`, `model.py`, `websocket_api.py`, `push.py`,
  `notification-editor.ts`, `step-editor.ts`, and the big test
  files. Engine tests are split: `tests/test_engine*.py` (core, listed, causes, actions).
- `CHANGELOG.md`: read only the top section (`head -40`). `README.md` and `BACKLOG.md`:
  grep for the heading you need.
- Use the file map below instead of exploring the tree.

## Backend map (`custom_components/notification_center/`)

| File | What it holds |
| --- | --- |
| `__init__.py` | Setup and unload; wires store, engine, platforms, panel |
| `const.py` | Constants and keys |
| `model.py` | Config schema (voluptuous): sections at the `# ---` markers; buttons and category buttons (~520-920); `default_config` (~1106); reference checks (~1143); `async_validate_config` (~1449) |
| `normalize.py` | Editor form to stored form |
| `store.py` | Storage of config and runtime state |
| `engine.py` | `Engine`, the core (~175 to end): load, config changes, open/close/snooze, state changes, timers, saving |
| `cards.py` | `Card`, `Overrides`, `StateWatch`, phases and card helpers |
| `runner.py` | `StepRunner` (~151) and `NotificationRunner` (~486): triggers, conditions, listed trackers of a step |
| `engine_queries.py` | `EngineQueries` mixin of `Engine`: own conditions, notification state, summary, snapshot, calendar events |
| `engine_actions.py` | `EngineActions` mixin of `Engine`: trigger/select/close/snooze cards, buttons, button actions |
| `schedule.py`, `scheduler.py` | When a scheduled step is due; running the schedule |
| `channels.py` | Rules every channel follows before sending (modes, audience, timing) |
| `devices.py` | `DeviceManager` (lights, speakers, sirens; tests of a channel) |
| `device_colors.py`, `device_base.py` | Colours, chimes and highlights; the `Device` base class |
| `device_light.py`, `device_speaker.py`, `device_siren.py` | Light, Speaker and Siren channels |
| `push.py` | Push channel (Companion app notify, priorities, buttons) |
| `modes.py` | Current home mode |
| `render.py` | Message and Info line text |
| `sensor.py`, `calendar.py` | Per-notification sensors, summary sensor, calendar |
| `listed.py`, `trigger.py`, `condition.py` | Notification entities / Notification state triggers and conditions |
| `services.py` (+ `services.yaml`) | Actions |
| `websocket_api.py` | Websocket commands for the panel; the YAML export download view |
| `issues.py`, `repairs.py`, `diagnostics.py` | Repairs issues and their fix flow, diagnostics download |
| `media_source.py`, `sounds/` | Built-in sounds |
| `frontend_setup.py` | Registers panel and card |
| `translations/en.json`, `hu.json` | UI strings (keep both in step) |

## Frontend map (`frontend/src/`)

- `shared/`: config types (`config.ts`), live card logic (`live.ts`, `live-card.ts`),
  look of a notification (`notification-view.ts`), formatting, text, store.
- `card/`: dashboard cards and their editors.
- `panel/notification-center-panel.ts`: the panel shell; `settings-page.ts`: Notifications
  list and settings tabs; `settings-*.ts`: General subpages (general, modes, people, lights,
  sound, colors); `category-editor.ts`; `audience-table.ts`, `channel-table.ts` (Audience and Channels tables), `channel-helpers.ts` (their counts, names and summaries), `table-styles.ts`;
  `ha-elements.ts`, `fields.ts`, `confirm.ts`, `dialog-back.ts`: shared UI helpers.
- `panel/editor/`: notification editor (`notification-editor.ts`), its Entities block
  (`entities-block.ts`), one step (`step-editor.ts`), schedule, interaction (button)
  dialog, entity groups, Status dialog (`info-dialog.ts`), condition Test for own
  conditions (`condition-test.ts`), `model.ts` (editor form and conversions). Styles and help texts
  of the big components are in `*.styles.ts` and `step-editor.help.ts` next to them.
- `shared/version.ts` must match the release version.

## Commands

```bash
cd frontend && npm ci && npm run lint && npm run typecheck && npm run build
uv pip install -r requirements_test.txt
ruff check . && ruff format --check . && mypy custom_components tests
pytest tests/test_engine_actions.py -k <name>   # run only the affected tests while fixing
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

## Terminology (UI, help texts, README, CHANGELOG)

- **notification**: what is shown, when true for the push and the dashboard alike;
  **dashboard notification** when true only on the Dashboard (Overview and dashboard
  cards). The two dashboard card types keep *card*. Say **Overview**, never *panel*.
- **home mode**: the house's situation (Home, Away, Night, ...). Always "home mode" in
  full, lowercase mid-sentence; never just "mode" or "Home".
- **person state**: *At home*, *Asleep*, *Not home* (keys `home`, `sleep`, `away`).
  Never "Away" for a person. Changes: arrive home, wake up, go to sleep, leave home.
- **Channels**: how the notification is delivered in each home mode. **Audience**: who
  gets it in each state. Both must allow a channel (AND, home mode checked first), so
  Channels comes first in the editors.
- Step blocks: Message, Interactions, Activation, Conditions (*Activate only while
  conditions are met*, *Hide while conditions are not met*), Done when, Channels,
  Audience. Each block opens with a one-line intro (`BLOCK_INTROS` in `editor/block.ts`).
- **done** is an outcome (the Done button and status), not a block name. Built-in
  buttons: Done, Dismiss, Snooze; plus Tap behavior.
- Statuses: active, upcoming, snoozed, done, dismissed, expired. Upcoming lines start
  with *Shows ...*; people by name, *someone* above three.
