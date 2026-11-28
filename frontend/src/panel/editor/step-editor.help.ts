// The help texts of the step editor.

export type StartKind = "triggers" | "schedule" | "repeat";

export const HELP: Record<
  StartKind | "show" | "done" | "dismiss" | "snooze" | "mute" | "actions" | "interactions",
  { title: string; text: string[] }
> = {
  triggers: {
    title: "Triggers",
    text: [
      "The step is activated when one of its triggers fires, like an automation.",
      "Notification entities, at the top, watches the entities of the Entities block: every entity gets its own notification when it starts to match, for example when a leak sensor turns on. State tests the state or an attribute; Numeric state tests a number against a limit. Left empty, it is not used.",
      "Notification state, at the top from step 2, activates the step when a step of this notification (the previous one at first, or Any step) reaches a state, for a while if For is set: for example step 2 when step 1 has been active for an hour.",
      "The Notification entities triggers in the list do the same with the entities of any notification, and Notification state activates the step when this or another notification (or one of its steps) reaches a state, for example when step 1 is snoozed.",
      "Without triggers, only the Trigger action (or Run now) activates the step.",
    ],
  },
  schedule: {
    title: "Schedule",
    text: [
      "The step comes on the calendar: every N days, weeks on the chosen days, months on a day, or years, at a time.",
      "To close a notification nobody did, use Expiration in Dismiss when (or in Done when).",
    ],
  },
  repeat: {
    title: "Repeat after done",
    text: [
      "The step comes again N days, weeks, months or years after it was last done, at a time if one is set. Watering plants or changing a filter are typical.",
      "A new step counts from when it was made. The pencil sets the next time: it is stored as when the step was last done.",
      "Every can be a number or the value of an entity, such as an input number.",
    ],
  },
  show: {
    title: "Conditions",
    text: [
      "One set of conditions. If the conditions are not met, the choice above them decides what happens.",
      "Wait until they are met (the default): the notification is activated hidden, shows once they are all true, and hides again whenever any of them is false, for example the window notification only while the heating is on. Push and light come again when it shows. A scheduled notification waits like this until Expiration closes it.",
      "Don't activate: the step is activated only when they are all true at that moment, for example the door notification only while the alarm is armed. Once active, it stays. A scheduled step skips that occurrence, as Dismiss early does, and comes again at the next one; after last done counts it from the time it was due.",
      "Notification state, at the top from step 2, tests a step of this notification (the previous one at first, or Any step): Now, for at least is true while it is in a state (for a while if set); Within the last is true when it reached the state within that time, even if it has left it since. Done and Dismissed with Now count only today's notifications, so for a step done yesterday evening use Within the last.",
    ],
  },
  interactions: {
    title: "Interactions",
    text: [
      "The buttons of the notification and what a tap on it does. Each one has two tabs: Settings (how and where it shows, and the Navigation) and Actions (what it does).",
      "Done, Dismiss, Snooze and Mute set their notification state. Their actions are in the step's status block of that state (Done when, Dismiss when, Snooze when, Mute when), which runs whatever changed the state; Run … actions switched off on a button sets the state without them.",
      "A custom button and the Tap can set a notification state too, and have their own actions: the entity action and Home Assistant actions. They run first, then the state, then the Navigation on the device where it was pressed. The Tap can instead do the same as another button.",
      "Every setting comes from the category until the notification sets its own. Show in push puts the button on the push notification too (with the push channel). Android shows at most 3.",
    ],
  },
  done: {
    title: "Done when",
    text: [
      "The notification closes as done by itself when one of these triggers fires, for example when the washing machine door opens.",
      "Expiration, at the top, closes it as done after a while from when it became active, or on that day (or some days later) at a time. When Dismiss when also has one, the earlier one counts.",
      "To close it as dismissed instead (not done), use Dismiss when, the next block.",
      "When the activation is no longer true: an entity's notification closes when that entity no longer matches Notification entities at the top of Activation (the leak is dry again), and a notification closes when the Conditions it was activated with are no longer met (with Don't activate chosen, on a triggered step).",
      "The Actions tab runs whenever the notification is done: by these triggers, the Done button, the Done action or an automation.",
    ],
  },
  dismiss: {
    title: "Dismiss when",
    text: [
      "The notification closes as dismissed by itself when one of these triggers fires: it is not done, so Last done does not change. For example, the cat's notification is dismissed when everyone leaves home.",
      "Expiration, at the top, dismisses it after a while from when it became active, or on that day (or some days later) at a time: the bins notification is dismissed the next morning if nobody took the bins out.",
      "The Actions tab runs whenever the notification is dismissed, whatever dismissed it.",
    ],
  },
  snooze: {
    title: "Snooze when",
    text: [
      "The notification is snoozed by itself when one of these triggers fires, for the Snooze for of the step's Snooze button. For example, the plants notification is snoozed when everyone leaves home.",
      "The Actions tab runs whenever the notification is snoozed, whatever snoozed it. Run the Activation actions again when the snooze ends, for example to switch a reminder light back on.",
      "Switch the block on or off in the step's menu (⋮). Off, it keeps what it holds, but nothing of it runs.",
    ],
  },
  mute: {
    title: "Mute when",
    text: [
      "The notification is muted by itself when one of these triggers fires: its lights, speakers and sirens stop, the notification stays.",
      "The Actions tab runs whenever the notification is muted, whatever muted it.",
      "Switch the block on or off in the step's menu (⋮). Off, it keeps what it holds, but nothing of it runs.",
    ],
  },
  actions: {
    title: "Actions",
    text: [
      "They run when the notification reaches this status, whatever caused it: a trigger, a button on the dashboard or in the push, Expiration, the integration's own action or an automation. For a notification of entities, they run for each entity.",
      "Run the entity action runs the action each entity has for this block in the Entities block.",
      "In templates, status is the new status (active, done, dismissed, snoozed, muted) and cause tells what caused it: cause.source (trigger, button, push, expiration, action, schedule, snooze_end), and when known cause.button, cause.user_id and cause.person.",
    ],
  },
};
