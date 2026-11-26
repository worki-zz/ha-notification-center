// Where a failed save points to: the step and block named by the path of the
// error ("notifications → Name → step 2 → activation: …"), so the editor can
// open that block and say where the problem is.

import { STEP_BLOCKS, type StepBlock } from "./step-editor";

export interface ErrorTarget {
  /** Index of the step, when the error names one. */
  step?: number;
  block?: StepBlock;
  /** Name of the block for the message. */
  blockName?: string;
}

const BLOCKS: Record<string, { block: StepBlock; name: string }> = {
  message: { block: "message", name: "Message" },
  title: { block: "message", name: "Message" },
  text: { block: "message", name: "Message" },
  buttons: { block: "interactions", name: "Interactions" },
  interactions: { block: "interactions", name: "Interactions" },
  tap: { block: "interactions", name: "Interactions" },
  activation: { block: "start", name: "Activation" },
  schedule: { block: "start", name: "Activation" },
  conditions: { block: "start", name: "Activation" },
  "done when": { block: "done", name: "Done when" },
  done_when: { block: "done", name: "Done when" },
  "dismiss when": { block: "dismiss", name: "Dismiss when" },
  dismiss_when: { block: "dismiss", name: "Dismiss when" },
  "snooze when": { block: "snooze", name: "Snooze when" },
  snooze_when: { block: "snooze", name: "Snooze when" },
  "mute when": { block: "mute", name: "Mute when" },
  mute_when: { block: "mute", name: "Mute when" },
  audience: { block: "audience", name: "Audience" },
  channels: { block: "channels", name: "Channels" },
};

export function errorTarget(message: string): ErrorTarget {
  const parts = message.split("→").map((part) => part.trim());
  const target: ErrorTarget = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].split(":")[0].trim();
    const numbered = /^step (\d+)$/.exec(part);
    if (numbered) {
      target.step = Number(numbered[1]) - 1;
    } else if (part === "steps" && /^\d+/.test(parts[i + 1] ?? "")) {
      target.step = Number.parseInt(parts[i + 1], 10);
    } else if (target.step !== undefined && !target.block && part in BLOCKS) {
      const found = BLOCKS[part];
      if ((STEP_BLOCKS as readonly string[]).includes(found.block)) {
        target.block = found.block;
        target.blockName = found.name;
      }
    }
  }
  return target;
}

/** The message with the place in front: "Step 2, Activation: …". */
export function errorWithPlace(message: string, target: ErrorTarget): string {
  if (target.step === undefined) return message;
  const place = [`Step ${target.step + 1}`, target.blockName].filter(Boolean).join(", ");
  return `${place}: ${message}`;
}
