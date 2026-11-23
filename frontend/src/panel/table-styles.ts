// The styles of the audience and channel tables.

import { css } from "lit";

export const TABLE_STYLES = css`
  :host {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  ha-card {
    overflow: hidden;
  }
  .table {
    display: grid;
    align-items: center;
  }
  .table > .row {
    display: contents;
  }
  .cell {
    display: flex;
    align-items: center;
    min-height: 56px;
    box-sizing: border-box;
    border-top: 1px solid var(--divider-color);
  }
  .head .cell {
    min-height: 40px;
    border-top: none;
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
    font-weight: var(--ha-font-weight-medium, 500);
  }
  .cell.name {
    gap: 16px;
    padding-left: 16px;
    min-width: 0;
  }
  .cell.tick {
    justify-content: center;
    padding: 0 4px;
    text-align: center;
  }
  .cell.end {
    justify-content: flex-end;
    padding-right: 4px;
  }
  .name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name ha-icon,
  .channel-icon {
    flex: none;
    color: var(--secondary-text-color);
  }
  .secondary {
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
  }
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
  .reset {
    color: var(--secondary-text-color);
  }
  /* Live marks: the home mode now, the ticks valid now, a delay that
     applies now and the people who get the notification now. */
  .now {
    display: inline-flex;
    align-items: center;
  }
  .now-dot {
    --mdc-icon-size: 16px;
    color: var(--ha-color-fill-success-loud-resting, var(--success-color, #4caf50));
  }
  .head .now-dot {
    margin-inline-start: -4px;
  }
  .name-text .now-dot {
    vertical-align: middle;
    margin-inline-start: 2px;
  }
  ha-checkbox.now {
    --ha-checkbox-border-color: var(
      --ha-color-fill-success-loud-resting,
      var(--success-color, #4caf50)
    );
    --ha-checkbox-checked-background-color: var(
      --ha-color-fill-success-loud-resting,
      var(--success-color, #4caf50)
    );
    --ha-checkbox-checked-background-color-hover: var(
      --ha-color-fill-success-loud-hover,
      var(--success-color, #4caf50)
    );
  }
  .avatar-wrap {
    position: relative;
    display: inline-flex;
    flex: none;
  }
  /* As the badge of Home Assistant's tile card. */
  .live-badge {
    position: absolute;
    right: -3px;
    bottom: -3px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    --mdc-icon-size: 12px;
    color: var(--white-color, #fff);
    background-color: var(--ha-color-fill-success-loud-resting, var(--success-color, #4caf50));
  }
  .name .live-badge ha-icon,
  .list-row .live-badge ha-icon {
    color: var(--white-color, #fff);
  }
  .live-badge.waits,
  .live-badge.no {
    background-color: var(--ha-color-fill-warning-loud-resting, var(--warning-color, #ff9800));
  }
  .channel-icon + .live-badge {
    right: -6px;
    bottom: -6px;
  }
  .hint {
    margin: 0;
    color: var(--secondary-text-color);
  }
`;

export const CHANNEL_PAGE_STYLES = css`
      .list-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 8px 16px;
        min-height: 56px;
        box-sizing: border-box;
        cursor: pointer;
      }
      .list-row + .list-row {
        border-top: 1px solid var(--divider-color);
      }
      .list .list-row:hover,
      .list .list-row:focus-visible {
        background-color: var(--secondary-background-color);
        outline: none;
      }
      .list-row > ha-icon {
        flex: none;
        color: var(--secondary-text-color);
      }
      .list-row .name-text {
        flex: 1;
      }
      .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 40px;
        margin-top: 8px;
        font-weight: var(--ha-font-weight-medium, 500);
      }
      .section-head:first-child {
        margin-top: 0;
      }
      ha-dialog .hint {
        margin: 0 0 12px;
      }
      .fields {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }
      .checks {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 24px;
      }
      .checks-block {
        margin-top: -8px;
      }
      .checks-label {
        color: var(--secondary-text-color);
        font-size: var(--ha-font-size-s, 12px);
        margin-bottom: 4px;
      }
      .separator {
        border-top: 1px solid var(--divider-color);
        /* Full width, as in the button dialog. */
        margin: 16px -24px 0;
      }
      .columns {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        align-items: flex-start;
      }
      .column {
        flex: 1 1 220px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .clearable {
        position: relative;
      }
      .clearable .clear {
        position: absolute;
        top: 4px;
        inset-inline-end: 40px;
        color: var(--secondary-text-color);
      }
      .check {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
      }
`;
