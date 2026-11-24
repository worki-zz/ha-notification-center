# Notification Center

A Home Assistant integration that manages every notification of your home in one place: when it shows, how it looks, which channels it uses (lights, speakers, phones), and when it goes away.

> **Status: early development (0.x).** The engine, the Overview and the editor, the dashboard cards, and the light, speaker, siren and push channels all work. Until 1.0 the data model may still change; each release in the [changelog](CHANGELOG.md) says what changed.

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

The release zip contains the built frontend. The repository itself does not, so copying the source folder without building it gives an empty Overview.

## Concepts

A few words are used the same way everywhere, in the Overview and in this document:

- **Notification:** what you set up in the editor: a message with its steps, buttons and channels. It belongs to a **category**, which gives it its defaults (buttons, audience, channels, colour).
- **Step:** one stage of a notification. It says when it starts, when it is done, what it shows and who gets it. Several steps make a sequence, for example a reminder that gets louder.
- **Active notification:** the live result of a step, one for each time it is active (a step started by its entities has one for each entity). It is active, snoozed or closed (done or dismissed). Snooze wins: a snoozed notification that is triggered again, or whose Schedule or Repeat comes round again, stays snoozed (its message and data are updated, its Expiration stays) and comes back when the snooze ends. *Run now* still shows it at once.
- **Dashboard notification:** a notification as the Dashboard channel shows it, in the Overview and in the dashboard cards. The push is not one.
- **Home mode:** the house's current situation (Home, Away, a night mode, ...), set in the settings. It decides which channels send.
- **Audience:** who gets the notification in each state: each person is *At home*, *Asleep* or *Not home*. The home mode and the audience both have to allow a channel: the home mode is checked first.
- **Channel:** a way a notification reaches people: the Dashboard, Push or a light, speaker or siren. A channel sends in the home modes ticked for it.
- **Show when / Hide while** (*Conditions*) and **Done when** (and **Dismiss when**) decide whether a notification is shown and when it closes.

## What you get

- **Overview:** the sidebar entry *Notification Center*. Every user can open it. See [The Overview](#the-overview).
- **Dashboard cards**, in the dashboard's card picker: *Notification Center* (`custom:notification-center`), every active notification, and *Notification* (`custom:notification-center-card`), one notification. The integration loads them on every dashboard, so you do not add a resource by hand. See [The Notification Center dashboard card](#the-notification-center-dashboard-card) and [The Notification dashboard card](#the-notification-dashboard-card).

- **A sensor per notification:** `sensor.nc_<name>`, for example `sensor.nc_dishwasher`. Its state is the most important state of its notifications: `active`, `hidden`, `snoozed`, `upcoming`, `done` (today), `idle` or `disabled`. The attributes tell the number of active notifications, the active step, the entities of a step started by its entities, the message, the snooze end, the last done time and `icon_color`: the colour of the state (active: the notification's colour, a system colour's name or `#rrggbb`; snoozed `orange`; done `green`; anything else `grey`), the same as the status chips of the Notifications list. Home Assistant itself does not colour a sensor's icon by an attribute; a card or a template can use it. The entity id stays when the notification is renamed.
- **`sensor.notification_center`:** the number of active notifications, with the current mode, the counts per category and the top notification as attributes.
- **`calendar.notification_center`:** a diagnostic entity, always off (so it stays out of the Activity log). The occurrences of the scheduled steps, as all-day events on the day they are due. The time of day (At) and the expiry only tell when the notification shows and goes away.
- **Actions:** `notification_center.trigger`, `done`, `clear`, `snooze` and `set_last_done`. They target the sensor of a notification and take the step number (`step`, default 1) and, for a step started by its entities, its `entity`:

  ```yaml
  action: notification_center.trigger
  target:
    entity_id: sensor.nc_doorbell
  data:
    message: "Someone is at the door"
    data:
      visitor: "{{ states('sensor.doorbell_last_person') }}"
  ```

- **Automation triggers and conditions:** *Notification state* (a notification or one of its steps became active, done, snoozed or dismissed; as a condition also "within the last …") and *Notification entities state* and *Notification entities numeric state* (an entity listed in a notification gets a state, or gets above or below a limit), in the automation editor.
- **Repairs and diagnostics:** problems such as a missing entity are listed in Settings → Repairs; diagnostics can be downloaded from the integration's menu, with people and push services redacted.

Open notifications, snoozes and last done times are kept in `.storage/notification_center.runtime`, so they survive a restart. Removing the integration also deletes its stored data.

## The Overview

The **Overview** shows the active notifications meant for you, with their buttons. Below them, under *Upcoming*, the scheduled steps due today and the snoozed notifications in one list, by time, in a neutral colour, with a line that tells when they come. Upcoming shows a notification when its Dashboard channel is on in at least one home mode and you are in its Audience in at least one state (the home mode and your person state now do not count). **Schedule** lists the scheduled steps due after today, by their next day, under *This week*, *This month*, *This year* and *Next year* (only the ones with something in them); **Done today** the notifications done today. A scheduled step is meant for its day; its time only says when it reaches you. So a step that is not due yet can be marked *Done* already: it shows in Done today like any done notification, a calendar step skips its next occurrence, and an "after last done" step counts from now. A notification hidden by its *Conditions* is not shown. Administrators find the settings behind the gear in the header (see [Settings](#settings)).

## Settings

The settings use Home Assistant's own layout and elements, with the tabs (with icons) in the header as on the Devices & services page. **Notifications** lists every notification with its category (and its number of steps), and a status chip: *Active*, *Upcoming* (due today), *Snoozed* or *Disabled*. Search and the *Category* filter chip narrow the list; drag a row by its handle to reorder (not while filtering). The row menu is the editor's menu (see [The notification editor](#the-notification-editor)), without *Edit in YAML*; *Run now* runs the first step there. **Categories** lists the categories in alphabetical order, with their number of notifications under the name; *Add category* and a row open the category editor (see [Categories](#categories)). **General** is laid out like Home Assistant's System settings, with a short line under each name: **Home modes** (see [Home modes](#home-modes)), **People** (see [People](#people)), **Light** (see [Light](#light)) and **Sound** (see [Sound](#sound)), then in a second block **Colors** (see [Colors](#colors); under it the number of custom colours, *1 custom*), **Snooze** (a dialog with *Default time*, the time a notification snoozed to another day comes back, 8:00 by default), **Push** (a dialog with *Open on tap*, see [Push](#push)) and **Import and export** (a dialog: *Export* downloads the YAML configuration, also in the Companion app, *Import* replaces it after downloading the current one), and the version. Under Home modes is their number (*5 modes*). The others open as a page of their own, with its header and what it does at the top.

### Categories

The category editor is a page: in the header *N notifications* (the Notifications list filtered to this category) and the ... menu, the same as a row's in the Categories list: *N notifications*, *Duplicate* (a copy named *… (copy)*, at the end of the list) and *Delete*. A category that still has notifications cannot be deleted; the dialog offers *View notifications*. The General category cannot be deleted. Under the header a preview of the notification.

- **Settings:** the name (required) and **Icon** on the first row; **Color**, **Highlight** and **Chime** on the second. *Color* is a system colour or a custom colour of the Colors page (the system colours first); each light shows it as its Colors tab sets it. *Highlight* is a dropdown: *Normal* (default), *Pulse*, *Glow* or *Alert*, the styles of a dashboard notification; an active notification shows it, and every highlight but Normal makes the lights pulse (*Notification Pulse*), or show their effect. *Chime* is what the speakers play; a category always has one (*Chime* by default); it shows only when there is a speaker. A new category starts with the General category's settings, audience and channels.
- **Interactions:** the category's Tap behavior, built-in buttons and its own custom buttons (*Add button*), with their label, icon, Snooze times and push setting, and the Tap behavior (see [Buttons](#buttons)), but no other action. New notifications of the category start with the category's buttons switched on or off as there. The General category has only Done switched on (*Mute*, the built-in button that stops the lights, speakers and sirens, starts off in every category).

- **Channels:** a table with a tick per home mode (Home first, then the Home modes list's order) and a pencil per channel. A channel sends in the ticked home modes; with no tick it is off, and a warning shows when no channel sends. The dialog has **Modes** and, under a line, **Settings**: *When* is Immediately or Delayed, counted from when the notification becomes active (for example the Dashboard at once, a light after 10 minutes, a push after an hour). On a phone each channel is a row with a summary (*Home, Away · Immediately*) that opens the dialog. The channels are the **Dashboard** (the Overview and the dashboard cards), **Push** (the phones of the people, see [Push](#push)), then every light, speaker and siren of the General settings, each with its entity's icon. A device channel's dialog has a play icon in its header, **Test**: it runs the device once with the settings shown, regardless of the mode and *When*. A speaker's Settings also have a row of *Repeat*, *Every* and *Times* under *When* (it wraps on a phone): *Repeat* is Once; Loop, again and again without a pause; or Recurring, every *Every* (1 hour by default). *Times* is how many times it plays in all; empty, it repeats until the notification is done or muted. Below come *Volume* (empty: the speaker's own), a *Play chime* switch (on by default; off, the speaker only reads the message) and a *Read the message* switch, which when on shows three ticks under *Read*: Name, Message (always) and Info. Push has *Priority* under *When* and two play icons (see [Push](#push)).
- **Audience:** every person of Home Assistant with three ticks: **At home** (at home and awake), **Asleep** (at home and asleep, see [People](#people)) and **Not home**. A person gets the category's notifications while in a ticked state; with nobody ticked nothing is sent (a warning says so). A person who is not listed (added later) gets what the listed people have in common.

A channel of an active notification sends when the current mode is ticked, its delay has passed and a person of the audience is in a ticked state (a channel for one person, such as the Dashboard, asks each person). When one of these becomes true later (the mode changes, the delay ends, someone comes home or wakes up), the channel sends then, while the notification is still active. *Run now* and the trigger action follow the same rules. The diagnostic sensor `sensor.nc_channel_dashboard` counts the notifications the Dashboard shows; `upcoming` counts the active notifications it holds back (they show under *Upcoming*), and the same notifications by what they wait for: `upcoming_waiting_for_<mode>_mode` for each mode (a notification ticked in two modes counts in both), `upcoming_waiting_for_delay` and `upcoming_waiting_for_audience`. `off` counts the notifications with no mode ticked, which never show. `sensor.notification_center` counts every active notification. Each light, speaker and siren has a diagnostic sensor too, `sensor.nc_channel_<light|speaker|siren>_<object id of its entity>`, with the same attributes and `muted`.

A notification uses its category's buttons live: in its Interactions they are in their own blocks, with amber icons. A label set in the category always applies (a notification can change it in YAML only); the icon and the Snooze times apply unless the notification sets its own. *Show button in the push notification* is a dropdown in the notification: empty follows the category, a choice overrides it, and X clears the override. A category's custom button cannot be deleted in a notification, only switched off; deleting it in the category turns it into an own custom button of every notification that used it. The action of every button is set in the notification. Moving a notification to another category does the same with the old category's custom buttons.

### Home modes

A home mode tells which channels deliver a notification (the Channels table of the categories). Only one home mode is active at a time: the first in the list whose condition is true. Its condition is an entity state or a template (a `toggle` condition in YAML still works). **Home** without a condition is always true: it is shown on top but checked last, so it applies when no other home mode does. Home with a condition is a normal row that can be dragged like the others. When no home mode is active, the page says *No active home mode* and only the channels ticked in at least one home mode send. The active home mode has an *Active* chip. (In YAML and in the code they are still `modes`.)

*Add home mode* has two steps: the home mode is saved first with the same channels as Home, then the next dialog lists the channels to switch on for it in every category (it starts with Home's and cannot be skipped). The dialog of a home mode has its name, its icon and its condition, also for Home.

### Light

The lights of the Light channel: lights and switches (a lamp on a plug). *Add light* is a button like Home Assistant's *Add target*, which opens an entity picker: the light is added at once with the default settings, then asks which home modes it sends in, the same in every category (each category can change it later). A row shows *Brightness 70% · Dim: 30% · Highlight: Notification Pulse*; its pencil opens the light's dialog; its entity cannot be changed (delete it and add another). The dialog's fields follow what the light can do:

- **Settings:** *Brightness* (70% by default), *Color temperature* for a white-only light (empty: its own), *Highlight effect* (*Notification Pulse*: a second at the brightness and a second at half of it; a switch turns on and off or an effect of the light when it has effects), and **Dim when dark**: an illuminance sensor (empty: no dimming) with *Dim below* (30 lx) beside it, *Dim brightness* (30%), and *Measure illuminance continuously* (on by default: follow the sensor while the light is on; off, it is read when the light turns on, for a sensor the light shines on).
- **Colors** (colour lights): each system and custom colour as this light shows it, in a *System colors* and a *Custom colors* list, with a picker, a reset for a changed one and a Test per row. A lamp has no grey, so Light grey, Grey and Dark grey are white by default. Tests one after the other bring the light back to how it was before the first.

A light shows the colour of the first notification it sends, in the order of the Notifications list, and goes back to how it was (also after several colours) when no notification sends any more. If you change the light meanwhile, your change stays. A switch turns on, or pulses (on and off) for a highlighted notification. The play icon in the header tests the light with the settings shown.

### Sound

The speakers and the sirens are two lists, *Speakers* and *Sirens*, with a line between the rows. *Add speaker* and *Add siren* below them are buttons like Home Assistant's *Add target*, which open an entity picker: the device is added at once with its defaults (a select first asks which option sounds), then asks which home modes it sends in. A row's pencil opens the device's dialog; its entity cannot be changed.

- **Speakers:** a media player with an optional *Volume* (empty: its volume stays; X clears it). A speaker that can announce plays the chime over what it plays; another one stops, plays the chime and gets its volume back.
- **Sirens:** a siren (with tone, volume and duration when it has them), a switch, or a select with a *Sound option* and a *Stop option* (such as a smoke alarm's siren select).

Below them, two rows:

- **Chimes** opens its own page: the built-in sounds (Chime, Attention, Doorbell, Alarm, Indoor alarm) and your own, any media of Home Assistant's media browser. Drag the rows to set their order in the chime lists (alphabetical by default). Each row has a play button that plays the sound on this device (again stops it), and an own chime a pencil that opens its dialog.
- **Read the message** opens a dialog: the text-to-speech service that reads the message aloud, and its language (empty: the service's own; X clears it).

A speaker plays the chime once when a notification starts to send there, then reads the message if asked, and repeats if set. A siren sounds while a notification sends. A button's **Mute** action stops the lights, speakers and sirens of the notification; the notification stays.

### Colors

The colours of the categories and notifications. *System colors* shows Home Assistant's system colours as a palette (the name shows on hover); they cannot be changed. *Custom colors* lists your own colours below it. *Add color* and the pencil of a custom colour open its dialog: *Name* and the colour. A custom colour shows in every Color field, after the system colours, and on each light's Colors tab, where the light can show it with its own RGB. Deleting a custom colour gives its categories the default colour and its notifications their category's.

### People

Every person of Home Assistant is listed, with their state now as a chip (At home green, Asleep deep purple, Not home grey) and *Sleep when …* under the name, followed by the person's phone (*· Dora iPhone*). The pencil opens the person's dialog:

- **Sleep:** when the person is asleep, like a home mode's condition: None, an entity's state or a template (a `sleep_entity` or `toggle` from older YAML still works, as State *on*). Asleep counts only at home: a person not at home is Not home.
- **Push:** *Device*, the notify action the person's pushes go to (the phones of the Companion app first, then the other notify actions), and its *Type*: iOS, Android or Other (title and message only). A Companion app phone sets the type by itself; it can be changed. The play icon right of the title sends a test push to this device. One device per person.

### Push

The Push channel sends a notification to the phones of the people (set on the People page). It is a row of the Channels table after the Dashboard, switched off (no mode ticked) in the existing and in new categories until you tick it. Like the other channels it sends in the ticked home modes, after its delay, to each person of the audience who is in a ticked state and has a phone. Someone who arrives home or wakes up later gets it then; a push already sent stays when the person leaves.

- **Content:** the notification's name as the title, the message, and the Info line on its own line. On iOS the notification's icon in white on its colour, as a round picture; on Android the icon in the status bar and the colour. Pushes of a category are grouped together.
- **Priority** (in the channel's dialog): *Silent* (no sound, it waits in the list), *Normal*, *Time-sensitive* (through Focus and Do Not Disturb) or *Critical* (sounds even when the phone is muted). On iOS this is the interruption level. On Android *Normal* goes to a notification channel named after the category; *Silent*, *Time-sensitive* and *Critical* go to the shared channels *Silent*, *Time-sensitive* and the alarm stream. Time-sensitive and Critical arrive at once; a Critical push cannot be swiped away until the notification ends. An Android channel keeps its sound and importance from when it was first created (change them in the phone's settings); renaming a category removes its old channel.
- **Buttons:** the switched-on buttons with *Show button in the push notification*, in the order of the editor (iOS shows them all, Android the first 3). Snooze snoozes for its first time. Pressing a button on the phone works as on the notification, as the person who pressed it (*Done by …*). A button with a Navigation action (More info or Navigate) opens the Overview, which does the rest.
- **Tap:** a tap opens the page set in *Open on tap*: the notification's Tap behavior, else its category's, else General › Push (the Overview by default). The Tap behavior's action runs too (a Navigate action opens its own page).
- **One push per notification and phone:** a later step replaces the earlier one (a Critical push on iOS is removed first, since iOS cannot replace it). The text of a sent push does not change. The push goes away when the notification is done, dismissed, snoozed or hidden by its conditions, and comes back when the notification does. It stays on a mode or presence change and on Mute.
- **Test:** the channel's dialog has two play icons: one sends a test to your own phone (your user's person), the other to every phone the notification can reach (the people of its audience with a phone). The People dialog tests one device.

The diagnostic sensor `sensor.nc_channel_push` counts the notifications on the phones, with `last_sent_<person>` and the Dashboard sensor's counts. A person whose notify action is missing shows up in Repairs. The Companion app allows about 500 pushes a day per phone (critical pushes do not count). On iOS a removed push may stay if the app was not used for a while.

### The notification editor

Laid out like the automation editor: the name and status in the header, Undo and Redo (Ctrl+Z, Ctrl+Y), the Enabled switch (saved at once) and the menu, the same as the row menu of the Notifications list: *More info* (the sensor's dialog, where its entity id can be changed), *Status* (the Status dialog), *Run now for me* (the selected step, like the Trigger action with *Only me*: only your own person gets it, on the Dashboard and on the phone, the lights, speakers and sirens stay quiet) and *Run now for everyone*, *Dismiss notifications* (dismisses the open notifications of every step), *Duplicate* (a disabled copy), *Edit in YAML* (the whole notification in Home Assistant's YAML editor, as it is saved; *Edit in visual editor* goes back, and Undo and Redo work in both), *Disable* and *Delete*. Under the header a preview of the selected step's notification, with the templates rendered for the first listed entity. Save appears when something changed; leaving asks first.

- **Settings:** name, category and icon on the first row; **Color**, **Highlight** (*Normal*, *Pulse*, *Glow* or *Alert*) and **Chime** (when there is a speaker; *None* plays nothing) on the second. Left empty, they come from the category (shown in the fields, marked *(default)* in the lists); choosing the category's value, or X on an own one, goes back to the category's.
- **Entities:** single entities and entity groups (a domain with an optional device class, floors, areas and labels). Entities are named as in Home Assistant's pickers, with their area and device; the pencil edits or deletes. Each group is its own list, always open, and each of its entities can be switched off on its own, and opens its dialog where each entity action shows the group's until it is changed for that entity (`member_actions`, it replaces the group's; *Reset* beside the button brings the group's back); *Add new matching entities* off keeps the entities that matched when it was saved. A group that matches nothing yet is fine.
Back (the browser's or the phone's) closes an open dialog first.

- **Steps**, as tabs, with Add step and a menu (Run this step for me or for everyone, Step status, Duplicate, Move left or right, Disable, Delete). Each step has (in this order: Message and Interactions, then Activation, Conditions and Done when, then Channels and Audience; each block starts with a line on what it is about, such as *How the notification is delivered in each home mode*):
  - **Message:** the message, the Info line, the entity parameters `{Floor}`, `{Area}`, `{Device}`, `{Device class}` (by its Home Assistant name, such as Moisture), `{Entity}`, `{State}`, and the *Data* after the label: empty for nothing, *Notification* (active since, last done), *Entity state* (the active entity unless another is chosen; the state (default), an attribute, last changed or last updated) or *Custom* (a text, templates work). `{Floor}` shows only when there are floors.
  - **Activation** (`activation` in YAML; its title shows the number of triggers, or *Schedule* or *Repeat*): *Triggers*: at the top *Notification entities*, shown when the notification lists entities: *State* (is or is not some states) or *Numeric state* (above or below a number or an entity's value, or a template), of the state or an attribute, with For. Every entity gets its own notification when it starts to match. Left empty it is not used; a new notification whose entities are all on or off starts with *Is on*. It is the first trigger in YAML. From step 2, *Notification state* comes next: *Step* (the previous one at first), *State* (Active, Done, Dismissed, Snoozed) and *For*; it is a Notification state trigger on this notification, stored after Notification entities, and left without a state it is not used. Below it Home Assistant's trigger editor (none means only the Trigger action activates it); the Notification entities triggers and conditions there take any notification and show the same compact form. *Schedule* (the calendar) or *Repeat* (after last done). Both show when they come next; Repeat's next time can be set with the pencil (it is stored as the last done time). To close a notification nobody did, use *Expiration* in Dismiss when.
  - **Conditions** (`conditions` in YAML): one set of conditions (Home Assistant's condition editor; from step 2 with *Notification state* at the top, as in Activation, stored as the first condition) with two switches: *Activate only while conditions are met* (`activate_only_while_met`: the step is activated only when they are true; a scheduled notification waits for them, hidden, until Expiration closes it) and *Hide while conditions are not met* (`hide_while_not_met`: an active notification shows only while they are true).
  - **Done when:** at the top *Expiration* (`done_when: {expires: ...}`, default *Not in use*): *After* a duration from when the notification became active, or *On day* (the same day or some days later) at a time; it closes the notification as done, whatever activated it. Below it Home Assistant's trigger editor, and above that, when Notification entities is set at the top of Activation or the Conditions are used at the activation, *When the activation is no longer true* (`activation_conditions_no_longer_true`: an entity's notification closes when that entity stops matching; a notification closes when the Conditions are no longer met).
  - **Dismiss when:** *Expiration* at the top, as in Done when, dismisses the notification instead (`dismiss_when: {expires: ...}`; when both have one, the earlier one counts). Below it Home Assistant's trigger editor; one of its triggers closes the notification as dismissed (not done, so the last done time stays).
  - **Interactions:** *Tap behavior* on its own (a tap on the push always opens the app and runs it too), then *Buttons*: the built-in buttons (*Done*, *Dismiss*, *Snooze*, *Mute*), the category's custom buttons and the notification's own custom buttons (*Add button*). A row opens the button's dialog; its switch turns it on or off. See [Buttons](#buttons) and [Categories](#categories).
  - **Channels** and **Audience:** the category's tables, as the step changes them. A step stores only what differs: a changed person row or channel row has a reset icon. A channel row's icon resets its mode ticks (after a confirmation); in the channel's dialog *Reset* resets Modes or Settings on their own. The Audience title shows how many people get the step (2/3).

Inside a notification, the Notification state trigger with no notification means this one, and its step is given by number; they are stored by id, so they keep pointing to the same step.

## Buttons

A notification's buttons work the same in the Overview and on both dashboard cards. Each button has a list of **Actions**, shown in this fixed order (it cannot be changed):

1. **Entity action** (a switch, always there): the listed entity's own action for that button, set in the entity's (or entity group's) dialog under *Entity actions*, which lists the switched-on buttons that use it.
2. **Mute** (added, and deleted with the icon at the end of its row; the built-in *Mute* button has it as its own row with a switch that is always on): stops the notification lights, speakers and sirens; the notification stays.
3. **Notification state**: *Done* closes the notification, *Dismiss* dismisses it, *Snooze* snoozes it for the chosen time. The built-in buttons have their own, a row titled by its type (*Done*: closes the notification as done; *Dismiss*: closes it without marking it done; *Snooze*: its times under the title) with a switch that is always on, like the Entity action row, and cannot be removed; the Tap and own buttons can add one (at most one). Without one, the notification stays as it is (to close it when something happens, use Done when).
4. **Home Assistant actions** (any number, each its own row of Home Assistant's action editor, in their own order).
5. **Navigation** (at most one, always last): *Navigate* opens a page, *More info* opens the entity's dialog (the chosen entity, else the notification's entity, else the notification's sensor).

They run one after the other, in the order of the list: the entity action, Mute, the notification state and the Home Assistant actions. The entity action and the Home Assistant actions run in Home Assistant, as the user who pressed the button; the navigation happens where it was pressed. An action that cannot run is skipped, and the others still run. Under the list, *Add notification state*, *Add mute*, *Add action* and *Add navigation* add them (each is hidden once the button has one, except *Add action*). In a notification, *Reset* beside Actions brings back the default of a category's button (the others do only what they are).

**Tap behavior:** one block, set in the category and followed by its notifications. *Action* runs the Tap's own Actions, edited as a button's, with the Navigation always in the list (*More info* by default); *Button action* runs another switched-on button's actions instead (for example Done), and only that button is chosen. A notification can change the whole block (its *Type* then no longer says *category*); *Reset* beside Tap behavior follows the category again. *Button action* is offered only when a button is switched on; when the button it runs is switched off later, a warning says so (it then falls back to the Tap's actions). The push part comes last in the dialog: a tap on the push opens the app and does the same. When the Tap's actions (or the button it runs) have a Navigate, the push opens that page (*The push opens /lovelace/kitchen (Navigate of Done)*) and *Open on tap* is hidden; with More info the push opens the *Open on tap* page with More info on top.

**Snooze times:** the Snooze button's dialog lists 15 and 30 minutes, 1, 2, 3, 6 and 12 hours, Tomorrow, 2 and 3 days, 1 and 2 weeks and 1 month; at least one is chosen (by default 1 h, 3 h and Tomorrow). With one, the button snoozes at once; with more, the notification offers them (15 min, 1 h, Tomorrow, 2 d, 1 w, 1 mo). Minutes and hours count from the press; days come back on that day at the step's time (a scheduled step) or at 8:00 (*Snooze* in General, `snooze_tomorrow_at`).

**Show button in the push notification:** whether the button is on the push notification (on by default for every button; Android shows at most 3; with more Snooze times the push uses the first). A built-in button's label is set in the category's dialog (X goes back to the default); a notification changes it in YAML only. A tap on the push itself always opens the app and runs the Tap behavior's action; its *Open on tap* (`open_on_tap`) sets the page the push opens (empty: the category's, then General's). See [Push](#push).

A tap on a dashboard notification runs its Tap behavior while the Tap is switched on; a tap on the push always runs it. The buttons are always in the order: Snooze, own buttons, Done, Dismiss. A step's Audience and the Dashboard channel decide who sees the notification: each user sees the notifications meant for their person in their current state; a user without a person sees what at least one person of the audience gets. Held back notifications show under *Upcoming* on the Overview, with what they wait for: *Shows 7:41* (the delay), *Shows in Home or Away home mode*, *Shows when you arrive home, wake up or leave home*; a user without a person sees the names (*Shows when Anna or Béla arrives home*), or *someone* with more than three people. The Activity log names the user who changed a notification's state.

## The Notification Center dashboard card

The dashboard card that shows every active notification of the Notification Center on a dashboard, in list order, with working buttons. It hides itself while it has nothing to show and leaves no gap (unless `show` has `empty`); in the dashboard editor it shows a *Notification Center* placeholder instead.

| Option | Description |
| --- | --- |
| `categories` | Only these categories (their ids). Default: all. |
| `max_cards` | At most this many notifications; an "N more" row opens the Notification Center. Default: all. |
| `ignore_audience` | Also show the notifications meant for other people (what the Dashboard shows anyone now). Default: `false`, only the notifications the Dashboard shows the logged in user's person now. |
| `show` | What the card shows (the editor's *Show*): `active` (the active notifications), `upcoming` (Upcoming under them, as on the Overview: what shows later today and the snoozed notifications) and `empty` (*All done* instead of hiding the card). Default: `[active]`. The older `show_empty: true` reads as `[active, empty]`. |

```yaml
type: custom:notification-center
categories: [emergency, chores]
max_cards: 3
```

## The Notification dashboard card

The dashboard card that shows one notification on a dashboard, in the look of the tile and alert cards: an icon, a label with a short data after it, the message, an optional second line (Info), and buttons on the right. The card colour is used for the border, the icon, the label and the buttons; the background is the normal card background.

**With a Notification Center notification:** choose its sensor (`sensor.nc_<name>`) as the entity, and everything comes from the Notification Center: name, icon, colour, message and Info. Every active notification of the notification shows (a notification started by its entities can have several), with all its buttons and its tap (see [Buttons](#buttons)). A Snooze with more than one time offers them on the notification. The Channels do not count: the card was placed for this notification. Snoozed, it shows greyed with *Snoozed until …*; upcoming (due later today) as in Upcoming, with its *Done* button; done today without buttons; idle greyed, with *No active notification* and when it was last done. Two options, in the dashboard card editor:

| Option | Description |
| --- | --- |
| `show_when` | *Show when the notification is*: `active`, `snoozed`, `upcoming`, `done` (*Done today*), `idle`. Left out: always shown. In the dashboard editor a card hidden now shows faded, with a line that says so. |
| `ignore_audience` | *Ignore audience* (default `true`): everyone sees it. `false`: only the notification's Audience, in their person state now. |

```yaml
type: custom:notification-center-card
entity: sensor.nc_washing_machine
show_when: [active, snoozed]
```

**On its own:** with any other entity (or none), the dashboard card shows what its options say; when it shows is up to its Visibility tab. All options are in the dashboard card editor:

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

## The Notification badge

The small twin of the Notification dashboard card, for one entity, at the top of a sections view (*Add badge*, then *Notification*). Its options are those of Home Assistant's entity badge, with its own elements: **Entity**; under *Content* **Name**, **Color**, **Icon**, *Displayed elements* (name, state, icon) and **State content**; under *Interactions* the tap, hold and double tap actions.

**With a Notification Center notification:** everything comes from the notification: its icon, its colour by status (active the notification's colour, snoozed orange, done green, the rest grey, as the sensor's `icon_color`), its message and its highlight (the icon pulses and the border takes the colour while it is active). *State content* picks one or more of *Message* (default), *Info line*, *Status* (*Active*, *Snoozed until 18:00*, *Shows today at 19:00*, *Done today*, *Idle*) and *Name*; with several open notifications (Notification entities) the first one's message shows, with *+N*. *Name*, *Icon* and *Color* change the notification's (the colour only while active). A tap runs the notification's Tap behavior, unless the badge sets its own tap action; hold and double tap work as on Home Assistant's badges. The Channels do not count. Under *Notification*: `show_when` and `ignore_audience`, as on the dashboard card (default: always shown, everyone sees it).

```yaml
type: custom:notification-center-badge
entity: sensor.nc_cat_at_home
state_content: [message, status]
show_when: [active, snoozed]
```

**With another entity:** it is Home Assistant's entity badge, with the same options; when it shows is up to its Visibility tab.

After an update the card follows the new version once Home Assistant is restarted and the browser page is reloaded.

## Development

The integration is in `custom_components/notification_center`. The Overview and the dashboard cards are TypeScript and Lit, in `frontend/`.

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
