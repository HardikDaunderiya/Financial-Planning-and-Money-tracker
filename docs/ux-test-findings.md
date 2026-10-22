# Gullak V1 prototype: browser test findings (23 Oct 2026)

Tested by clicking through the canvas prototype in Chrome (Play mode), against the plan in the session scratchpad (main flows B1–B8, edge flows C1–C16, consistency checks D1–D3).

## Fixed in the prototype during testing
- Setup 3: Continue stayed active on "Not possible" (₹0 a day). Now disabled with "Lower your savings to continue".
- Quick-add opened pre-filled with ₹250 and "Third Wave Coffee". Now starts at ₹0 with an empty merchant field.
- Quick-add category chips wrapped onto two lines. Now one horizontally scrolling row.
- Quick-add button read "Add ₹ 250" (stray space). Fixed.
- Quick-add: the new chip row scrolled the whole screen sideways. Fixed (fieldset min-width, clipped root).
- Swipe-sort hint labels collided ("Up for regretSwipe for need"). Shortened to Want / Regret / Need.
- Insights: after "Still using?" the buttons had no context ("Yes"). Now "Using it" / "Cancelled".
- Gullak "nervous" face looked angry (brows sloped down to the middle). Brows now slope up (worried).
- New goal opened pre-filled with "Bike down payment". Now empty; Start says "Name your goal to start" until named.
- New goal accepted a month that has passed ("1 payday: 1 Nov 2026" for an October deadline). Now blocked with "That month has passed".
- Over-budget catch-up card kept saying "₹1,800 behind… Pick a way" after a plan was picked. Now "Goa trip: catching up".
- Night report card 4 used the Indian mom voice while the user picked Chill friend. Now Chill.
- Badges "Goal crusher" showed Goa (34%) instead of the furthest goal (Emergency fund 40%).
- "Unsupported bank: Yes Bank" left "Bank" orphaned on line two. Now "Yes Bank not supported".

## Passed
Onboarding end to end; payday options and custom day picker; fixed costs add/remove/scroll and "Add another" hiding; savings stepper verdicts (Doable / Tight / Not possible) and maths; personality previews; first-run Home; quick-add ₹0 guard, 7-digit cap, "00" at zero, discard dialog (Keep editing, auto-close at ₹0, plain close at ₹0); tab bar; Insights totals; subscription answers; 14-card sort with correct counts and plurals; report card Next/Back/Skip/Share/Done; catch-up options with result and Undo, tomorrow's budget ₹577 → ₹352; New goal verdicts and month maths; Me download status and delete confirmation; Badges back; PDF password show/hide; bank-not-supported request.

## Gaps to design for the real app (go into the spec)
1. ~~Edit or delete a logged spend~~ Drawn and tested: Spend detail (Home rows open it; amount, category, merchant, payment, need/want/regret; Save disabled at ₹0; delete asks first and says what changes).
2. ~~Upload start~~ Drawn and tested: "Add a statement" picker with supported banks, last upload and the duplicate-statement note. Every upload entry point now starts here.
3. ~~Wrong PDF password~~ Drawn: error in place with what to try next, Try again and Choose another file.
4. CSV column mapping screen (promised on the bank-not-supported screen).
5. Fixed costs: edit amounts, add a custom cost (a deleted "Rent" can't come back), and undo a removal; show that the list scrolls.
6. Type amounts directly in steppers (savings, goal target), not only ±₹1,000 / ±₹5,000.
7. Category drill-down on Insights (which 23 quick-commerce orders?).
8. Goal detail: edit, pause, delete, add money by hand; the catch-up plan should open from the goal, not on the Home screen.
9. Undo the last swipe-sort tag.
10. Sanity check for very large quick-add amounts versus the daily budget.
11. Notification permission prompt (explain first, then the OS dialog) in onboarding.
12. Me: sign out, help/contact, privacy policy, per-notification switches.
13. Account deletion grace period (for example 30 days, cancellable).
14. A nudge when monthly savings is set to ₹0.
15. Explain how the daily grade (A+ to F) is worked out.
16. Prototype-only limits: screens don't share state (values typed in onboarding don't carry to later screens), and timed screens start when the canvas loads.
