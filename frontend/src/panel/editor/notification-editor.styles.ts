// The styles of the notification editor.

import { css, unsafeCSS } from "lit";
import { STATUS_STYLES } from "../status";
import { BLOCK_STYLES } from "./block";

export const NOTIFICATION_EDITOR_STYLES = css`
    :host {
      display: block;
      height: 100%;
    }
    ha-card.yaml {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 0;
      overflow: hidden;
    }
    ha-card.yaml ha-alert {
      padding: 0 16px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .toolbar .status {
      margin-inline-end: 8px;
    }
    /* The status chip opens the Information dialog. */
    .status-button {
      display: inline-flex;
      cursor: pointer;
      border-radius: var(--ha-badge-border-radius, 9999px);
    }
    .status-button:focus-visible {
      outline: 2px solid var(--primary-color);
    }
    ha-switch {
      flex: none;
    }
    .toolbar ha-switch {
      margin: 0 8px;
    }
    .content {
      max-width: 1040px;
      margin: 0 auto;
      /* As much room under the header as on the overview. */
      padding: 24px 16px 96px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-sizing: border-box;
    }
    .preview {
      max-width: 520px;
      width: 100%;
      margin: 0 auto 8px;
      pointer-events: none;
    }
    .block {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .row > * {
      flex: 1 1 240px;
      min-width: 0;
    }
    /* Icon, Color and Highlight stay on one row down to a narrow screen. */
    .row.three > * {
      flex-basis: 160px;
    }
    .spacer {
      flex: 1;
    }
    .tabs > ha-button {
      flex: none;
      white-space: nowrap;
    }
    .icon-select {
      display: block;
    }
    .icon-select ha-picker-field {
      display: block;
      width: 100%;
    }
    .step-number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      margin-inline-end: 8px;
      font-size: var(--ha-font-size-s, 12px);
      color: var(--text-primary-color, #fff);
      background-color: var(--secondary-text-color);
    }
    ha-tab-group-tab[active] .step-number {
      background-color: var(--primary-color);
    }
    /* A step with an active card, like the Active status chip. */
    ha-tab-group-tab.live .step-number {
      background-color: var(--green-color, #4caf50);
    }
    /* A single step has no number: a green dot says it is active. */
    .live-dot {
      --mdc-icon-size: 20px;
      margin-inline: -4px 4px;
      color: var(--green-color, #4caf50);
    }
    .steps {
      display: block;
    }
    .tabs {
      display: flex;
      align-items: center;
      gap: 4px;
      padding-inline-end: 4px;
      border-bottom: 1px solid var(--divider-color);
    }
    .tabs ha-tab-group {
      flex: 0 1 auto;
      min-width: 0;
    }
    ha-tab-group-tab.off {
      opacity: 0.5;
    }
    .step {
      padding: 16px 0 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .fab {
      position: fixed;
      right: calc(16px + var(--safe-area-inset-right, 0px));
      bottom: calc(-80px - var(--safe-area-inset-bottom, 0px));
      transition: bottom 0.3s;
      --ha-button-box-shadow: var(--ha-box-shadow-l);
    }
    .fab.dirty {
      bottom: calc(16px + var(--safe-area-inset-bottom, 0px));
    }
    ${unsafeCSS(STATUS_STYLES)}
    ${BLOCK_STYLES}
`;
