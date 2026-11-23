// The styles of the Entities block of the notification editor.

import { css } from "lit";

export const ENTITIES_BLOCK_STYLES = css`
    .block {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .list {
      overflow: hidden;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 4px 4px 16px;
      min-height: 56px;
      box-sizing: border-box;
      border-top: 1px solid var(--divider-color);
    }
    .item:first-child {
      border-top: none;
    }
    .item > ha-icon,
    .item > ha-state-icon {
      color: var(--state-icon-color, var(--secondary-text-color));
      flex: none;
      width: 24px;
    }
    .item.group {
      background-color: rgb(from var(--primary-text-color) r g b / 0.03);
      font-weight: var(--ha-font-weight-medium, 500);
    }
    .item.member {
      font-weight: normal;
    }
    .item.clickable {
      cursor: pointer;
    }
    .item.clickable:hover,
    .item.clickable:focus-visible {
      background-color: var(--secondary-background-color);
      outline: none;
    }
    .count {
      color: var(--secondary-text-color);
      padding: 0 8px;
    }
    .item-text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }
    .item-text > div {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item-text .secondary {
      font-weight: normal;
    }
    .secondary {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
    }
    .buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
      .dialog-slots {
      margin-top: 0;
    }
`;
