// The help texts of the step editor.

export type StartKind = "triggers" | "schedule" | "repeat";

export const HELP: Record<
  StartKind | "show" | "done" | "dismiss" | "interactions",
  { title: string; text: string[] }
> = {
  triggers: {
    title: "Triggers",
    text: [
      "The step is activated when one of its triggers fires, like an automation.",
      "Notification entities, at the top, watches the entities of the Entities block: every entity gets its own notification when it starts to match, for example when a leak sensor turns on. State tests the state or an attribute; Numeric state tests a number against a limit. Left empty, it is not used.",
      "The Notification entities triggers in the list do the same with the entities of any notification, and Notification state activates the step when this or another notification (or one of its steps) reaches a state, for example when step 1 is snoozed.",
      "Without triggers, only the Trigger action (or Run now) activates the step.",
    ],
  },
  schedule: {
    title: "Schedule",
    text: [
      "The step comes on the calendar: every N days, weeks on the chosen days, months on a day, or years, at a time.",
      "Expires closes a notification nobody did, after a while or on a day at a time.",
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
      "One set of conditions, used as switched on above them.",
      "Activate only while conditions are met: the step is activated only when they are all true at that moment, for example the door notification only while the alarm is armed. A scheduled notification waits for them, hidden, until it expires.",
      "Hide while conditions are not met: an active notification is hidden while any of them is false, and shows again when they are all true, for example the window notification only while the heating is on. Push and light come again when it shows.",
    ],
  },
  interactions: {
    title: "Interactions",
    text: [
      "The buttons of the notification and what a tap on it does. Each button has a list of Actions that run one after the other: Mute, the entity action, the notification state (Done, Dismiss or Snooze), the Home Assistant actions, then the Navigation (More info or Navigate).",
      "Tap behavior comes from the category unless the notification sets its own: Action runs the Tap's own Actions, Button action runs the actions of the chosen button.",
      "Show in push puts the button on the push notification too (with the push channel). Android shows at most 3.",
    ],
  },
  done: {
    title: "Done when",
    text: [
      "The notification closes as done by itself when one of these triggers fires, for example when the washing machine door opens.",
      "Dismiss when (in the step menu) adds a block of triggers that close the notification as dismissed instead.",
      "When the activation is no longer true: an entity's notification closes when that entity no longer matches Notification entities at the top of Activation (the leak is dry again), and a notification closes when the Conditions it was activated with are no longer met (with Activate only while conditions are met switched on).",
    ],
  },
  dismiss: {
    title: "Dismiss when",
    text: [
      "The notification closes as dismissed by itself when one of these triggers fires: it is not done, so Last done does not change. For example, the cat's notification is dismissed when everyone leaves home.",
      "The block is shown while Dismiss when is ticked in the step menu; unticking it removes the block and its triggers.",
    ],
  },
};
