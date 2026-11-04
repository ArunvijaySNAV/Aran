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
