# Changelog

## 0.3.3

### Fixed

- The card border follows the theme's card border width again, with at least 1 px (0.3.2 made it always 1 px). A theme's bare `0` (Material You) now gives 1 px instead of the browser's thick default.

## 0.3.2

### Fixed

- The card border is always 1 px. A theme with a bare `0` border width (Material You) made it the browser's default thick border.

### Changed

- The card background is the normal card background; the colour is only on the border, the icon, the label and the buttons (and the Alert highlight).
- Glow and pulse are the old notification card's again (glow: the colour from both sides up to 25%; pulse: border and inner shadow).
- The message lines are closer together.
- A Notification Center notification's buttons are always in the order Snooze, Done, Dismiss (or Mute). Snooze has a background only on hover.

## 0.3.1

### Changed

- Notification card editor: the data after the label is set in the Content section (its field is called Data), and Buttons come before Interactions.
- Snooze with "Ask": while the choices are open, the card shows only its icon and the choices, so it stays on one line. The Back button has no background, only on hover.

## 0.3.0

### Added

- **The Notification card** (`custom:notification-center-card`, *Notification* in the card picker), in the look of the tile and alert cards: icon, label with its data, message, Info, and buttons. See the README.
  - With a notification's sensor (`sensor.nc_<name>`) it shows that notification: every open card, with working Done, Dismiss, Mute and Snooze (Ask: 1 h, 3 h, Tomorrow), and it hides itself while nothing is active.
  - On its own it replaces the old notification card: label, message and Info as text, templates or placeholders; colour; highlight (pulse, glow, alert); one data after the label; a tap action and a list of buttons. Every option is in the card editor.
- `notification_center/state/subscribe` gives each notification's sensor (`entity_id`).
- `notification_center/card/action` takes `silence`: the card stays open, its channels stop (a button set to "Keep it silently", such as Mute).

### Changed

- The card in the card picker is now called *Notification*. The Notification Center card with every active notification comes later, as `custom:notification-center`.

## 0.2.10

### Removed

- `event.notification_center`: nothing used it, and it could not be kept out of the Activity log. Its registry entry is removed on the start. Automations can use the Notification state trigger or the sensors.

## 0.2.9

### Changed

- `calendar.notification_center` is a diagnostic entity (it shows in the Diagnostic block of the device) and its state stays off, so it adds no rows to the Activity log. The events are in the calendar views and in `calendar.get_events` as before.
- README: the three entities and the Activity log.

## 0.2.8

### Changed

- A step that starts or ends by the Notification state trigger (also in an automation) is caused by the sensor of the other notification in the Activity log: the other notification's sensor causes this one's.
- A status notification (a step that starts when an entity matches and is done when it stops matching, like an open door) goes back to idle when the entity stops matching, instead of staying as done until midnight. The done event still fires.
- In the Activity log the event entity and the summary sensor each have their own cause, both the notification's sensor; before, they shared one, so the count showed as the cause of the event.
- A card opened because the entity already matched when the notification was loaded (a restart, a saved change) has no state change as its cause.

## 0.2.7

### Fixed

- The Activity log follows the whole chain, in this order: the entity (the door opens) causes the notification's sensor (active), which causes `event.notification_center`. The summary and the event are written after the sensor, so the log can link them to it.
- An entity that stops matching (the door closes) is now the cause of the notification becoming done; before, only the start was linked.
- A new card for an entity whose card was done goes from done straight to active; the sensor no longer shows an idle state in between.

## 0.2.6

### Changed

- In the Activity log the notification's sensor causes `sensor.notification_center` and `event.notification_center` also when the change is time driven (a schedule, an expiry, the end of a snooze). In that case the sensor itself still has no cause.

## 0.2.5

### Changed

- A change with no outside cause (a schedule, an expiry, the end of a snooze) is not linked to anything in the Activity log: the sensor just changes by itself, and so does `sensor.notification_center`.

## 0.2.4

### Changed

- The causes in the Activity log chain up: the entity that started the change (or the action, the button) causes the notification's sensor, and the notification's sensor causes `sensor.notification_center` and `event.notification_center`.

## 0.2.3

### Changed

- The Activity log says why a notification changed: the sensor and the event entity now write their states in a child of the context that caused the change (an entity that started to match, a Done when trigger, an action or a button press), so the Activity panel's "Triggered by" and the cause line work. A change without a cause (a schedule, an expiry, a snooze that ends) shows as made by Notification Center.

## 0.2.2

### Changed

- The calendar shows every scheduled step as an all-day event on the day it is due. The time of day and the expiry only decide when the card shows and goes away; before, a step with a time of day was a timed event that ran until it expired (a bin put out on Wednesday evening spanned two days).
- `sensor.notification_center` is a measurement, so the Activity log no longer lists every change of the count; the sensors of the notifications show what happened.

## 0.2.1

### Changed

- The sensors of the notifications belong to the Notification Center device, like the other entities. Their names now start with the device name ("Notification Center Dishwasher"); the entity ids stay `sensor.nc_<name>`.

## 0.2.0

The engine: notifications show and go away on their triggers and schedules, and Home Assistant sees them as entities, actions, a calendar, automation triggers and Repairs. No card, light, sound or push yet: the development page and the Home Assistant screens show what happens.

### Added

- The engine. Each step has cards: one, or one per entity with the Listed entities trigger. A card is active, hidden (while Hide while is true), snoozed, or closed as done, dismissed or expired. A done card shows as done until midnight.
- Start with Home Assistant triggers and conditions, the Listed entities trigger and the Notification state trigger; Hide while; Done when with triggers and, for Listed entities, when the entity no longer matches (off by default).
- Listed entities groups are resolved live: an entity that starts to match a group gets a card without saving the notification.
- Message and info are templates with the `{Floor}`, `{Area}`, `{Device}`, `{Entity}` and `{State}` placeholders, and `entity`, `trigger` and `data` variables. They follow the entities they read while the card is open.
- Snooze for a time, or until tomorrow: a scheduled step comes back at the time it appeared today, any other at the General setting `snooze_tomorrow_at` (08:00 by default).
- Entities: a sensor per notification (`sensor.nc_<name>`), `sensor.notification_center`, `event.notification_center` and `calendar.notification_center`, with English and Hungarian state names.
- Actions: `notification_center.trigger`, `done`, `clear`, `snooze` and `set_last_done`.
- The modes are worked out live and shown on `sensor.notification_center`.
- Open cards, snoozes and last done times survive a restart.
- The development page shows the live state of every notification, with Done, Snooze (1 h, 3 h, Tomorrow) and Dismiss.
- Schedules: every N days, weeks (on chosen weekdays), months (on a day, or the last day) or years, at a time, counted from a starting date; or N days, weeks, months or years after the step was last done. N can come from an entity; 0 switches the schedule off. A scheduled card can expire; an expired card is not done, and an after-last-done step is due again the next day. A due card waits, hidden, until its Start conditions are true. Times stay right across daylight saving changes.
- An occurrence that fell while Home Assistant was stopped shows after the start, unless it already expired. Snoozes and expiry times survive a restart.
- Notification sensors are `upcoming` on the day a scheduled step is due, and show the next due time.
- `calendar.notification_center`: the occurrences of the scheduled steps. A step with a time is a timed event until it expires (one hour if it does not); one without a time is an all-day event.
- The Notification state and Listed entities triggers and conditions in the automation editor, for your own automations and scripts. The notification is chosen by its sensor and the step by its number.
- Repairs: a missing entity, an interval entity without a number, a template error in a message, or a trigger that could not be set up is listed in Settings → Repairs with the notification's name, and goes away when fixed.
- Diagnostics: download from the integration's menu, with people and push services redacted.

### Changed

- The README says that a Marketplace update needs a restart.
- The `shown` state of the Notification state trigger and condition is now `active`. Stored configurations and imported YAML are changed automatically.

### What to try

1. Update from the Marketplace and restart Home Assistant. Each notification has a `sensor.nc_...` entity; `sensor.notification_center`, `event.notification_center` and `calendar.notification_center` are on the *Notification Center* device.
2. In the panel, every notification shows its live state, its cards with the message, the next due time and the last done time. Done, 1 h, 3 h, Tomorrow and Dismiss act on a card.
3. In Developer tools → Actions, run `notification_center.trigger` on a notification's sensor: its card shows in the panel and the sensor is `active`. `done`, `clear` and `snooze` close or snooze it.
4. Open a door listed in a Listed entities notification: it gets its own card. Close it: the card closes if the step asks for it.
5. The Calendar page shows the scheduled steps.
6. In a new automation, add the *Notification state* trigger (for example when a notification is done).
7. Restart Home Assistant: open and snoozed cards are still there.
8. Settings → Repairs lists the notifications that use entities which do not exist.

## 0.1.0

The data model and storage. Notifications are stored but do not show or sound yet: that comes with the engine in 0.2.

### Added

- The complete configuration schema: categories, notifications with steps, buttons, entities and entity groups, channel settings, modes, people, lights, speakers and chimes. Field names follow the labels of the user interface.
- Storage in `.storage/notification_center`, saved after every change and versioned, so later updates migrate it automatically.
- Default data of a new installation: the *Home* mode and a *General* category.
- Websocket API for reading, creating, changing, deleting, reordering, duplicating and switching off items, with live updates. Changes need an administrator.
- People are listed from the people of Home Assistant; only their push service, device type and sleep entity are stored.
- When an entity id is changed in the entity settings, the configuration follows it.
- YAML import and export. An import replaces the whole configuration after checking it; the previous one is kept as a backup.
- A temporary development page in the panel: the stored configuration in lists, and YAML import and export for administrators.

### What to try

1. Update from the Marketplace. The panel shows the *Home* mode and the *General* category.
2. Import a YAML (for example `tests/fixtures/example_config.yaml`): the 28 notifications and 8 categories appear.
3. Restart Home Assistant: everything is still there.
4. Export: the file holds what you imported.
5. Import a broken YAML (for example rename a field): the import stops with a message that names the field, and nothing changes.

## 0.0.1

The skeleton of the integration. It does not handle notifications yet.

### Added

- Setup from **Settings → Devices & services**, single instance, no questions.
- *Notification Center* sidebar panel (`mdi:message-bulleted`) with an empty page.
- `custom:notification-center-card` dashboard card showing *All clear*. It is loaded on every dashboard automatically.
- Removing the integration deletes its stored data.
- English and Hungarian translations for the setup dialog.

### What to try

1. Install it, restart, and add the integration.
2. Open *Notification Center* in the sidebar: an empty page with the version number.
3. Add the *Notification Center* card to a dashboard from the card picker: it shows *All clear*.
4. Remove the integration: the panel disappears from the sidebar and nothing is logged as an error.
