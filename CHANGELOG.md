# Changelog

## Unreleased

### Changed

- **Upcoming and Schedule leave out a scheduled step whose *Conditions* are not met now** (when it would be held back when due), for example *Bring back the bin* until *Put out the bin* is done. Notification state, Notification entities and entity conditions count; conditions that change with time (time, sun, template) are checked when the step is due. The notification's `next_due` and its *upcoming* state follow the same rule.

## 0.7.8

### Changed

- **Schedule** on the Overview has *Next week* and *Next month* sections (beside This week, This month, This year and Next year; an empty one does not show), and a step due tomorrow reads *Tomorrow* with its time.
- The *Active* status chip in the Notifications list and the notification editor is green; the notification's own colour stays for the sensor's `icon_color`, the badge and the cards.
- **Inheritance looks the same everywhere.** Every choice that inherits (Color, Highlight, Chime, Show in push, When, Repeat, Priority) starts with *Default (value)*, the category's in a notification and the built-in one in a category (Color with its swatch), and an own value has Home Assistant's X. Text and number fields show the inherited value as their placeholder (a button's label, Volume, Color temperature). The helper texts about the category, *(category)* and *(default)* are gone.
- **Restore icon** instead of the *Reset* buttons: in the header of a button's and a channel's dialog (the whole button or channel, with its switch), beside a button's Actions and Snooze *Times*, a channel's *Home modes* and an entity's action in a group; and on the rows of a step's Interactions, Channels and Audience with own settings, beside the pencil. None asks for a confirmation; the channel's Settings block has no reset of its own any more (each setting has its Default).
- **Buttons' Actions are set in the category too** (they were only the Tap's): every button of a category has an Actions list, which its notifications follow until they set their own (the restore icon beside Actions brings the category's back). An *Entity action* there means each notification's own entities.
- A notification can change the **label** of its category's buttons (the placeholder shows the category's). The button dialog has an *Enabled* switch at the top.
- The **default colour** of a category is **Amber** (was the primary colour): categories and notifications without a colour of their own, their lights and pushes turn amber.
- A **new notification follows its category's button switches** instead of copying them, and a switch, home mode tick or Audience row set back to the category's value is no longer stored: it follows the category again. Saved notifications are tidied the same way when loaded: a button's switch, push setting, Snooze times or empty actions stored equal to the category's are left out, so they follow later changes of the category (what they do now stays the same).
- *Open on tap* names the page it follows under the field (*Default: Overview ▸ Home*): a dashboard view by its title, not its path; the General list's Push line does the same.
- On a phone, each row of the Channels list has a pencil (was an arrow) and, when changed, the restore icon.

### Fixed

- While Home Assistant restarts, the dashboard cards, badges and the Overview no longer show *Unknown command*: they wait until Notification Center is loaded again and then follow it without a reload. A card or badge shows nothing while it loads (the Notification Center card shows its empty state if it is turned on).
- A push sent with *Test* in a step's Channels showed its placeholders (`{Device}`, ...) and templates as written: it now reads them as the preview does, from the notification's first entity.
- The channel dialog's *When* and the delay beside it looked like one field on a wide screen: the delay is labelled *Delay*.
- The Volume of a step's speaker channel said that empty is the speaker's own volume; it is the category's (now shown as the placeholder).
- Placeholders of a notification started by a trigger (not by Notification entities) read the entity that triggered it, on the dashboard and in the push (they were empty).

## 0.7.7

### Fixed

- *Add notification* (and every new button) showed an empty page when Home Assistant was opened over plain HTTP (not HTTPS or localhost): the browser offers its random id helper only on secure pages.

## 0.7.6

### Added

- **Notification info** in a button's Navigation (beside Navigate and More info): opens the notification's Status dialog on the Overview, from the dashboard and from a push. The address is `/notification-center?info=<notification id>` (a notification's sensor works too), so a link can open it as well.
- Back of the browser, the app's back gesture and a mouse's back button ask *Leave without saving?* in the notification and category editors while there are unsaved changes, as the editor's own back button does; reloading or closing the page asks the browser's question.

### Changed

- **Notification state** has one compact form, in the built-in row of Activation and Conditions and in Home Assistant's trigger and condition rows (with a *Notification* field there, this notification at first): *Step* by name (*Any step*, or the previous one at first in the built-in row) and *State*. A trigger has *For*; a condition chooses **Now, for at least** (in the state now) or **Within the last** (reached the state within that time, even if it has left it since: for a step done yesterday evening, as Done and Dismissed with Now count only today's notifications).
- **Upcoming** is purple: the status chip in the Notifications list and the editor's header, the Notification badge and card, and the sensor's `icon_color` (`purple`).

- The built-in rows of a step (Notification entities, Notification state, Expiration) have plain titles, as the other built-in rows. *Expires* is called **Expiration** (stored as `expires`, as before); on a phone its dropdown takes the whole width.
- A Notification state or Notification entities trigger or condition added in the notification editor starts with this notification (once it is saved).

### Fixed

- *Schedule* and *Repeat* in Activation could not be chosen (the step stayed on Triggers).
- *Reset* in a notification's Snooze dialog did not bring back the category's snooze times, and did not show when only the times were changed.
- A Notification state condition on Done (or Dismissed) is checked again at midnight, so *Hide while conditions are not met* follows it on the new day.

## 0.7.5

### Added

- **Notification badge** (`custom:notification-center-badge`), the small twin of the Notification card for one entity, at the top of a sections view. Its options are Home Assistant's entity badge's (Entity; Content: Name, Color, Icon, Displayed elements, State content; Interactions: tap, hold, double tap). With a notification's sensor everything comes from the notification: icon, colour by status (as `icon_color`), message (the first one's with *+N* when more are open) and highlight; *State content* offers Message, Info line, Status and Name. A tap runs the notification's Tap behavior unless the badge sets a tap action. The channels do not count. With another entity it is Home Assistant's entity badge.
- *Show when the notification is* (`show_when`: Active, Snoozed, Upcoming, Done today, Idle; default all) and *Ignore audience* (`ignore_audience`, default on) on the Notification badge and on the Notification card with a notification's sensor. Off, only the notification's Audience sees it, in their person state now.
- The ... menu of a category, in the Categories list and the category editor's header: *N notifications* (the Notifications list filtered to the category), *Duplicate* and *Delete*. The header's *Notifications* button shows the number too.

### Changed

- **Snooze wins:** a snoozed notification that is triggered again, or whose Schedule or Repeat comes round again, stays snoozed; only its message and data are updated and its Expires stays. It comes back when the snooze ends. The trigger action (*Run now*) still wakes it.
- The Notification card with a notification's sensor no longer counts the channels, and by default shows in every status: snoozed greyed with *Snoozed until …*, upcoming with its *Done* button, done today without buttons, idle greyed with when it was last done. Before, it hid itself while nothing was active: set *Show when the notification is* to *Active* for that.
- A button's Actions list starts with *Entity action*, then *Mute*, the notification state, the Home Assistant actions and the navigation, and they run in that order (Mute used to run first).
- Tap behavior dialog: *Button action* is offered only when a button is switched on, with a warning when the button it runs was switched off later. The push part (its line and *Open on tap*) is at the bottom. When the Tap's actions or the button it runs have a Navigate, the dialog says which page the push opens (*The push opens /lovelace/kitchen (Navigate of Done)*) instead of *Open on tap*.
- The categories are in the same alphabetical order everywhere: the Category pickers, the Notifications list filter, the Notification Center card's editor and the summary sensor's `categories` attribute.
- The editor's Channels list says *All home modes* when every home mode is ticked.
- Upcoming (the Overview and the Notification Center card) shows a scheduled or snoozed notification only when its Dashboard channel is on in at least one home mode, besides the viewer being in its Audience in at least one state.

### Fixed

- Every page header title (the notification and category editors, the General subpages) stays on one line, cut with an ellipsis.
- The Mute button had no title in the Entity actions of an entity or entity group.

## 0.7.4

### Added

- A speaker's *Repeat* has a *Times* field for Loop and Recurring: how many times it plays in all; empty, it repeats until the notification is done or muted. *Repeat*, *Every* and *Times* share one row (it wraps on a phone), with *Until done or muted.* under it.
- The Notification Center card has a *Show* option (`show`) with *Active*, *Upcoming* and *Empty state* (default: Active). *Upcoming* lists what shows later today and the snoozed notifications under the active ones, as on the Overview, each with its *Shows …* line. It replaces `show_empty`; `show_empty: true` still works and reads as Active and Empty state.
- *More info* in the ... menu of a notification (the Notifications list and the editor's header) opens the sensor's dialog.
- A built-in **Mute** button beside Done, Dismiss and Snooze (off by default in every category): it keeps the notification and stops its lights, speakers and sirens. In its dialog Mute is its own row with a switch that is always on. On a dashboard notification it comes after Snooze.
- **Dismiss when**: a step block right after Done when, with Home Assistant's trigger editor. One of its triggers closes the notification as dismissed (not done, so the last done time stays); the event's source is `dismiss_when`. Stored as the step's `dismiss_when: {triggers: [...]}`.
- The notification sensor has an `icon_color` attribute: active, the notification's colour (a system colour's name or `#rrggbb`); snoozed `orange`; done `green`; upcoming, dismissed, idle and disabled `grey`. Home Assistant does not colour the icon by it, but cards and templates can use it. The status chips use the same colours: *Active* in the notification's colour, *Snoozed* orange, *Upcoming* and *Disabled* grey.

- **Expires** at the top of Done when and of Dismiss when (default *Not in use*): *After* a duration from when the notification became active, or *On day* (the same day or up to 7 days later) at a time. It works whatever activated the notification (triggers, Schedule, Repeat, Run now). Done when's closes it as done (source `expires`, the last done time changes), Dismiss when's as dismissed; when both are set, the earlier one counts. Stored as `done_when: {expires: ...}` and `dismiss_when: {expires: ...}`.
- **Notification state** at the top of Activation and of Conditions from step 2, like Notification entities (*Not in use* or *Set*): *Step* (the previous one at first, any other step can be picked), *State* (Active, Done, Dismissed, Snoozed) and *For*. It is an ordinary Notification state trigger (or condition) on this notification, stored as the first one (after Notification entities).

### Changed

- A Repairs issue is no longer fixable (Home Assistant's *Submit* button did not work here). Its description ends with the link to the notification's editor (or the settings page of the light, speaker or siren) on a line of its own.
- **Silence is now Mute** everywhere: the button action, its *Add mute* button, the Status dialog (*Muted*), the help texts and the README. The stored keys change too (a button's `silence` action is `mute`, an open notification's `silenced` is `muted`, the device sensors' `silenced` attribute is `muted`, the `card/action` websocket command takes `mute`); saved settings, open notifications and older YAML exports are upgraded when loaded (export version 5).
- The ... menu is the same in the Notifications list and the editor's header: *More info*, *Status*, *Run now for me*, *Run now for everyone*, *Dismiss notifications* (was *Clear notifications*), *Duplicate*, (the editor's *Edit in YAML*), then *Disable* and *Delete*. The list gains *Status*, *Run now for me* and *Dismiss notifications*. In the step menu *Run this step for me* comes before *Run this step for everyone*.
- The lights' own highlight effect is called **Notification Pulse** (stored as `notification_pulse`, upgraded from `blink`), so a light's own effect named *blink* (Hue) can be chosen. A dimmable light (RGB too) now pulses between its brightness and half of it instead of turning off; a switch still turns on and off.
- In the button dialog the built-in Done, Dismiss and Snooze state rows are titled by their type with their own icon and a switch that is always on, like the Entity action row: *Closes the notification as done.*, *Closes the notification without marking it done.*, and Snooze with its times under the title. The Mute row is laid out like the Entity action row, with its delete button at the end.

- The Schedule's and Repeat's own *Expires* is gone, and with it the **expired** status: a schedule's Expires is upgraded into the Expires row of Dismiss when (saved settings, open notifications and older YAML exports; export version 6). An expiring notification now closes as dismissed (or as done, from Done when) with source `expires`, and fires the dismissed (or done) event instead of `expired`.

### Fixed

- The Activity log's detail dialog showed nothing under *What happened* for the notification sensors. The sensors are now written in the context of what caused the change (the entity's state change, the action and its user), so the log finds the cause.
- Dragging a row by its handle in the Notifications list sometimes did not start on a desktop, because the browser started dragging the row's link instead.

## 0.7.3

### Added

- *Status* in the notification editor's menu (and a click on its status chip) opens a dialog of the notification's status: active since, snoozed until, hidden, last active, last done, next due. For each active step it lists every channel and what it does now: *Sends to Anna and Béla*, *Waiting for home mode: Night (now Away)*, *Delay until 18:40*, *Nobody in the audience: Anna is not home*, *Off*, *Muted*, and for Push the people with no phone set. Under Dashboard and Push (then only headings) one row per person says whether they get it and why not (*Not home · Not in the audience while not home*, *No phone set*). *Step status* in the step menu shows the same for one step. The entity's more-info is a button in the dialog's header.
- A single-step notification shows a green dot on its step tab while it is active, as a numbered step shows a green number.
- Live marks in the editor's Channels and Audience tables: a green dot at the home mode now; in the column of the home mode now (and at each person's state now) a ticked box is green; each person's state now under their name; a badge on each channel icon and person avatar, as on a tile card: a green check when it sends or gets the notification now, an orange timer while a delay applies, an orange pause when the home mode or person state holds it back, a grey cross when no home mode or state is ticked at all. The Status dialog uses the same marks. The channel dialog marks the home mode now with an *Active* tag, and names a light, speaker or siren as the Entities dialogs do (name, then area ▸ device).
- A person with no sleep condition has a disabled *Asleep* box in the Audience table instead of none.
- The *Test* item of a condition row works for Notification state and Notification entities conditions without a notification set: they test this (saved) notification.
- The Notifications list and the Overview show an empty state (*No notifications yet*) while there are no notifications, with an *Add notification* button on its own row (on the Overview only for an administrator).
- Repairs issues are fixable: the fix flow shows a link to the editor of the notification (or the settings page). A light, speaker or siren whose entity is missing has its own Repairs issue.
- A failed save also shows Home Assistant's own toast.

### Fixed

- The Overview says *No active notifications* above Upcoming (*All done* only when nothing is upcoming either).
- A long step name in the editor tabs is cut at its end, so the start always shows on a phone.
- The Settings pages no longer render Home Assistant's elements before `hass` is set (console errors *Cannot read properties of undefined (reading 'localize')*).
- An unknown General page (for example `/settings/general/push`) goes to General.

### Changed

- A step's *Done* block is called *Done when* in the editor, its help and the README.
- A failed save names the step and the block of the error (*Step 2, Activation: …*), opens that block and scrolls to the message.
- A Repairs issue's *Learn more* link opens the editor of its notification (the People page for a missing push device).
- *Run now* in the editor and the step menu has *only me* and *everyone*. *Only me* is also the new `only_me` option of the Trigger action: only the person of the calling user gets the notification, on the Dashboard and the phone; lights, speakers and sirens stay quiet.
- The README has a *Concepts* section. Its note on the home mode icon is corrected: it is edited in the home mode's dialog.
- One word for what is shown: *notification* when it is true for the push and the dashboard alike, *dashboard notification* when it is true only on the Dashboard (the Overview and the dashboard cards), and *Overview* instead of *panel*. The two dashboard card types keep *card*, as Home Assistant calls them. This replaces the *dashboard card* wording of the previous entry across the editor, its help texts, the card editor, the sensor attribute *Active notifications*, the error messages and the README.
- The Interactions help of a step describes the order of a button's Actions and the Tap behavior (*Action*, *Button action*). The *entity* field of the Trigger, Done, Clear and Snooze actions says it is the entity of a notification started by *Notification entities*. The README status line is current, and its Buttons part says what a tap on a dashboard notification and on the push does.
- A person's states read *At home*, *Asleep* and *Not home* (not *Home*, *Sleep* and *Away*), so they do not clash with the home modes; the stored keys stay `home`, `sleep` and `away`.
- Channels come before Audience in the category and step editors: the home mode is checked first, then the audience, and both have to allow a channel.
- Every editor block starts with a line on what it is about (*How the notification is delivered in each home mode*, *Who gets the notification in each state*, ...); the home mode dialog's channel list uses the Channels line. These replace the *The columns are ...* hints.
- The Upcoming lines on the Overview start with *Shows*: *Shows in Night or Away home mode*, *Shows when you arrive home*, and for a user without a person the names (*Shows when Anna or Béla arrives home*), or *someone* with more than three people. *Go away* is now *leave home*.
- Switch texts: *Hide while conditions are not met*, and in Done when *When the activation is no longer true*. The built-in Done, Dismiss and Snooze rows of the button dialog show only their name.

## 0.7.2

Code review fixes, button dialog order, Tap behavior as one block, export in the Companion app.

### Fixed

- Conditions with a *Notification state* or *Notification entities* condition on other cards (Show when, Hide while, Done when activation conditions no longer true) are checked again when a card changes; entity conditions also every minute.
- A *Notification state* trigger on *Dismissed* or *Expired* with *For* never fired: the card is gone at once. It fires now, unless a newer card took its place.
- A light shows the new settings (brightness, colour, effect) at once when they are saved while it shows a card; it also blinks again.
- A channel's **Test** uses the values of the dialog for the test only; the running light, speaker or siren keeps its saved settings (closing the dialog with Cancel used to leave the tried values in use).
- A sounding siren moves to a changed entity, and stops when the integration unloads or reloads.
- A button's actions run one after the other: each waits for the one before it (Mute, the entity action, the notification state, then the Home Assistant actions). The panel does not wait for the actions to finish.
- A *Notification entities* trigger in an automation keeps following the lists after the integration is reloaded, and passes the context of the state change on.
- Saving checks the notification and step named by a *Notification state* or *Notification entities* condition too (not only triggers), and the step of a trigger or condition. Deleting a notification that others refer to says which ones.
- Two changes of the configuration made at the same time no longer lose one of them (they run one after the other).
- A snooze that ended while Home Assistant was starting wakes the card once Home Assistant has started, not before.
- The setup of the integration stops everything it started when it fails; the panel's commands find the loaded integration through its config entry.
- A template error is logged once per text, not at every redraw.
- *Export* downloads the YAML file in the Home Assistant Companion app too (it is downloaded from a signed address, as Home Assistant's backups).

### Removed

- The fields that were stored but never used: a step's and the *Trigger* action's `attachments`, a button's `confirm` and the volume of *Read the message* in General. They are dropped from saved configurations and from YAML exports of earlier versions (export version 3). The ideas stay in BACKLOG.md.
- Leftovers of the 0.x upgrades: the earlier names and forms of highlight, repeat, state names, data types, entity group area and label, push settings and the old event entity.

### Changed

- A button's dialog shows its Actions in this order: *Notification state* (fixed on Done, Dismiss and Snooze), *Entity action* (a switch, always there), *Mute* (added with *Add mute*, deleted from its row), the Home Assistant actions and *Navigation*. They still run Mute first.
- **Tap behavior** is one block, in the category too: *Action* (the Tap's Actions, edited as a button's, with the Navigation always in it) or *Button action* (only the button is chosen). A notification follows the category's whole block, or has its own; *Reset* beside Tap behavior follows the category again. Saved Taps that only showed more info, or ran the category's button, follow the category (storage minor 5, export version 4).
- The *Notification entities* trigger at the top of Activation says in its title whether it is *Set* or *Not in use*.
- The push and the engine take a card's buttons from the same place (one copy of the code); the same for the condition of a mode.

## 0.7.1

Button action list.

### Changed

- A button's single **Action** is now an **Actions** list, in a fixed order: *Mute* and *Entity action* (switch rows, as the Conditions and Done rows), *Notification state* (Done, Dismiss or Snooze for a chosen time; fixed on the built-in Done, Dismiss and Snooze, where Snooze shows its times), any number of Home Assistant actions (each its own row, reorderable among themselves), and *Navigation* (Navigate or More info) last. Under the list: *Add action*, *Add notification state* and *Add navigation*. *Reset* beside Actions brings back the default of a category's button. An action that cannot run is skipped and the others still run.
- **Tap behavior** can be *Custom* (its own actions) or *Button action* (runs another button, for example Done). Set in the category, changed in a notification.
- The built-in rows of Conditions and Done have their switch at the end.
- An entity group member's entity action: no *Custom action* switch; changing the action makes it the member's own, *Reset* beside the button brings the group's back.
- People: the *Away* chip is red.
- General: *Push* comes before *Snooze*; its row shows only the page's name, and its dialog drops the line about the People page.
- The warning about more than three push buttons is under the Buttons title of Interactions: *Only the first three active buttons show in the Android push notification.*
- The stored button field `action` becomes `actions`; the configuration and older YAML exports (export version 1) are upgraded when loaded or imported, and saved in the new form. The never offered *Show attachment* action is dropped.

### Removed

- The code that upgraded configurations of 0.6.8 and earlier. Update to 0.7.0 first (it saves the upgraded configuration when loading), then to this version. A configuration still in an earlier form is refused.

## 0.7.0

First round of phase 7 (moving a real setup into the panel).

### Added

- **Highlight** of a category or notification: *Normal* (default), *Pulse*, *Glow* or *Alert*, the card styles of the dashboard card. The panel and the dashboard cards show an active card with it; on the lights every highlight but Normal blinks (or shows the light's effect).
- Speaker channel: **Volume** for the notifications of a category or a notification (empty: the speaker's own), and **Play chime** (on by default) above Read the message, so a speaker can only read the message.
- Speaker **Repeat**: *Once*, *Loop* (again and again, without a pause) and *Recurring* (every so often, 1 hour by default).
- The Channels block shows how many channels send.

### Changed

- The configuration is saved when loading changed it (earlier forms are upgraded once, not at every start).
- The Tap behavior has no "Also when the push notification is tapped" switch: a tap on the push always opens the app and runs the Tap. `push_tap` is dropped when the configuration is loaded.
- Highlight on/off of earlier versions becomes *Alert* / *Normal*; a speaker's earlier Loop (`until_muted`) becomes the new *Loop*.
- A category's Color, Highlight and Chime fields do not mark a value *(default)*; only a notification marks its category's.
- The Snooze button's dialog always says what the push snoozes for.
- A channel's Delayed starts at 1 hour.
- An entity group's name reads the other way round: area, device class, domain.
- The Audience block's count is the number of people (*2*, not *2/2*).
- Chimes: the pencil comes before the play button, and an own chime says *Custom* instead of its media address.

### Fixed

- Entities: the device an entity's device connects through (such as a Zigbee2MQTT bridge) is no longer shown under the entity.

## 0.6.8

### Added

- **Push channel:** sends notifications to the people's phones through their notify actions (Companion app). A Push row after the Dashboard in every Channels table, switched off until you tick a home mode. Title, message and Info line; on iOS the notification's icon on its colour, on Android the icon and colour; pushes grouped per category.
- Push **Priority**: Silent, Normal, Time-sensitive and Critical (iOS interruption levels; on Android a channel per category for Normal and shared Silent, Time-sensitive and alarm-stream channels for the others; Critical cannot be swiped away until the notification ends).
- Push buttons: the buttons shown in the push work from the phone, as the person who pressed them. iOS shows all of them, Android the first 3; Snooze uses its first time.
- One push per notification and phone: the next step replaces it; it goes away on Done, Dismiss, Snooze, expiry and Hide while, and comes back with the card. Mute keeps it.
- **Open on tap:** the page a tapped push opens, in General › Push (Overview by default) and in the Tap behavior's dialog of a category or notification. A Tap behavior action that is on for the push runs too.
- People: the dialog's **Push** part with *Device* (the notify action) and *Type* (iOS, Android, Other; filled in for a Companion app phone) and a Test; the row shows the device after the sleep condition.
- Test buttons in the Push channel's dialog: to your own phone, and to every phone the notification can reach.
- `sensor.nc_channel_push` (cards on the phones, last sent per person) and a Repairs issue when a person's notify action is missing.

### Changed

- Push ticks of earlier versions are removed once with the update, so nothing is sent before the phones are set. The unused push settings of the early data model (`critical`, `send_again_after`, `sound`, `recipients`, `action_buttons`, `attachments`, `clear_when_done`) are dropped when the configuration is loaded.

## 0.6.7

### Changed

- Light, Sound (speakers and sirens), Chimes and Colors: a pencil at the end of each row opens its dialog, as in the People and Home modes lists; the row itself is not a button any more.
- Chimes: a play button before the pencil plays the sound on this device; pressed again, it stops.
- Deleting an own chime: its categories play Chime and its notifications their category's (the delete text said nothing plays).

## 0.6.6

### Changed

- General › Colors: *System colors* as a palette (only the circles, the name on hover) and *Custom colors* in a list of its own. The page's text is shorter, and Colors comes before Snooze in General, with *1 custom* under it.
- Color fields list the system colours first, then the custom ones.
- A category always has a chime: *None* is gone from its Chime, and a category without one plays *Chime*. A category set to None plays *Chime* now. A notification can still choose None.
- Highlight and Chime of a notification work as Color: choosing the category's value is no own value (no X); the category's value is marked *(default)*.
- Sound: Speakers and Sirens in two lists.
- Light dialog: Settings and Colors are tabs as in the entity group dialog; the Colors tab has a *System colors* and a *Custom colors* list; a line above Dim when dark.
- A line above Condition in the home mode dialog; the line in the channel dialog is full width.

### Fixed

- A step tab shows {Device class} without its braces, as the other placeholders.

## 0.6.5

### Added

- General › Colors: the system colours, and your own colours (*Add color*: a name and a colour). Own colours show in every Color field and on each light's Colors tab.

### Changed

- Color is a system colour or an own colour; *Custom* with its Card color and Light color is gone. Existing custom colours become own colours (*Custom 1* and on), and a different light colour goes to every light's Colors tab. In YAML, `card_color` is now `color` and `light_color` is gone.
- Chime is a setting of the category and the notification (the notification follows its category until it sets its own, with an X to go back), shown only when there is a speaker. A speaker channel no longer has a chime of its own.
- Settings rows: Name, Category and Icon on the first row, Color, Highlight and Chime on the second. No hint under Chime.
- General: **Import and export** opens a dialog instead of a page (Export, Import; an import over existing data asks to Replace first).

## 0.6.4

### Changed

- Settings rows: the notification's and the category's name (and category) on the first row; Icon, Color and Highlight on the second. Highlight is a Normal / Highlighted dropdown in both; a notification's own colour or Highlight has an X that goes back to the category's.
- Add light, Add speaker, Add siren and Add entity are buttons like Home Assistant's Add target, which open an entity picker.
- Channel dialog: a line between Home modes and Settings; *Delayed* in place of *After a delay*; Repeat (Once / Loop) beside When, under Delay when delayed; the Read the message ticks show only when it is on, under a *Read* label.
- Light: Highlight effect always shows (Blink only when the light has no effects); the illuminance sensor has a placeholder in place of a label and lines up with Dim below.
- Sound: a line between the rows; no info on the Sirens header; Volume has an X to clear it.
- Shorter texts: Home modes, Sound and the sleep hint; no intro on People and Chimes; General shows *5 modes* and *YAML configuration*.
- Settings pages, the editors and the Overview all have 24 px under the header.
- General: a line between the rows of the list.

## 0.6.3

Fixes and changes after testing 0.6.2.

### Changed

- **Modes** are now **Home modes** everywhere in the panel (the General list, the page, *Add home mode*, the channel tables and dialogs). YAML and the code keep `modes`.
- General list: Home modes have a green icon, People blue, Light amber. **Snooze** moved to the second block with Import and export, and opens a dialog instead of a page. Sound leaves out what there is none of (*1 speaker*, not *1 speaker, 0 sirens*).
- **People:** the state now shows as a chip like a home mode's *Active*: Home green, Sleep deep purple, Away grey. The line under the name says *Sleep when …*.
- **Light:** *Add light* picks the entity at once (Home Assistant's entity picker in place of the button), with the default settings; the dialog edits the rest and no longer changes the entity. A row reads *Brightness 70% · Dim: 30% · Highlight: Blink*. *Dim below* sits beside the illuminance sensor, *Dim brightness* below them in full width. *Measure illuminance continuously* is on by default for new lights. Light grey, Grey and Dark grey are white on a light by default (a lamp has no grey), also on the Colors tab. Shorter page intro.
- A new light, speaker or siren asks for its home modes without a *Skip* button; closing the dialog saves the ticks shown.
- **Sound:** speakers and sirens are one list with *Speakers* and *Sirens* headers (an info icon tells what can be a siren), with *Add speaker* and *Add siren* below that pick the entity at once (a select first asks for its sound option). The device dialog no longer changes the entity. **Chimes** moved to a page of its own, where the rows can be dragged to set the order of the chime lists (alphabetical by default). **Read the message** opens a dialog; its *Language* is a list of the service's languages, empty by default, with X to clear it.

### Fixed

- Pressing a light colour's Test several times left the light in the test colour; it now goes back to how it was before the first test.

## 0.6.2

Phase 6.1: lights, speakers and sirens.

### Added

- **Light** page (General): lights and switches of the Light channel. A light's dialog follows what it can do: *Brightness* (70%), *Color temperature* for white-only lights, *Highlight effect* (Blink, 1 second on and 1 off, or an effect of the light) when it has effects, and **Dim when dark** (illuminance sensor, *Dim below* 30 lx, *Dim brightness* 30%, *Measure continuously*). Colour lights have a **Colors** tab: each system colour as this light shows it, with a reset and a Test per row.
- A light shows the colour of the first notification it sends (in the Notifications list's order), blinks or shows its effect for a highlighted one, and goes back to how it was when no notification sends, also after several colours. A change you make meanwhile stays. A switch turns on, or blinks.
- **Sound** page (General): **Speakers** (media players, optional volume; a speaker that can announce plays over what it plays, another one gets its volume back), **Sirens** (a siren with tone, volume and duration when it has them, a switch, or a select with a sound and a stop option), **Chimes** (built-in and your own media) and **Read the message** (text-to-speech entity and language).
- Built-in sounds: **Chime**, **Attention**, **Doorbell**, **Alarm** and **Indoor alarm**, also in Home Assistant's media browser.
- A new light, speaker or siren asks which modes it sends in, the same in every category.
- The channel tables list the Dashboard, then every light, speaker and siren with its entity's icon. A device channel's dialog has **Test** (a play icon in its header) that runs it once with the settings shown. A speaker channel has *Chime* (the category's unless changed), *Repeat* (Once, or again and again every so often) and *Read the message* with Name, Message and Info ticks.
- Category: **Color** (a system colour, or *Custom* with *Card color* and *Light color*), **Chime** and **Highlight**. A notification has Color and Highlight (the category's, On or Off) too.
- Button action **Mute**: stops the lights, speakers and sirens of the notification; the card stays.
- A diagnostic sensor per light, speaker and siren: `sensor.nc_channel_<light|speaker|siren>_<object id>`.

### Changed

- *Card color* is now *Color*.
- Data: a light's `transition` and `highlight_effect`, and a speaker's `resume_playback`, are dropped; lights and sirens get their new settings (upgraded once on load).

## 0.6.1

### Changed

- Diagnostic sensor `sensor.nc_channel_dashboard`: `upcoming` (the held back cards, as under Upcoming), `upcoming_waiting_for_<mode>_mode` for each mode, `upcoming_waiting_for_delay`, `upcoming_waiting_for_audience` and `off`, instead of `held_back` and `waiting`.
- Overview, Upcoming: a held back card says what it waits for: *Waiting for Home or Away mode*, *Waiting to arrive home, wake up or go away* (without a person: *Waiting for someone to …*).
- Audience: the Sleep column shows only when someone has a sleep condition (People page), and only those people have a Sleep tick.
- Audience and Channels: one line under each table (the person's state, the house's mode); the warnings read *No condition ticked* and *No mode ticked*. The delay's help reads *Delay after the notification becomes active*.
- General, Snooze: the list shows the time (*At 09:00*); the field is *Default time*, and the page says it is the default time when a notification is snoozed to another day.

## 0.6.0

Phase 6.0: the channel basics and the Dashboard channel.

### Added

- **Channels** of a category: a table with a tick per mode (Home first, then the Modes list's order) and a pencil that opens the channel's dialog with **Modes** and **Settings** (*When*: Immediately or After a delay, counted from when the card becomes active). A channel with no tick is off; a warning shows when no channel sends. On a phone each channel is a row with a summary (*Home, Away · Immediately*) that opens the dialog. 6.0 has the **Dashboard** channel (the panel's Overview and the dashboard cards); lights, speakers and Push follow.
- **Audience** of a category: a table of every Home Assistant person with **Home** (at home and awake), **Sleep** (at home and asleep) and **Away**. A person gets the notifications while in a ticked state; with nobody ticked nothing is sent (warning). A person added later gets what the listed people have in common.
- Steps change the category's Channels and Audience only where they differ. A changed channel row or person row has a reset icon: a channel row's icon resets its mode ticks (after a confirmation); the dialog's *Reset* buttons reset Modes or Settings; a person's icon resets that person.
- When a rule becomes true later (the mode changes, the delay ends, someone comes home or wakes up), the channel sends then, while the card is still active.
- **People** page (General): every Home Assistant person with their current state, and when they are asleep, set like a mode's condition (None, State or Template). Asleep counts only at home.
- The Dashboard shows each user the cards meant for their person in their current state; a user without a person sees what at least one person of the audience gets. Cards held back show under **Upcoming** with the reason (*Shows 7:41*, *Held back in Away mode*, *Waiting for the audience*). With *Ignore audience* the list card shows what the Dashboard shows anyone.
- Diagnostic sensor `sensor.nc_channel_dashboard`: the cards the Dashboard shows, with `held_back` (mode, off) and `waiting` (delay, audience). `sensor.notification_center` still counts every active card.

### Changed

- With no active mode, only the channels ticked in at least one mode send (no longer every channel).
- A new category starts with General's channels and audience; *Run now* and the trigger action follow the channel rules.
- Data: the *Notification center* channel is now `dashboard`; `when` is replaced by `delay`; a step's `audience` list becomes per-person states; a person's `sleep_entity` becomes a `sleep` condition (State *on*). Older data is upgraded once on load; every category gets the Dashboard in every mode.
- The entity dialogs in the editor show the room, the parent device and the device above the entity's name, as Home Assistant's more info dialog; the entity rows say the same.
- Notifications and Categories lists: rows have the same room at the sides as the General list.
- Button dialogs in a notification: a label that comes from the category can be changed in YAML only again (as before 0.5.1); a notification's own custom buttons keep their label field. In the category, a built-in button's label still has X to go back to the default.

## 0.5.1

### Changed

- Settings: the tabs have icons; every list has as much room at the sides as under the header (also the Overview and the editors).
- General: Modes, Snooze and Import and export (in its own block) open as pages of their own, with a header and what they do at the top; the list has short lines under the names, as Home Assistant's System settings.
- Categories list: the number of notifications is under the name.
- Category editor preview: the message of the first notification with an entity, rendered for that entity (real values). Previews without an entity: the placeholders read as words, *Area* instead of *{Area}*.
- Category editor: *Category name*, no extra room under it; the blocks are always open; the category's custom buttons have no amber icon there (only in the notifications).
- Modes: the condition is State or Template (Toggle is the same as State *on*; a `toggle` condition in YAML still works). The channels of a new mode cannot be skipped.
- Button dialogs: a built-in or inherited button's label can be set, and X goes back to the default (or the category's); *Show button in the push notification* is on by default for every button, custom ones too; the Snooze times have more room on a phone.

## 0.5.0

Phase 5: categories, modes and the General settings.

### Added

- Settings: **Categories** tab, alphabetical, with the number of notifications per category and *Add category*. The category editor is a page with a preview, *Notifications* (the list filtered to the category) and Delete; a category with notifications cannot be deleted (*View notifications*), the General category never. A new category starts with General's icon and colour.
- Category buttons (`buttons` in a category): Tap behavior, the built-in buttons and custom buttons, with label, icon, Snooze times and push setting, but no action. Notifications use them live, in their own blocks with amber icons: the label always applies, the icon and the Snooze times unless the notification sets its own; *Show button in the push notification* follows the category unless the notification chooses (a dropdown that can be cleared). A category's custom button can only be switched off in a notification; deleting it in the category (or moving the notification to another category) turns it into an own custom button.
- **General** settings in the style of Home Assistant's System settings: **Modes** and **Snooze** (*Tomorrow at*), import and export, the version.
- **Modes** page: one active mode, the first whose condition (toggle, state or template) is true, with an *Active* chip; the order can be dragged. *Add mode* saves the mode with Home's channels, then asks which channels to switch on for it in every category.
- Home can have a condition. Without one it is always true, shown on top and checked last; with one it is a normal row. With no active mode the page says *No active mode* and every channel sends.
- Audience: the people are shown with Home Assistant's person badge.
- Notification Center card: **Show empty state** (`show_empty`). While nothing is active, the card stays on the dashboard and says *All done* instead of hiding itself.

### Changed

- Overview with nothing active: *All done* under a large icon in the text colour, centred, with more room above and below.
- Editor: the number of a step with an active card is green.
- The General category has only Done switched on by default; the Snooze times of a category (`snooze`) became its Snooze button's times. Existing categories get their buttons once, from their old Snooze setting.
- A notification step keeps only what differs from its category's buttons.

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
