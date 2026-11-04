# Design test changes

Rule: a test selector may change only if the markup changed and the same user-visible behaviour is still asserted. No assertion is ever deleted or weakened.

## Edited selectors
None yet.

## Detector exceptions
None yet. `DESIGN.md` wins over any detector rule that contradicts it (guilloche texture, blue/red meaning colours); each such exception is recorded here with the rule id and reason.

### Detector exceptions: landing (Screen 1)
- `wide-tracking` (0.22em): the microprint line is specified by DESIGN.md section 5, 7px, decorative, `aria-hidden`.
- `low-contrast` 3.9:1 on the microprint text: same element, decorative and `aria-hidden`, exempt from text contrast; it never sits under body text.
- `repeating-stripes-gradient`: the dashed boundary line between the bank and Night panels is the specified "visible line" of principle 2.
- `bounce-easing` `cubic-bezier(.2,1.3,.4,1)`: the seal "slams in with overshoot" (DESIGN.md section 8.3).
- `cramped-padding` on `.table-wrap`: false positive; table cells carry 10px/14px padding, the wrapper only supplies the border.
- Landing audit notes: `prefers-reduced-motion` uses one blanket `.001ms` rule plus explicit end states (`.seal` shown, guilloche rotation off, flight chips not created, flip jumps to the final token). DESIGN.md section 10 asks for exactly this ("every moment jumps to its final state"), so the blanket rule is kept on purpose.

### Detector exceptions: signup (Screen 2)
- `.seal` slam easing `cubic-bezier(.2, 1.3, .4, 1)` in `signup.css` (overshoot specified in DESIGN.md section 8.3, applied to the key slip seal). The detector returned no findings on `signup.html` itself.
- Added token `--rule-strong` (#76847F light, #6C8099 Night) for input and control outlines: measured 3.72:1 on bond and 3.32:1 on stock (light), 3.78:1 on night-2 (Night), because the specified `--rule` border measured 1.5:1 and DESIGN.md section 3.2 asks for outlines of 3:1 or more. Night attention text uses #F2C46B (9.4:1 on night-2) because the light-theme attention brown measured 2.05:1 there.
- Signup `all-caps-body`: the key-slip microprint line (`.slip-sign`, 9px Martian Mono, `aria-hidden`) is decorative security-print microtext (DESIGN.md section 5); all caps is the convention there and it carries no information.

### Detector exceptions: connect (Screen 3)
- `repeating-stripes-gradient` on the dashed seal line between the Sent and Stored panels (`.flight-out .demo::before`): the visible boundary of principle 2, same as the landing.
- Copy change for honesty: the integration step is now "Add the call" (connect) and "Three steps, one call" (landing), because the shipped sample is about eight lines, not five.
