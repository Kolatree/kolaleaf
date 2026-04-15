// Design tokens extracted verbatim from the approved sketch at
// ~/.gstack/projects/Kolaleaf/designs/send-screen-20260414/approved-wireframe.html
// (also mirrored at file:///tmp/gstack-kolaleaf-sketch.html)
//
// Do NOT introduce new values. Every variant renders using only these tokens.

export const colors = {
  purple:       '#2d1b69',  // brand primary, hero gradient start, CTA start, highlight total
  green:        '#1a6b3c',  // brand secondary, hero gradient end, CTA end, receive amount, green values
  greenLight:   '#7dd87d',  // "leaf" in logo, dark-mode green accents
  gold:         '#ffd700',  // AUSTRAC lock, Minutes lightning (trust bar icons)
  bgSoft:       '#f0faf0',  // Best Rate pill background
  ink:          '#1a1a2e',  // main text, amount-input, value.default
  muted:        '#888',     // field-label, rate-bar label, row label, nav default, trust sub
  border:       '#eee',     // divider, card divider, trust-bar border, bottom-nav border
  chipBg:       '#f0f0f0',  // currency-badge background
  cardBg:       '#ffffff',  // card background
  pageBg:       '#f5f5f5',  // body background
  notch:        '#1a1a2e',  // phone notch (mobile preview only)
} as const;

// Exact sketch gradient — use as inline style, not Tailwind `bg-gradient-*`.
export const gradient = `linear-gradient(135deg, ${colors.purple} 0%, ${colors.green} 100%)`;

export const radius = {
  card:      '16px',   // .transfer-card
  chip:      '20px',   // .currency-badge (rounded rectangle, NOT pill)
  rateBar:   '8px',    // .rate-bar
  cta:       '12px',   // .cta
  hero:      '24px',   // Variant D gradient frame around the transfer card (desktop)
  flag:      '2px',    // .flag
} as const;

export const type = {
  logo:         { size: '22px', weight: 700,  letterSpacing: '-0.5px' },
  tagline:      { size: '13px', weight: 400,  opacity: 0.8 },
  fieldLabel:   { size: '11px', weight: 400,  letterSpacing: '0.5px', transform: 'uppercase' },
  amount:       { size: '36px', weight: 700,  color: colors.ink },
  currencyCode: { size: '13px', weight: 600 },
  rateBar:      { size: '13px', weight: 600 },
  rowLabel:     { size: '14px', weight: 400 },
  rowValue:     { size: '14px', weight: 600 },
  rowTotal:     { size: '14px', weight: 700 },
  cta:          { size: '16px', weight: 700,  letterSpacing: '0.3px' },
  trustLabel:   { size: '11px', weight: 600 },
  trustSub:     { size: '11px', weight: 400 },
  trustIcon:    { size: '18px' },
  navLabel:     { size: '10px', weight: 400 },
  navIcon:      { size: '20px' },
  heroHeadline: { size: '32px', weight: 700, letterSpacing: '-0.5px', lineHeight: 1.15 },
} as const;

export const spacing = {
  cardPad:        '24px',
  rateBarPad:     '10px 14px',
  chipPad:        '6px 12px',
  rowGap:         '14px',
  ctaPad:         '16px',
  trustBarPad:    '10px 24px',
  bottomNavPad:   '12px 0 28px',
} as const;

export const shadow = {
  card:   '0 4px 20px rgba(0,0,0,0.08)',
  lifted: '0 24px 60px rgba(0,0,0,0.25)',  // for desktop hero card (not in mobile sketch, but compliant)
} as const;

export const flag = {
  au: 'linear-gradient(#00008b 40%, #fff 40% 43%, #c8102e 43%)',
  ng: 'linear-gradient(90deg, #008751 33%, #fff 33% 66%, #008751 66%)',
  size: { width: '20px', height: '14px' },
} as const;
