/*
  React 19 gates act() behind a bare global binding (typeof
  IS_REACT_ACT_ENVIRONMENT !== "undefined"). Importing this module declares
  the bare global at script scope so the check inside react-dom passes.
  globalThis.X = ... only creates a property, which the bare typeof check in
  react-dom-client does not treat as a binding.
*/
(0, eval)("var IS_REACT_ACT_ENVIRONMENT = true");
