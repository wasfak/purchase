// xlsx-js-style is a styling-capable fork of SheetJS with the same API surface,
// so we borrow xlsx's type definitions. Cell style objects are attached via a
// `.s` property, which we type loosely at the call site.
declare module "xlsx-js-style" {
  export * from "xlsx";
}
