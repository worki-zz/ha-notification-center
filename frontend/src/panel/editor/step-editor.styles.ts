// The styles of the step editor.

import { css } from "lit";
import { BLOCK_STYLES } from "./block";

export const STEP_EDITOR_STYLES = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    /* More room before Activation and after Done. */
    .group-gap {
      height: 0;
    }
    .block {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    ha-button-toggle-group {
      align-self: flex-start;
    }
    .row.data {
      align-items: flex-start;
    }
    .row > .data-type {
      flex: 0 1 220px;
    }
    /* On a phone each Data field takes the whole width. */
    @media (max-width: 600px) {
      .row.data > *,
      .row.data > .data-type {
        flex: 1 1 100%;
      }
    }
    .param {
      font-family: var(--ha-font-family-code, monospace);
      font-size: var(--ha-font-size-s, 12px);
      color: var(--primary-color);
      background-color: rgb(from var(--primary-color) r g b / 0.1);
      border: none;
      border-radius: 4px;
      padding: 3px 6px;
      cursor: pointer;
    }
    .param:hover {
      background-color: rgb(from var(--primary-color) r g b / 0.2);
    }
    .row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .row > * {
      flex: 1 1 200px;
      min-width: 0;
    }
    /* Close to the message they go in, more room before Info. */
    .chips {
      margin: -6px 0 6px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .chips-label {
      color: var(--secondary-text-color);
      margin-inline-end: 4px;
    }
    .title {
      min-height: 32px;
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 4px 0 -4px;
      font-weight: var(--ha-font-weight-medium, 500);
    }
    .title ha-icon-button {
      --ha-icon-button-size: 32px;
      --mdc-icon-size: 18px;
      color: var(--secondary-text-color);
    }
    /* Full width across the panel's padding. */
    .divider {
      height: 1px;
      background-color: var(--divider-color);
      margin: 4px -16px 0;
    }
    /* Like a trigger row of Home Assistant's list. */
    ha-card.pinned-card {
      overflow: hidden;
    }
    ha-expansion-panel.pinned {
      display: block;
      --expansion-panel-summary-padding: 0 8px 0 16px;
      /* The panel pads its content even while closed, so the form does. */
      --expansion-panel-content-padding: 0;
    }
    ha-expansion-panel.pinned .pinned-content {
      padding: 16px;
    }
    ha-expansion-panel.pinned > ha-icon[slot="leading-icon"] {
      margin-inline-end: 16px;
    }
    .pinned-state {
      color: var(--secondary-text-color);
      font-weight: normal;
    }
    /* Not bold, as the other built-in rows (When the activation is no longer true). */
    .pinned-title {
      flex: 1;
      font-weight: var(--ha-font-weight-normal, 400);
    }
    /* The built-in rows, which are not Home Assistant's triggers. */
    ha-icon.builtin {
      color: var(--amber-color, #ffc107);
    }
    /* Side by side where there is room. */
    .show-switches {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 8px;
    }
    ha-card.interactions {
      overflow: hidden;
    }
    .interaction {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
      cursor: pointer;
    }
    .interaction + .interaction {
      border-top: 1px solid var(--divider-color);
    }
    .interaction:hover,
    .interaction:focus-visible {
      background-color: var(--secondary-background-color);
      outline: none;
    }
    .interaction.off .own-text,
    .interaction.off ha-icon {
      opacity: 0.6;
    }
    .interaction ha-icon {
      flex: none;
    }
    .own-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
    }
    .own-row ha-icon {
      flex: none;
    }
    .own-row + .own-row {
      border-top: 1px solid var(--divider-color);
    }
    /* As Home Assistant draws a person: the picture, or the initials. */
    .avatar {
      flex: none;
      width: 40px;
      height: 40px;
      border-radius: var(--ha-border-radius-circle, 50%);
      object-fit: cover;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background-color: var(--light-primary-color);
      color: var(--text-light-primary-color, var(--primary-text-color));
      font-size: var(--ha-font-size-m, 14px);
      overflow: hidden;
    }
    .own-text {
      flex: 1;
      min-width: 0;
    }
    .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
    }
    ${BLOCK_STYLES}
`;
