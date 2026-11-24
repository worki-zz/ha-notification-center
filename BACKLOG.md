# Backlog after 1.0

Ideas and features that came up during the build and were deferred to after the 1.0 release. This is a living list: every new request or postponed item is added here, with a short description and where it came from. When an item is planned for a release, it moves into that release's plan and is removed from here.

Items are grouped by priority (set by Kristóf, 2026-11-19); each shows its area. A new item goes to Low unless a priority is agreed for it.

## High priority

### Actions on every status change
*Area: Notification editor.* Run Home Assistant actions when a notification's status changes, for every status: becomes active, done, dismissed, snoozed, muted (and back). For example: turn off the plug when the washing machine notification is done, or log a dismiss. Today an automation with the Notification state trigger can do it. *(Kristóf, 2026-11-24; feedback after v0.7.3)*

Overlaps with the button actions: an action that should run whenever a notification is done (or dismissed, snoozed) could live here instead of on every button that leads there, and this can partly replace the button's own Home Assistant actions. When it is built, decide which actions stay on the buttons (only what depends on the button pressed, like the entity action) and how the editor shows the two together. *(Kristóf, 2026-11-24; feedback after v0.7.4)*

### Push swipe action
*Area: Push.* What swiping a push away does: today nothing happens (the notification stays). A default for all notifications (in General), a category's and a notification's own, or derived from the buttons. Snooze is the obvious candidate (with its first time), but Dismiss or nothing should also be possible; to be thought through. Needs the Companion app's clear event (`mobile_app_notification_cleared`, Android only; iOS has no such event). *(Kristóf, 2026-11-24; feedback after v0.7.5)*

### Run snapshots (trace)
*Area: Insight.* At each run event of a notification (a step becomes active; a trigger fires but the conditions are false; a notification is closed) store one snapshot: the time, the trigger with its entity and from/to states, the result of the conditions that were checked (as in Home Assistant's automation trace, checking stops at the first false one, so the rest show as not checked; likely recorded with Home Assistant's own condition trace), and the Status dialog's status and channel rows at that moment (which channels sent, to whom, and why the others held back). Keep the last N runs or X days per notification, in a Store key of its own. Shown as a History section in the Status dialog, one expandable row per snapshot. No visualisation of the whole logic chain. Builds on the Status dialog (0.7.x) and also covers "fired but the conditions were false" of the trigger statistics. Replaces the earlier *Why a notification is (not) active* and *Trace* ideas. *(Kristóf, 2026-11-23; M1 of the v0.7.2 review)*

### Button action on the card's entity
*Area: Notification editor.* A button's Action (Home Assistant action) can target the card's own entity, so one button action fits every entity of the notification without entity actions. *(Kristóf, 2026-11-20; phase 4)*

### Notification details view
*Area: Notification content.* A detail page per notification (like a more-info dialog of its own) with the title, the message, the Info line, the buttons, the attachments and the time, plus the data and history. Once it exists, it is also offered as a button action ("Notification details") next to Entity action, More info, Action and Navigate, and as one of the pages a tapped push can open (besides a path). Until then the Navigation *Notification info* opens the Status dialog on the Overview; it then opens this page, which may become the default navigation. *(Phase 3 and phase 4, 2026-11-19; extended by Kristóf, 2026-11-23, phase 6.2 and 2026-11-24)*

### Skip next
*Area: Buttons and interactions.* Skip the next occurrence of a scheduled or repeating notification without marking it done, for example when the garbage collection is moved or the family is away. *(Dev plan, 2026-11-15)*

### Statistics
*Area: Insight.* Simple statistics per notification, such as how often it fired and how long it took until it was done. Built on the Home Assistant recorder data of the notification sensors. *(Phase 4, 2026-11-19)*

## Medium priority

### Snooze and Mute status triggers and action blocks
*Area: Notification editor.* Snooze and Mute as triggers of their own (for example: snooze or mute the notification when something happens, as Done when does for done) and as blocks of a step, like Done when. Kristóf's idea: a *Show … block* checkbox in the step menu that adds the block; to weigh against a built-in Mute button. Goes with the open Dismiss trigger question (item 8 of the feedback after v0.7.3). *(Kristóf, 2026-11-24; feedback after v0.7.3)*

### Live condition badges in the editor
*Area: Notification editor.* Home Assistant's automation editor marks each condition with a live green or orange badge (true or false right now). It renders that badge only when the conditions open their options in the sidebar; the notification editor shows them inline, so they get no badge. Show the live result next to each condition of a step, Notification state and Notification entities included. *(Kristóf, 2026-11-23; M1 of the v0.7.2 review)*

### First steps and a full guide in the panel
*Area: Panel.* Guidance for a new installation: first steps on an empty Overview (add a person, a push device, a first notification), and a full description that can be opened from the panel, not only in the README. *(Kristóf, 2026-11-23; v0.7.2 review)*

### README: Getting started
*Area: Documentation.* A short Getting started chapter in the README, from installation to the first notification on the dashboard and on a phone. *(Kristóf, 2026-11-23; v0.7.2 review)*

### Alarm images and clips
*Area: Notification content.* Attach a snapshot or a short clip to an alarm notification, shown on the card and in the push. No Frigate: the images come from an own automation that saves them at alarm time; the options for passing them to the notification still need a discussion. The earlier `show_attachment` button action was removed from the data model with the action list (0.7.1); it would come back as a Navigation choice. *(Scope cut, 2026-11-15; phase 3)*

### Scheduled preview card
*Area: Cards and panel.* A dashboard card that shows the upcoming scheduled notifications (for example the next garbage collections), not only the active ones. *(Phase 3, 2026-11-18)*

### Icon tap behavior
*Area: Cards and panel.* The card's icon gets its own tap behavior, as Home Assistant's tile card has (icon tap action), following Home Assistant's general tap logic. *(Kristóf, 2026-11-20; phase 4)*

### TV channel
*Area: Channels.* Push notifications to the LG webOS TV (`notify.tv`) as a separate channel instead of a push device, since a TV needs other options than a phone (no buttons, short text, maybe only while it is on). *(Scope cut, 2026-11-15)*

### Resume Cast music after a chime
*Area: Channels.* A Google Cast speaker cannot announce, so a chime stops what it plays. Resume the music (or the stream) after the chime instead of leaving it stopped. *(Kristóf, 2026-11-22; phase 6.1)*

### Keep when done
*Area: Channels (Push).* A *Keep when done* switch of the push: when the notification ends, the push is not removed but silently replaced by a closing line, such as *Ended at 14:32*, *Done by Dóra at 14:32* or *Muted by Kristóf*. Until then the push follows the card (Mute keeps it). *(Kristóf, 2026-11-23; phase 6.2)*

### Speaker without announce while playing
*Area: Sound.* A speaker that cannot announce (Home Assistant's announce feature) stops what it plays to play a chime or a message. A speaker-level setting *While playing*: *Skip*, *Play anyway*, or *After it stops* (with a timeout). Highlighted notifications always play. The reason shows in the Status dialog and the Activity log. *(Kristóf, 2026-11-24; feedback after v0.7.4)*

## Low priority

### Hungarian frontend
*Area: Panel.* The panel and the dashboard cards are English only; the backend strings already have a Hungarian translation. A translated frontend, following the user's Home Assistant language. *(Kristóf, 2026-11-23; v0.7.2 review)*

### Configuration readable by non-administrators
*Area: Panel.* Every user can open the panel, but the configuration (categories, people, modes) is read through administrator commands. A read-only view for the other users. *(Kristóf, 2026-11-23; v0.7.2 review)*

### Send to
*Area: Channels (Push).* A *Send to* setting of the push channel: only people who are in the selected state (Home, Sleep, Away) get the push, apart from the Audience. For now Home modes cover the cases (push only in a "nobody home" mode, speaker off in a "someone asleep" mode). *(Kristóf, 2026-11-23; phase 6.2)*

### Repeat a push
*Area: Channels (Push).* Send the push again every so often until the notification is done or muted (Once or Loop), as a speaker repeats. Examples: a leak or an open freezer that nobody reacts to. Not needed for 1.0. *(Kristóf, 2026-11-23; phase 6.2)*

### Live push text
*Area: Channels (Push).* When the text of an active notification changes (for example the washing machine's time left), update the push silently, at most every 5 minutes (the Companion app allows about 500 pushes a day per phone). Together with iOS Live Activities and Android Live Updates, which show such a value live. Now the push keeps the text it was sent with; a new step replaces it (one push per notification and phone). *(Kristóf, 2026-11-23; phase 6.2)*

### More push devices per person
*Area: Channels (Push).* More than one phone or tablet per person on the People page. Now each person has one push device. *(Phase 6.2, 2026-11-23)*

### Require unlocked phone
*Area: Buttons and interactions.* A per-button *Require unlocked phone* setting for the push (the Companion app's `authenticationRequired`), for buttons such as opening the garage door. *(Kristóf, 2026-11-23; phase 6.2)*

### On departure
*Area: Channels.* Send a channel when a person leaves home (for example a reminder that is only useful on the way out). Mostly covered by the Away state of the Audience and the late send; a separate trigger may still be useful. *(Kristóf, 2026-11-21; phase 6.0)*

### Display channel
*Area: Channels.* Show notifications on smart displays (for example a Nest Hub) as a channel of its own, with its own settings like the other channels. Deferred as a whole; 1.0 has no display support. *(Scope cut, 2026-11-15)*

### Large mode for displays
*Area: Channels.* A larger card layout for wall or kitchen displays such as the Nest Hub, readable from a distance. Belongs with the Display channel. *(Phase 3, 2026-11-18)*

### Glow light effect
*Area: Channels.* An own light effect besides *Notification Pulse* (which since 0.7.4 pulses dimmable lights between their brightness and half of it) for a highlighted notification: a slow glow, for lights without effects of their own. *(Phase 6.1, 2026-11-22; pulse done 2026-11-24)*

### Confirmation for buttons
*Area: Buttons and interactions.* Ask "Are you sure?" before a button runs its action, like the confirmation option of Home Assistant's tap actions. *(Phase 3, 2026-11-19)*

### Debug mode
*Area: Insight.* A switch in General settings that writes an Activity (logbook) entry for every push, light, speaker and siren send, with whom it went to. Off by default: in daily use these entries are noise. *(Kristóf, 2026-11-23; M1 of the v0.7.2 review)*

### Trigger statistics
*Area: Insight.* When each trigger of a step last fired, how often, and when it last fired while the conditions were false. Belongs with *Statistics*; the "conditions false" part is covered by *Run snapshots*. Home Assistant itself could keep the trigger times. *(Kristóf, 2026-11-23; M1 of the v0.7.2 review)*

### History
*Area: Insight.* A history of each notification: when it became active, which step it was on, who marked it done, dismissed or snoozed it, and when. Can be built on the Home Assistant recorder data of the notification sensors. *(Phase 4, 2026-11-19)*

### Chime per speaker
*Area: Channels.* Let a speaker channel play another chime than the notification's (for example a softer one in the bedroom). 0.6.5 moved the chime to the category and the notification only. *(Kristóf, 2026-11-22; phase 6.1)*

### Switch system colors on and off
*Area: Settings.* Under Colors, a switch for each system color. A color that is switched off is not offered in the color pickers or in the channel lists, so the many greys do not crowd them. A color in use stays usable. *(Kristóf, 2026-11-24; feedback after v0.7.4)*
