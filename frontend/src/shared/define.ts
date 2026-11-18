// Defines a custom element once Home Assistant's own elements are there.
//
// The card is loaded before the Home Assistant app. The app then puts its
// own custom element registry in place (a scoped registry polyfill), which
// does not see elements defined before it. So the definition waits for the
// app's root element, and then goes into the registry the dashboard uses.

export function defineElement(name: string, element: CustomElementConstructor): void {
  const define = () => {
    if (!customElements.get(name)) {
      customElements.define(name, element);
    }
  };
  if (customElements.get("home-assistant")) {
    define();
  } else {
    void customElements.whenDefined("home-assistant").then(define);
  }
}
