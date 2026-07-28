/**
 * Icons from the prototype — CSS shapes rather than an icon font or SVG set,
 * exactly as specified in design/prototype.html. Original shapes, not tied to
 * any particular game.
 */

export const FlameIcon = () => <span className="icon icon-flame" aria-hidden="true" />;

export const SkullIcon = () => (
  <span className="icon icon-skull" aria-hidden="true">
    <span className="eye l" />
    <span className="eye r" />
  </span>
);

export const SwordsIcon = () => (
  <span className="icon icon-swords" aria-hidden="true">
    <span className="blade a" />
    <span className="blade b" />
  </span>
);

export const CrownIcon = () => <span className="icon icon-crown" aria-hidden="true" />;

export const BarsIcon = () => (
  <span className="icon icon-bars" aria-hidden="true">
    <span />
    <span />
    <span />
  </span>
);
