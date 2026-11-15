# Changelog

## 0.1.0

The data model and storage. Notifications are stored but do not show or sound yet: that comes with the engine in 0.2.

### Added

- The complete configuration schema: categories, notifications with steps, buttons, entities and entity groups, channel settings, modes, people, lights, speakers and chimes. Field names follow the labels of the user interface.
- Storage in `.storage/notification_center`, saved after every change and versioned, so later updates migrate it automatically.
- Default data of a new installation: the *Home* mode and a *General* category.
- Websocket API for reading, creating, changing, deleting, reordering, duplicating and switching off items, with live updates. Changes need an administrator.
- People are listed from the people of Home Assistant; only their push service, device type and sleep entity are stored.
- When an entity id is changed in the entity settings, the configuration follows it.
- YAML import and export. An import replaces the whole configuration after checking it; the previous one is kept as a backup.
- A temporary development page in the panel: the stored configuration in lists, and YAML import and export for administrators.

### What to try

1. Update from the Marketplace. The panel shows the *Home* mode and the *General* category.
2. Import a YAML (for example `tests/fixtures/example_config.yaml`): the 28 notifications and 8 categories appear.
3. Restart Home Assistant: everything is still there.
4. Export: the file holds what you imported.
5. Import a broken YAML (for example rename a field): the import stops with a message that names the field, and nothing changes.

## 0.0.1

The skeleton of the integration. It does not handle notifications yet.

### Added

- Setup from **Settings → Devices & services**, single instance, no questions.
- *Notification Center* sidebar panel (`mdi:message-bulleted`) with an empty page.
- `custom:notification-center-card` dashboard card showing *All clear*. It is loaded on every dashboard automatically.
- Removing the integration deletes its stored data.
- English and Hungarian translations for the setup dialog.

### What to try

1. Install it, restart, and add the integration.
2. Open *Notification Center* in the sidebar: an empty page with the version number.
3. Add the *Notification Center* card to a dashboard from the card picker: it shows *All clear*.
4. Remove the integration: the panel disappears from the sidebar and nothing is logged as an error.
