# Engineering Mode Framework

## Purpose

Engineering Mode is an optional application context for future advanced engineering, protocol-analysis and local-research features.

It is disabled by default. Introducing the framework does not change existing parser output, viewer content, database storage, device commands or workflow behaviour.

## User flow

Engineering Mode is controlled from **Settings → Engineering Mode**.

Enabling it requires:

1. The user explicitly selects **Enable Engineering Mode**.
2. Electron displays the current informational acknowledgement.
3. The user selects **I understand — enable**.

Cancelling the acknowledgement leaves Standard Mode active. Disabling Engineering Mode takes effect immediately and does not require confirmation.

The acknowledgement version and timestamp are stored locally with the setting. Every new enable action still requires the acknowledgement in the current Settings interaction.

## Renderer API

The framework is exposed as:

```js
window.EngineeringMode
```

The main integration points are:

```js
window.EngineeringMode.isEnabled();
window.EngineeringMode.isEnabledFor("component-id");
window.EngineeringMode.getState();
window.EngineeringMode.getContext("component-id", {kind: "parser"});
window.EngineeringMode.subscribe(state => {
  // Refresh a participating component when the mode changes.
});
window.EngineeringMode.whenEnabled("component-id", context => {
  // A future, explicitly designed Engineering Mode branch.
});
```

`getContext()` provides a stable component identifier together with the versioned mode state. `whenEnabled()` does nothing while Standard Mode is active.

Example integration skeleton:

```js
function buildViewModel(source) {
  const engineering = window.EngineeringMode?.getContext(
    "example-viewer",
    {kind: "viewer"}
  ) || {enabled: false, mode: "standard"};

  const model = buildStandardModel(source);

  if (engineering.enabled) {
    // Reserved for a separately reviewed future enhancement.
  }

  return model;
}
```

The fallback must always be Standard Mode so a component keeps its existing behaviour if the framework is unavailable.

## State and synchronization

The renderer state is stored as versioned JSON in local storage:

```text
electron.engineeringMode.state.v1
```

The API synchronizes participating windows through:

- the browser `storage` event;
- Electron's existing `app:settings-updated` notification;
- the DOM event `electron:engineering-mode-changed`;
- direct `subscribe()` callbacks within the current renderer.

The root HTML element also exposes a non-visual state hook:

```html
<html data-engineering-mode="disabled">
```

or:

```html
<html data-engineering-mode="enabled">
```

No visual change is attached to this attribute in the initial framework.

## Architecture boundary

Engineering Mode is a context signal, not a blanket instruction for every component to expose or retain more information.

Each future integration must define:

- which locally available values it uses;
- how those values are represented;
- whether anything is stored;
- how the component returns to its Standard Mode output;
- focused tests for both enabled and disabled states.

Renderer code can use `window.EngineeringMode` directly. If a future feature requires main-process behaviour, it should receive an explicit, purpose-specific IPC contract instead of treating renderer local storage as a main-process setting or authority.

## Current integration status

The framework is loaded before parsers, models, viewers and protocol modules in the main renderer. It is also loaded in the Settings window.

Current components can therefore query or subscribe to the shared context, but none of them uses it to change data handling yet. Standard Mode remains the application's current behaviour.

## Test coverage

`tests/engineering-mode.test.js` verifies:

- default-off behaviour;
- rejection of enable requests without acknowledgement;
- successful acknowledged enable and immediate disable;
- component contexts and `whenEnabled()` behaviour;
- local persistence;
- Settings-window and storage-event synchronization;
- change subscriptions and DOM state updates.
