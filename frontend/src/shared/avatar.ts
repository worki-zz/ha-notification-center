// The picture or the initials of a person, as Home Assistant shows them.

import { html } from "lit";

export interface AvatarPerson {
  id: string;
  name: string;
  picture?: string;
}

/** As Home Assistant draws a person: the picture, or the initials. */
export function avatar(person: AvatarPerson) {
  if (customElements.get("ha-person-badge")) {
    return html`<ha-person-badge
      class="avatar"
      .person=${{ id: person.id, name: person.name, picture: person.picture }}
    ></ha-person-badge>`;
  }
  if (person.picture)
    return html`<img class="avatar" src=${person.picture} alt="" />`;
  const initials = person.name
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
  return html`<span class="avatar">${initials}</span>`;
}
