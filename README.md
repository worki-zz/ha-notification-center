# Notification Center

A Home Assistant integration that manages every notification of your home in one place: when it shows, how it looks, which channels it uses (lights, speakers, phones), and when it goes away.

> **Status: early development (0.x).** Notifications are stored, the engine decides when they show, and a dashboard card shows them; there is no light, sound or push yet. Each release in the [changelog](CHANGELOG.md) says what to try.

## Requirements

- Home Assistant 2026.11.0 or newer.

## Installation

### Marketplace (HACS)

1. In Home Assistant open **Settings → Marketplace** (HACS before Home Assistant 2026.11).
2. Open the menu, choose **Custom repositories**, and add `https://github.com/worki-zz/ha-notification-center` with the type **Integration**. Custom repositories need a GitHub connection, which the Marketplace asks for the first time.
3. Find **Notification Center** in the list and download it. The Marketplace installs and sets it up; no restart is needed.

**Updating:** after the Marketplace downloads a new version, restart Home Assistant. Until then the previous version keeps running.

### Manual

1. Download `notification_center.zip` from the [latest release](https://github.com/worki-zz/ha-notification-center/releases/latest).
2. Unpack it into `config/custom_components/notification_center/`.
3. Restart Home Assistant, then go to **Settings → Devices & services → Add integration** and choose **Notification Center**.

The release zip contains the built frontend. The repository itself does not, so copying the source folder without building it gives an empty panel.

## What you get

- **Sidebar panel:** *Notification Center*. Every user can open it. See [The panel](#the-panel).
- **Dashboard cards**, in the card picker: *Notification Center* (`custom:notification-center`), every active card, and *Notification* (`custom:notification-center-card`), one notification. The integration loads them on every dashboard, so you do not add a resource by hand. See [The Notification Center card](#the-notification-center-card) and [The Notification card](#the-notification-card).

- **A sensor per notification:** `sensor.nc_<name>`, for example `sensor.nc_dishwasher`. Its state is the most important state of its cards: `active`, `hidden`, `snoozed`, `upcoming`, `done` (today), `idle` or `disabled`. The attributes tell the number of active cards, the active step, the entities of a step started by its entities, the message, the snooze end and the last done time. The entity id stays when the notification is renamed.
- **`sensor.notification_center`:** the number of active cards, with the current mode, the counts per category and the top notification as attributes.
- **`calendar.notification_center`:** a diagnostic entity, always off (so it stays out of the Activity log). The occurrences of the scheduled steps, as all-day events on the day they are due. The time of day (At) and the expiry only tell when the card shows and goes away.
- **Actions:** `notification_center.trigger`, `done`, `clear`, `snooze` and `set_last_done`. They target the sensor of a notification and take the step number (`step`, default 1) and, for a step started by its entities, its `entity`:

  ```yaml
  action: notification_center.trigger
  target:
    entity_id: sensor.nc_doorbell
  data:
    message: "Someone is at the door"
    attachments:
      - camera: camera.front_door
    data:
      visitor: "{{ states('sensor.doorbell_last_person') }}"
  ```

- **Automation triggers and conditions:** *Notification state* (a notification or one of its steps became active, done, snoozed or dismissed; as a condition also "within the last …") and *Notification entities state* and *Notification entities numeric state* (an entity listed in a notification gets a state, or gets above or below a limit), in the automation editor.
- **Repairs and diagnostics:** problems such as a missing entity are listed in Settings → Repairs; diagnostics can be downloaded from the integration's menu, with people and push services redacted.

Open cards, snoozes and last done times are kept in `.storage/notification_center.runtime`, so they survive a restart. Removing the integration also deletes its stored data.

## The panel

The **Overview** shows the active cards meant for you, with their buttons. Below them, under *Upcoming*, the scheduled steps due today and the snoozed cards in one list, by time, in a neutral colour, with a line that tells when they come. **Schedule** lists the scheduled steps due after today, by their next day, under *Week*, the current month, *Year* and *Next year* (only the ones with something in them); **Done today** the cards done today. A scheduled step is meant for its day; its time only says when it reaches you. So a step that is not due yet can be marked *Done* already: it shows in Done today like any done card, a calendar step skips its next occurrence, and an "after last done" step counts from now. A card hidden by *Show when* is not shown. Administrators find the settings behind the gear in the header (see [Settings](#settings)).

## Settings

The settings use Home Assistant's own layout and elements, with the tabs in the header as on the Devices & services page. **Notifications** lists every notification with its category (and its number of steps), and a status chip: *Active*, *Upcoming* (due today), *Snoozed* or *Disabled*. Search and the *Category* filter chip narrow the list; drag a row by its handle to reorder (not while filtering). The row menu has Run now, Duplicate, Disable and Delete. **General** shows what is set up and, at the bottom, YAML export and import.

### The notification editor

Laid out like the automation editor: the name and status in the header, Undo and Redo (Ctrl+Z, Ctrl+Y), the Enabled switch (saved at once) and the menu: *Information* (the sensor's dialog, where its entity id can be changed), *Run now* (the selected step, like the Trigger action), *Clear notifications*, *Duplicate* (a disabled copy), *Disable* and *Delete*. Under the header a preview of the selected step's card, with the templates rendered for the first listed entity. Save appears when something changed; leaving asks first.

- **Settings:** name, category, icon and card colour. Left empty, the icon and the colour come from the category (shown in the fields). The light colour moves to the light channel settings (phase 6).
- **Entities:** single entities and entity categories (a domain with an optional device class, floors, areas and labels). Entities are named as in Home Assistant's pickers, with their area and device; the pencil edits or deletes. Each category is its own list, always open, and each of its entities can be switched off on its own; *Add new matching entities* off keeps the entities that matched when it was saved. A category that matches nothing yet is fine.
- **Steps**, as tabs, with Add step and a menu (Run this step, Duplicate, Move left or right, Disable, Delete). Each step has:
  - **Message:** the message, the Info line, the entity parameters `{Floor}`, `{Area}`, `{Device}`, `{Entity}`, `{State}`, and the *Data* after the label: empty for nothing, *Notification* (active since, last done), *Entity state* (the active entity unless another is chosen; the state (default), an attribute, last changed or last updated) or *Custom* (a text, templates work). `{Floor}` shows only when there are floors.
  - **Start:** *Triggers*: at the top *Notification entities*, shown when the notification lists entities: *State* (is or is not some states) or *Numeric state* (above or below a number or an entity's value, or a template), of the state or an attribute, with For. Every entity gets its own card when it starts to match. Left empty it is not used; a new notification whose entities are all on or off starts with *Is on*. It is the first trigger in YAML. Below it Home Assistant's trigger editor (none means only the Trigger action starts it); the Notification entities triggers and conditions there take any notification and show the same compact form. *Schedule* (the calendar) or *Repeat* (after last done). Both show when they come next; Repeat's next time can be set with the pencil (it is stored as the last done time). A card can expire after a duration or on the same or a later day at a time.
  - **Show when:** one set of conditions (Home Assistant's condition editor) with two switches: *Start while conditions are met* (the step starts only when they are true; a scheduled card waits for them, hidden, until it expires) and *Hide while conditions are not met* (an open card shows only while they are true). Earlier Start conditions and Hide while are turned into Show when by themselves (Hide while as Not).
  - **Done when:** Home Assistant's trigger editor, and when Notification entities is set at the top of Start or Show when is used at the start, *Start condition no longer true* (an entity's card closes when that entity stops matching; a card closes when Show when is no longer met).

Inside a notification, the Notification state trigger with no notification means this one, and its step is given by number; they are stored by id, so they keep pointing to the same step.

## Buttons

A card's buttons work the same in the panel and on both cards. A button first changes the card (Done, Snooze, Dismiss, Keep it silently, or keep it as it is), then does its action:

- **Home Assistant action** and **Entity action** (the listed entity's own action for that button) run in Home Assistant, as the user who pressed the button.
- **More info** opens the entity's dialog (the button's entity, else the card's entity, else the notification's sensor); **Navigate** opens a page.

The card itself reacts to a tap when its Tap button is switched on. The buttons are always in the order: Snooze, own buttons, Done, Dismiss (or Mute). A step's audience decides who sees the card: empty means everyone. The Activity log names the user who changed a notification's state.

## The Notification Center card

Every active card of the Notification Center on a dashboard, in list order, with working buttons. It hides itself while nothing is active and leaves no gap; in the dashboard editor it shows a *Notification Center* placeholder instead.

| Option | Description |
| --- | --- |
| `categories` | Only these categories (their ids). Default: all. |
| `max_cards` | At most this many cards; an "N more" row opens the Notification Center. Default: all. |
| `ignore_audience` | Also show the cards meant for other people. Default: `false`, only the cards whose audience includes the logged in user's person (or is empty). |

```yaml
type: custom:notification-center
categories: [emergency, chores]
max_cards: 3
```

## The Notification card

One notification on a dashboard, in the look of the tile and alert cards: an icon, a label with a short data after it, the message, an optional second line (Info), and buttons on the right. The card colour is used for the border, the icon, the label and the buttons; the background is the normal card background.

**With a Notification Center notification:** choose its sensor (`sensor.nc_<name>`) as the entity, and everything comes from the Notification Center: name, icon, colour, message and Info. Every active card of the notification shows (a notification started by its entities can have several), with all its buttons and its tap (see [Buttons](#buttons)). Snooze with "Ask" offers 1 h, 3 h and Tomorrow on the card. The card hides itself while nothing is active (in the dashboard editor it shows a placeholder instead).

```yaml
type: custom:notification-center-card
entity: sensor.nc_washing_machine
```

**On its own:** with any other entity (or none), the card shows what its options say; when it shows is up to the card's Visibility tab. All options are in the card editor:

| Option | Description |
| --- | --- |
| `entity` | Gives the default label (the device or entity name), the icon, and the data. |
| `label`, `message`, `info` | Text. A template (`{{ … }}`) and the placeholders `{Floor}`, `{Area}`, `{Device}`, `{Entity}` and `{State}` of the entity work too. |
| `icon` | Default: the entity's icon. |
| `color` | A colour name of the colour picker (`red`, `teal`, …), a CSS colour (`#ff9800`) or RGB (`[255, 152, 0]`). Default: the primary colour. |
| `highlight` | `none` (default), `pulse`, `glow`, or `alert` (the background pulses like the alert card). With reduced motion it stays still. |
| `data` | The data after the label. `type`: `state`, `attribute` (with `attribute`), `last_changed`, `last_updated` or `custom` (with `custom`, a text or template). For a time, `time_format`: `relative` (default), `duration`, `time`, `date` or `datetime`. A time within five minutes of the last restart is left out. |
| `tap_action` | A Home Assistant action for a tap on the card. Default: nothing. |
| `buttons` | A list of buttons, each with `icon`, `label` (the tooltip) and `tap_action`. Default: none. |

```yaml
type: custom:notification-center-card
entity: binary_sensor.dishwasher_leak
label: Water leak
message: Water leak at the {Device}!
icon: mdi:dishwasher
color: red
highlight: glow
data:
  type: last_changed
buttons:
  - icon: mdi:volume-off
    label: Mute
    tap_action:
      action: perform-action
      perform_action: switch.toggle
      target:
        entity_id: switch.dishwasher_leak_mute
visibility:
  - condition: state
    entity: binary_sensor.dishwasher_leak
    state: "on"
```

After an update the card follows the new version once Home Assistant is restarted and the browser page is reloaded.

## Development

The integration is in `custom_components/notification_center`. The panel and the card are TypeScript and Lit, in `frontend/`.

```bash
# Frontend: install, check and build into custom_components/notification_center/frontend/
cd frontend
npm ci
npm run lint
npm run typecheck
npm run build

# Python 3.14: lint, type check and test (build the frontend first)
uv venv -p 3.14 && source .venv/bin/activate
uv pip install -r requirements_test.txt
ruff check . && ruff format --check .
mypy custom_components tests
pytest
```

Every version number (manifest, `pyproject.toml`, `frontend/package.json`, `frontend/src/shared/version.ts`) must match; `python scripts/check_version.py` checks this, and the release workflow also compares it with the tag.

To release, run the *Release* workflow from the Actions tab with the version (for example `0.0.1`). It checks the versions, builds the frontend, and creates the tag and the GitHub release with `notification_center.zip` and the matching changelog section. A release published by hand also gets the zip attached.
Ideas deferred to after 1.0 are collected in [BACKLOG.md](BACKLOG.md).

## License

MIT, see [LICENSE](LICENSE).
