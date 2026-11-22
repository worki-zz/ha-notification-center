# Backlog after 1.0

Ideas and features that came up during the build and were deferred to after the 1.0 release. This is a living list: every new request or postponed item is added here, with a short description and where it came from. When an item is planned for a release, it moves into that release's plan and is removed from here.

Items are grouped by priority (set by Kristóf, 2026-11-19); each shows its area. A new item goes to Low unless a priority is agreed for it.

## High priority

### Button action on the card's entity
*Area: Notification editor.* A button's Action (Home Assistant action) can target the card's own entity, so one button action fits every entity of the notification without entity actions. *(Kristóf, 2026-11-20; phase 4)*

### Notification details view
*Area: Notification content.* A detail page per notification (like a more-info dialog of its own) with the full message, data, attachments and history. Once it exists, it is also offered as a button action ("Notification details") next to Entity action, More info, Action and Navigate. *(Phase 3 and phase 4, 2026-11-19)*

### Skip next
*Area: Buttons and interactions.* Skip the next occurrence of a scheduled or repeating notification without marking it done, for example when the garbage collection is moved or the family is away. *(Dev plan, 2026-11-15)*

### Statistics
*Area: Insight.* Simple statistics per notification, such as how often it fired and how long it took until it was done. Built on the Home Assistant recorder data of the notification sensors. *(Phase 4, 2026-11-19)*

## Medium priority

### Alarm images and clips
*Area: Notification content.* Attach a snapshot or a short clip to an alarm notification, shown on the card and in the push. No Frigate: the images come from an own automation that saves them at alarm time; the options for passing them to the notification still need a discussion. The `show_attachment` button action already exists in the data model but does nothing yet. *(Scope cut, 2026-11-15; phase 3)*

### Scheduled preview card
*Area: Cards and panel.* A dashboard card that shows the upcoming scheduled notifications (for example the next garbage collections), not only the active ones. *(Phase 3, 2026-11-18)*

### Icon tap behavior
*Area: Cards and panel.* The card's icon gets its own tap behavior, as Home Assistant's tile card has (icon tap action), following Home Assistant's general tap logic. *(Kristóf, 2026-11-20; phase 4)*

### TV channel
*Area: Channels.* Push notifications to the LG webOS TV (`notify.tv`) as a separate channel instead of a push device, since a TV needs other options than a phone (no buttons, short text, maybe only while it is on). *(Scope cut, 2026-11-15)*

### Resume Cast music after a chime
*Area: Channels.* A Google Cast speaker cannot announce, so a chime stops what it plays. Resume the music (or the stream) after the chime instead of leaving it stopped. *(Kristóf, 2026-11-22; phase 6.1)*

## Low priority

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

### Trace
*Area: Insight.* A trace view like the one for automations: why a notification became active or closed, which trigger and conditions matched, which channels were sent. Needs its own storage and its own view. *(Phase 4, 2026-11-19)*
