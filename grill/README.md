# Sam's grill: what Claude reads

- `skills/grilling/SKILL.md` and `skills/grill-me/SKILL.md`: Matt Pocock's skills, copied **unchanged** from
  mattpocock-skills 1.2.3 (https://github.com/mattpocock/skills, MIT licence in `skills/LICENSE`). grill-me just says to
  use grilling, so grilling is what the bot follows. Never edit these; to update, copy the new versions over.
- `context/where-we-are.md` and `context/fomo-weekly-sales-review.md` (optional, only once Jamie OKs keeping copies of
  them in this repo): the FOMO Apps status file and the weekly sales review skill. Read when present, skipped when not.

The bot reads these from GitHub at every turn, so a change here works once merged, without a redeploy.
Specs the grill writes are saved in `../specs/`.
