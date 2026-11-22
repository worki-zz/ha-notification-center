// A page of the General settings on its own, with Home Assistant's subpage
// header and what it does at the top: Home modes, People, Light, Sound, Chimes.

import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import { type NotificationCenterConfig, type StateMessage } from "../shared/config";
import { navigate } from "../shared/live";
import type { HomeAssistant } from "../shared/types";
import "./settings-modes";
import "./settings-lights";
import "./settings-people";
import "./settings-sound";

const PAGES: Record<string, { title: string; intro: string[] }> = {
  modes: {
    title: "Home modes",
    intro: [
      "The active home mode decides on which channels a notification shows.",
    ],
  },
  people: {
    title: "People",
    intro: [],
  },
  light: {
    title: "Light",
    intro: [
      "A light shows the color of the first active notification, and goes back to how it was when no notification is active.",
    ],
  },
  sound: {
    title: "Sound",
    intro: [
      "The speakers and sirens of the Sound channels. A speaker plays the chime of a notification once when it starts to send, can read the message, and can repeat. A siren (such as a smoke alarm's) sounds while the notification sends. Silence action stops them.",
    ],
  },
  chimes: {
    title: "Chimes",
    intro: [],
  },
};

@customElement("nc-general-page")
export class NcGeneralPage extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public config?: NotificationCenterConfig;

  @property({ attribute: false }) public state?: StateMessage;

  @property() public page = "";

  @property() public base = "/notification-center";

  protected override render() {
    const page = PAGES[this.page];
    return html`<hass-subpage
      .hass=${this.hass}
      .narrow=${this.narrow}
      .header=${page?.title ?? "General"}
      .backCallback=${() => navigate(`${this.base}/settings/general${this.page === "chimes" ? "/sound" : ""}`)}
    >
      <div class="content">
        ${page
          ? page.intro.map((text) => html`<p class="intro">${text}</p>`)
          : nothing}
        ${this.page === "modes"
          ? html`<nc-settings-modes
              .hass=${this.hass}
              .config=${this.config}
              .state=${this.state}
            ></nc-settings-modes>`
          : this.page === "people"
            ? html`<nc-settings-people
                .hass=${this.hass}
                .config=${this.config}
                .state=${this.state}
              ></nc-settings-people>`
            : this.page === "light"
              ? html`<nc-settings-lights .hass=${this.hass} .config=${this.config}></nc-settings-lights>`
              : this.page === "sound"
                ? html`<nc-settings-sound .hass=${this.hass} .config=${this.config} .base=${this.base}></nc-settings-sound>`
                : this.page === "chimes"
                  ? html`<nc-settings-sound
                      view="chimes"
                      .hass=${this.hass}
                      .config=${this.config}
                      .base=${this.base}
                    ></nc-settings-sound>`
                  : nothing}
      </div>
    </hass-subpage>`;
  }

  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .content {
      max-width: 1040px;
      margin: 0 auto;
      /* 24px under the header, as on the Overview. */
      padding: 24px 16px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-sizing: border-box;
    }
    .intro {
      margin: 0;
      color: var(--secondary-text-color);
    }
    ha-card {
      overflow: hidden;
    }
    .card-content p {
      margin-top: 0;
    }
    .card-actions {
      display: flex;
      justify-content: flex-end;
      padding: 8px;
      border-top: 1px solid var(--divider-color);
    }
    .buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "nc-general-page": NcGeneralPage;
  }
}
