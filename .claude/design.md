# Design — Gullak (daily budget app, India)

## Settings
- Design system: none yet. Provisional look chosen for the first mockups (not yet run through the from-scratch phases: references, three directions, type, palette).
- Mockups so far: Claude Design canvas https://claude.ai/artifact/DPy3p9xKLzdgypzHbTXx8y (no Figma file yet).
- Platforms: Android, iOS, web (Expo). Phone frame 390×844.
- Spacing: 8 scale (4 as half-step; 12 allowed inside compact rows). Touch target minimum: 44px.
- Radii: 8 / 12 / 16, 24 for swipe cards; pills and circles use half their height.
- Type: Bricolage Grotesque 600/700 for headings and amounts, DM Sans 400/500/700 for UI. Sizes 12 / 14 / 16 / 20 / 22–24 (amounts) / 28 / 44 / 72 (hero amounts: quick-add, report card).
- Colors:
  - ground #FBF6EF, surface #FFFFFF, ink #2A1F1A, muted #6E5E54
  - line (non-interactive card borders) #EADFD3; control border (inputs, buttons, chips; ≥3:1) #9C8A7A
  - accent terracotta #B94A22: the primary action only, one per screen; never data or text links
  - accent tint #F6E3D7 with deep accent #8E3515 for category icon chips; sand #EFE5D9 for info panels
  - good #2F7D4F (on ground/white), good-deep #1F5E38 on good tint #E4F1E8
  - warn ink #7A4A00 on #FBEFD9; bad #B3261E on #FBE4E2
  - XP / savings gold #E0A02F (bars on dark only); streak-freeze ice #E6F0F7 with #24506E
  - dark surfaces (report card, quest header): #2A1F1A, raised #3D2E26, text #FBF6EF / #D9C9B8, control border and pending segments #8C7A6E, XP track #4A3A31 (fill and text carry the value)
  - reward: badges and XP pills reuse gold tint #FBEFD9 with #7A4A00; streak flame #C77700
  - swipe-card stack layers #F6EDE3 and #EFE5D9 (decorative)
- Dates: 2026 calendar (Fri, 23 Oct 2026 is "today" in the mockups).
- Links: ink, underlined. Selected chip/radio: 2px ink border.
- Data colour: single-series bars in muted #6E5E54.
- Copy: sentence case; no full stop on single sentences; amounts always with ₹ and Indian grouping (₹1,00,000); dates as "Thu, 23 Oct".
- Locale: en-IN.

## Signature traits
- The Gullak (clay piggy bank) is the hero of Home; its mood follows today's budget used (happy / calm / nervous / fainted / celebrating). It never dies.
- Growth stages: clay → painted → gold → diamond.
- Centre + button in the tab bar for quick-add.
- Night report card is a dark, story-style sequence.
- Swipe gestures always have tap buttons (Want / Regret / Need).

## In progress
- Home layout chosen by the user: option A (Gullak hero), 2026-10-23.
- Visual direction, type and palette are provisional until the user confirms them.
