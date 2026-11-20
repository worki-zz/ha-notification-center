# Changelog

## 0.4.16

### Added

- Entity groups: every member's row opens its dialog, where each entity action can be switched to a **Custom action** for that member (it starts as a copy of the group's, so usually only the entity changes). Stored as `member_actions` in the group; the order is the entity's own action, the member's custom action, then the group's.

## 0.4.15

### Changed

- Button and entity group dialogs: the switches (*Show button in the push notification*, *Also when the push notification is tapped*, *Add new matching entities*) are at the start of a compact row; a line above the Snooze times, none above *Add new matching entities*.

### Fixed

- The Snooze times showed no names in some Home Assistant versions.

## 0.4.14

### Added

- Tap behavior (formerly *Tap on the card*): *Also when the push notification is tapped* (`push_tap`, on by default; used by the push channel in phase 6).

### Changed

- Overview and Schedule: as much room under a section title as between two cards.
- Message parameters: *{Device class}* comes before *{Entity}*.
- Button dialogs: no explanations; the built-in buttons' labels are set only in YAML; *Show button in the push notification* comes right after the icon (for Snooze with more times it says which time the push uses); the Snooze times are a compact grid of checkboxes; a line above the Action, which is empty for nothing and can be cleared. A button whose action is Nothing shows no action in the list.
- *Entity category* is now *Entity group* (as `entity_groups` in YAML). Its dialog: *Entity actions* and *Settings* tabs (it opens on the actions; a new group has only the settings); "N matching entities"; no explanation under *Add new matching entities*.
- The Notification entities panel of Activation is a card like the trigger rows.

### Fixed

- Trigger, condition and action rows of Home Assistant's editors were half as tall again as in Home Assistant.

## 0.4.13

### Added

- Message parameter **{Device class}**: the device class of the card's entity by its Home Assistant name (*Moisture*). Device classes are shown by these names in the editor too.

### Changed

- Editor, step: the blocks are Message, Interactions, then Activation, Conditions and Done (*Done when* is now *Done*), then Audience, with more room between the groups and as much room between blocks as above the steps.
- Editor: every switch is at the start of its row. Rows of buttons, entities and entity categories open their dialog anywhere on the row and have an edit button at the end. The entities of a category have their own icon, and their switches line up with the category's.
- Editor, Activation and Done: the built-in rows (Notification entities, Done when activation conditions no longer true) are above the Triggers title; Notification entities has the background of the other built-in rows and even padding.
- Editor, Message: the parameters sit closer to the message; with no Data, Info and Data share a row; the Data fields line up.
- Editor, Interactions: no *Custom buttons* title over the own buttons.
- Entity dialog: the entity cannot be changed there any more (its name is the title), only deleted. Entity category dialog: the number of matching entities is an info box, the *Add new matching entities* row is tighter, and *Entity actions* and the button names under it stand out more.
- More info action: the entity picker works as Data's (empty is the card's entity).
- Settings list: more room after the drag handle; the icon is formatted as the tile card's; the status chips use the entity badges' rounding. Audience pictures use Home Assistant's rounding.
- Schedule: the section titles are *This week*, *This month*, *This year* and *Next year*; a date is written with its weekday in full, date first (*Nov 15, Wednesday*).

### Fixed

- Adding an action in a dialog (a button's Action, Entity actions) works again; the dialog no longer closes.
- *Leave* on the unsaved changes question goes to the list again instead of staying in the editor.

## 0.4.12

### Changed

- New names in the editor and in YAML: **Start** is **Activation** (`activation`), **Show when** is **Conditions** (`conditions`), with *Activate only while conditions are met* (`activate_only_while_met`) and *Hide active notification while conditions are not met* (`hide_while_not_met`); *Start condition no longer true* is *Done when activation conditions no longer true* (`activation_conditions_no_longer_true`). Saved notifications and imported YAML with the earlier names are turned into the new ones by themselves.
- Editor, Activation: the title shows *Schedule* or *Repeat* instead of a number when the step is not started by triggers.
- Editor, Interactions: *Tap on the card* is on its own above *Buttons*; own buttons are in their own list, *Custom buttons*.
- Editor: no explanations under the Conditions switches, Done when's built-in item and Audience, and no *Entity parameters* label before the parameters.
- Overview: the Done and Schedule buttons sit side by side in the middle again (Done first).

### Fixed

- Back (browser or phone) closes an open dialog instead of leaving the editor.

## 0.4.11

### Added

- Editor, step: **Audience** block: every person with a switch and their picture or initials, and the number on in the title (2/3). All on means everyone, people added later too.
- Editor menu: **Edit in YAML**, the whole notification in Home Assistant's YAML editor; *Edit in visual editor* goes back. Undo, Redo and the preview follow the YAML.

## 0.4.10

### Added

- Editor, step: **Interactions** block with the card's buttons: *Tap on the card*, *Done*, *Dismiss*, *Snooze* and own buttons (*Add button*). A row opens the button's dialog (label, icon, Action, Show in push; Delete for own buttons); its switch turns it on or off.
- Each button's **Action**: Nothing, Entity action, More info, Action (Home Assistant's action editor) or Navigate.
- **Snooze times** in the Snooze button's dialog: 15 and 30 minutes, 1, 2, 3, 6 and 12 hours, Tomorrow, 2 and 3 days, 1 and 2 weeks, 1 month (by default 1 h, 3 h and Tomorrow). With more than one, the card offers them. Days come back on that day at the step's time (a scheduled step) or at 8:00.
- **Show in push** per button (on by default for Done, Dismiss and Snooze). Stored now, used by the push channel later.
- Entity and entity category dialogs: **Entity actions**, one for each switched-on button whose Action is Entity action.

### Changed

- What a button does to the card is fixed: Done closes it, Dismiss dismisses it, Snooze snoozes it. Tap and own buttons no longer close or snooze the card; they only run their action.
- The notification-wide Snooze setting moved to the Snooze button. Saved durations become the nearest snooze time; "Ask" becomes the default times; "Not allowed" switches the Snooze button off.
- A Dismiss that kept the card silently (Mute) becomes an own button named *Mute*, keeping its entity actions.

## 0.4.9

### Changed

- Start conditions and Hide while are now one block, **Show when**, with one set of conditions and two switches: *Start while conditions are met* (the step starts only when they are true; a scheduled card waits for them) and *Hide while conditions are not met* (an open card shows only while they are true). Both are on for a new step. Start no longer has conditions of its own.
- Saved steps are turned into Show when by themselves: Start conditions alone switch on the start only; Hide while alone becomes its opposite (a Not condition) with the hiding only; with both, the card needs the Start conditions and not Hide while, at the start and while open.
- Done when, *Start condition no longer true*: also closes a card when the Show when conditions it started with are no longer met (with *Start while conditions are met* on, for a triggered step).

## 0.4.8

### Changed

- Editor, Notification entities: *Type* (State or Numeric state) is a dropdown in one row with Attribute, before it. Attribute left empty means the state itself, and a chosen attribute can be cleared. Left empty, the block starts on Numeric state when every listed entity has a number. The block's spacing is fixed, open and closed.
- Editor, Entities: *Add entity* has a plus icon.
- Editor: a disabled step's notice has an *Enable* button on the right.
- Settings and the editor have as much room under the header as the overview.
- Settings list: the drag handle is Home Assistant's own icon.

## 0.4.7

### Changed

- Editor, Message: Message and Info take the full width, with Info under the entity parameters. On a narrow screen Data, Time and Format each take a full row.
- Editor, steps: no frame around the steps under the tabs, and no number in front of the tab when there is only one step. A tab names its step without braces (`{Area}` reads as Area).
- Editor, Start: *Notification entities* is a collapsible block, collapsed by default, without the explanation under its title. Attribute comes first and offers *State* (the state itself) instead of being empty, then State or Numeric state. Switching between the two keeps what was filled in on the other side until saving. Above and Below sit side by side on a wide screen.
- Editor: Notification entities and the Entities block use the icon of *Start condition no longer true*; the built-in Start and Done items have amber icons.

## 0.4.6

### Changed

- Switching a notification (or a step) off still clears its cards. Switched on again, it works out what is due, as after a restart: an entity that matches gets its card, and a scheduled occurrence that is not done, dismissed or expired comes back. A card started only by an action (the Trigger action) does not.

## 0.4.5

### Changed

- The Listed entities trigger and condition are now two, after Home Assistant's own State and Numeric state: *Notification entities state* (is or is not some states, of the state or an attribute, with For as a duration or a template) and *Notification entities numeric state* (above and below, each a fixed number or the value of an entity, a value template, an attribute and For). Their notification is required, so a step can also watch the entities of another notification. In the editor they show Home Assistant's compact form instead of a check box per field. Saved Listed entities items are turned into one of the two by themselves (with a limit, Numeric state).
- Start: *Notification entities* sits at the top of Triggers when the notification lists entities, with State or Numeric state to choose. It edits the first trigger, on the notification's own entities; left empty it is not saved. A new notification whose listed entities are all on or off (binary sensors, switches and the like) starts with *Is on*.
- Done when: *Start condition no longer true* follows Notification entities at the top of Start.
- Overview: less room above the Done and Schedule buttons (24 px from the last card instead of 40 px).

### Fixed

- An open card kept its old message, Info and Custom data after the step was edited; it now follows the saved step.

## 0.4.4

### Changed

- Repeat: the number is titled *Every*, and the choice before it is *Type* (*Manual* or *Entity*).
- Schedule and Repeat: the At time, the entity with the number and the Expires duration and time have no title, and the weekday buttons sit in line with the fields, so a row lines up. Times have no seconds.
- Expires on: *Same day* or *Next day*.
- Expires after: hours only, no days field (hours can be more than 24).

### Added

- Icons for the Listed entities and Notification state triggers and conditions, and for the actions.

## 0.4.3

### Changed

- Steps: the steps card has the card background and its blocks the page background.
- Entity category dialog: Floors only when Home Assistant has floors; the entity count above the switch, with a line between; Labels without a title.
- Data: *Custom* is a plain text field (templates still work). *Entity state*: the entity field has no title and shows *Active entity* when empty; Attribute lists *State* first and selects it by default (in YAML, no attribute still means the state).

- Schedule: a card under *Week* shows only its weekday, in full (such as *Saturday*).
- On the Overview, Done sits at the left edge of the cards and Schedule at the right.
- Done today: "Done 12:26" is on the line under the texts, as on Schedule, not after the label.

### Fixed

- The Triggers / Schedule / Repeat switch showed nothing until another Home Assistant page had loaded its element; the editor now loads the elements it uses itself.
- An open trigger was wider than its card (Home Assistant's trigger editor lacks the padding outside the automation editor's sidebar).

## 0.4.2

### Changed

- Data has three choices, empty meaning nothing: *Notification* (Active since or Last done; Due is merged into Active since, and a saved Due reads as Active since), *Entity state* (an entity, empty for the card's own, and an attribute: empty for the state, any attribute, Last changed or Last updated) and *Custom* (a template). A time has its format beside it.
- The `{Floor}` parameter shows only when Home Assistant has floors.
- The step's blocks sit on a different background from the steps card.
- Blocks draw their content only while open, so the editor opens faster.

### Added

- Data `last_updated`: the entity's last update time.

### Fixed

- The trigger and condition editors show all their texts (such as *Add trigger*) without opening Home Assistant's Settings first.

## 0.4.1

### Changed

- Settings: the Notifications and General tabs sit in the header, as on the Devices & services page. The category filter is a compact chip next to a compact search, and the list uses Home Assistant's list rows: drag handle on the left, the icon on the category colour, the whole row clickable.
- Editor blocks are Home Assistant's expansion panels with an icon and a count. Step tabs are numbered, with Add step and the step menu on the right.
- Settings block: the category shows its icon; Icon and Card color share a row and show the category's values when empty; no helper texts. Light color leaves the Settings block (it goes to the light channel settings in phase 6).
- Entities: names as in Home Assistant's pickers with area and device, a pencil to edit or delete an entity, each entity category as its own list, always open, with its entities aligned under its name. Add entity opens Home Assistant's entity list under the button.
- Message: Message and Info side by side, entity parameters as code chips, then *Data* with its options beside it. Entity state and Entity attribute are one choice, *Entity state*, with an Attribute field (State by default) and the card's entity by default. *Custom text* is now *Custom*.
- Start: a compact Triggers / Schedule / Repeat switch; the schedule fields share rows.

- The panel's Later page is now **Schedule** (calendar icon): its cards are grouped under *Week*, the current month, *Year* and *Next year*, only the groups with something in them, with room above each title; a card shows its day without the time.
- On the Overview, Schedule sits at the left edge of the cards and Done at the right.
- An empty page shows one neutral card: *All done* on the Overview.
- The Notification Center card's placeholder (dashboard edit mode) says *All done*, in normal text colour, with the tile card's neutral icon colour and the border of an inactive card.

### Fixed

- The panel header stays in place on every page (Overview, Schedule, Done today and Settings): the page under it scrolls, not the whole panel.

## 0.4.0

### Added

- The notification editor (phase 4.1). Settings now has two tabs: **Notifications**, the list of notifications (status chip, search, category filter, drag to reorder, Run now, Duplicate, Disable, Delete, Add notification), and **General** (the earlier settings page, with YAML import and export at the bottom).
- The editor, in Home Assistant's automation editor layout: header with status, Undo and Redo, Enabled switch and menu (Information, Run now, Clear notifications, Duplicate, Disable, Delete); a live preview of the selected step's card; the Settings, Entities and step blocks (Message, Start, Hide while, Done when) with Home Assistant's own trigger and condition editors.
- Schedule and Repeat starts show their next times; Repeat's next time can be set (stored as last done).
- Entity categories take several floors, areas and labels; *Add new matching entities* off keeps the entities matched when saved.
- Expires on a day: the same or a later day at a time, besides a duration.
- A step's Data: the text after the card's label (active since, due, last done, an entity's state, attribute or last change, or a custom template).
- Websocket commands `schedule/preview`, `step/set_next` and `text/preview`.

### Changed

- A card shows no data after its label unless its step's Data says so (it was the time since it opened).
- A Repeat (after last done) step that was never done counts from when it got its schedule, so a new one is not due at once.
- Inside a notification, the integration's triggers and conditions are also accepted in Home Assistant's automation form (`options`); the Notification state trigger without a notification means the notification itself, and a step number is stored as the step's id.
- A step made in the editor has Snooze switched off.
- An entity category's `area` and `label` are now the lists `areas` and `labels` (the earlier form is still read).

## 0.3.10

### Changed

- Done today cards look like the Later cards: the border of a Home Assistant card.
- Later and Done are plain buttons (a background only on hover), and show only when their page has something; Done today is "Done · N" on the Overview. The "N more" button of the Notification Center card is plain too.
- More room under the header and above the Later and Done buttons.
- The settings button is on the Later and Done today pages too.

## 0.3.9

### Changed

- The panel header looks like a dashboard's: the theme's header colours and border, the same title and button positions, and a shadow while the page is scrolled.
- Upcoming and Later cards have the border of a Home Assistant card.
- Later, Done today and the "N more" button of the Notification Center card look like the Export and Import buttons.

## 0.3.8

### Added

- Icon and logo (in the integration's `brand` folder, light and dark): the sidebar icon in white on a deep purple rounded square, with the name beside it in the logo.

### Changed

- Upcoming and Later cards keep their colour on the icon and the label; only the border and the buttons are grey, and the texts have their normal colour.
- Notification Center card: "N more" is a Home Assistant button.
- Done today: the time reads "Done 12:26".

## 0.3.7

### Changed

- Overview and Later as in the plan: under the active cards, *Upcoming* lists the steps due today and the snoozed cards together, by time, in a neutral colour, with an extra line for when they come ("Snoozed until 15:00"). Later only lists the scheduled steps due after today. A card hidden by Hide while is not listed.

## 0.3.6

### Changed

- Panel: the header stays in place and has no background of its own, like a dashboard's. More room below it and between the cards (twice a dashboard's gap).
- Overview: Later and Done today are Home Assistant buttons again; Done today shows the count after a dot when it is not 0.
- Later: no section titles; the cards hidden for now come first, then the snoozed cards and the scheduled steps by their time.
- Notification Center card: the row is "1 more", without an icon.

## 0.3.5

### Changed

- Button order: Snooze, the own buttons, Done, Dismiss (or Mute).
- A scheduled step marked Done before its time is a normal done card: it shows in Done today, the notification is done today, and the Activity log names who did it. Its button is called Done.
- Later and Done today on the Overview, and the "N more" row of the Notification Center card, are Home Assistant list rows (with the count and an arrow).

## 0.3.4

### Added

- **The Notification Center card** (`custom:notification-center`, *Notification Center* in the card picker): every active card in list order, with working buttons. Options: categories, maximum cards (a "+N more" row opens the Notification Center) and Ignore audience. It hides itself while nothing is active; the dashboard editor shows a *Notification Center* placeholder.
- **Overview in the panel**: the active cards, and the scheduled steps still to come today in a neutral colour. **Later** (snoozed, hidden for now, upcoming after today) and **Done today** are behind their buttons. Administrators reach the settings (YAML import and export, the stored configuration) from the gear in the header.
- **Every button works**: own buttons, the tap on the card, and each button's action: Home Assistant action, Entity action, More info, Navigate. The same in the panel, on the Notification Center card and on the Notification card of a notification's sensor.
- **Done early** for a scheduled step that is not due yet: a calendar step skips its next occurrence, an "after last done" step counts from now.
- Cards are shown to the step's audience (empty means everyone).
- Websocket commands `notification_center/card/press` and `notification_center/step/done_early`; `state/subscribe` gives each notification's upcoming steps.

### Changed

- The Activity log names the user who changed a notification's state (for example "Washing machine → Done, By Kristóf").
- A Snooze button snoozes for its own time, else the notification's or category's; "Ask" offers 1 h, 3 h and Tomorrow.

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
