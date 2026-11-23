# Backlog after 1.0

Ideas and features that came up during the build and were deferred to after the 1.0 release. This is a living list: every new request or postponed item is added here, with a short description and where it came from. When an item is planned for a release, it moves into that release's plan and is removed from here.

Items are grouped by priority (set by Kristóf, 2026-11-19); each shows its area. A new item goes to Low unless a priority is agreed for it.

## High priority

### Why a notification is (not) active: diagnostics and trace
*Area: Insight.* Answers to "why did this fire, why did this not, why is nothing sent": a trace view like the one for automations (which trigger and conditions matched, which channels were sent or held back and why), the Activity log entries behind it, a "why is this notification not active" answer, and in the editor a live view of whether each condition is true right now, as in the automation editor. Any simple part may be built before 1.0; the logic and the views are discussed in a thread of their own. Replaces the earlier *Trace* idea. *(Kristóf, 2026-11-23; v0.7.2 review)*

### Button action on the card's entity
*Area: Notification editor.* A button's Action (Home Assistant action) can target the card's own entity, so one button action fits every entity of the notification without entity actions. *(Kristóf, 2026-11-20; phase 4)*

### Notification details view
*Area: Notification content.* A detail page per notification (like a more-info dialog of its own) with the title, the message, the Info line, the buttons, the attachments and the time, plus the data and history. Once it exists, it is also offered as a button action ("Notification details") next to Entity action, More info, Action and Navigate, and as one of the pages a tapped push can open (besides a path). *(Phase 3 and phase 4, 2026-11-19; extended by Kristóf, 2026-11-23, phase 6.2)*

### Skip next
*Area: Buttons and interactions.* Skip the next occurrence of a scheduled or repeating notification without marking it done, for example when the garbage collection is moved or the family is away. *(Dev plan, 2026-11-15)*

### Statistics
*Area: Insight.* Simple statistics per notification, such as how often it fired and how long it took until it was done. Built on the Home Assistant recorder data of the notification sensors. *(Phase 4, 2026-11-19)*

## Medium priority

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
*Area: Channels (Push).* A *Keep when done* switch of the push: when the notification ends, the push is not removed but silently replaced by a closing line, such as *Ended at 14:32*, *Done by Dóra at 14:32* or *Silenced by Kristóf*. Until then the push follows the card (Silence keeps it). *(Kristóf, 2026-11-23; phase 6.2)*

## Low priority

### Hungarian frontend
*Area: Panel.* The panel and the dashboard cards are English only; the backend strings already have a Hungarian translation. A translated frontend, following the user's Home Assistant language. *(Kristóf, 2026-11-23; v0.7.2 review)*

### Configuration readable by non-administrators
*Area: Panel.* Every user can open the panel, but the configuration (categories, people, modes) is read through administrator commands. A read-only view for the other users. *(Kristóf, 2026-11-23; v0.7.2 review)*

### Send to
*Area: Channels (Push).* A *Send to* setting of the push channel: only people who are in the selected state (Home, Sleep, Away) get the push, apart from the Audience. For now Home modes cover the cases (push only in a "nobody home" mode, speaker off in a "someone asleep" mode). *(Kristóf, 2026-11-23; phase 6.2)*

### Repeat a push
*Area: Channels (Push).* Send the push again every so often until the notification is done or silenced (Once or Loop), as a speaker repeats. Examples: a leak or an open freezer that nobody reacts to. Not needed for 1.0. *(Kristóf, 2026-11-23; phase 6.2)*

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

### Glow and pulse light effects
*Area: Channels.* Own light effects besides Blink for a highlighted notification: a slow glow or a pulse of the brightness, for lights without effects of their own. *(Phase 6.1, 2026-11-22)*

### Confirmation for buttons
*Area: Buttons and interactions.* Ask "Are you sure?" before a button runs its action, like the confirmation option of Home Assistant's tap actions. *(Phase 3, 2026-11-19)*

### History
*Area: Insight.* A history of each notification: when it became active, which step it was on, who marked it done, dismissed or snoozed it, and when. Can be built on the Home Assistant recorder data of the notification sensors. *(Phase 4, 2026-11-19)*

### Chime per speaker
*Area: Channels.* Let a speaker channel play another chime than the notification's (for example a softer one in the bedroom). 0.6.5 moved the chime to the category and the notification only. *(Kristóf, 2026-11-22; phase 6.1)*
