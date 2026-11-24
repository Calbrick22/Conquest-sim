# CLAUDE.md: Conquest TLAoK simulator

This is a personal tabletop simulator for Conquest TLAoK (2026 rules, post-Adepticon). The repository is **public**.

## Every session, before anything else

1. **Check `.gitignore` contains `reference/`.** If it doesn't, add it and commit that change before doing anything else.
2. **Make sure `reference/` holds the source material**, which is never committed:
   - `Conquest_TLAoK-CORE-RULES-2026-POST-ADEPTICON.pdf`
   - `TLAOK-TOURNAMENT-SCENARIO-PACK-READY-FOR-CHIOS-2025.pdf`
   - every faction PDF
   - the `spires NN.pdf` army lists, and any text-format lists

   The workspace is wiped between sessions, so this folder is normally missing. That is expected, not an error. To restore it:
   - If a Projects tool is available (`project_read` with `original: true`), download the files from the Claude Project "Conquest".
   - Otherwise ask the owner to attach the files in the chat. Uploads land under `/root/.claude/uploads/<session>/` with a random prefix. Copy them into `reference/` under the names above, for example `cp …/*-spires_21.pdf "reference/spires 21.pdf"`.
   - Text extracts and rendered images used while working go in `reference/text/` and `reference/img/`, which are also ignored.
3. **Before every commit**, run `git status` and confirm nothing under `reference/` is staged.

## Copyright rules (non-negotiable)

- Never commit the PDFs, text extracted from them, army lists, or snapshots of parsed real lists.
- Never paste rule text into source, docs or test fixtures. Implement mechanics in code, describe them in your own words, and cite pages (`core p.N`, `pack p.N`; the PDF page index equals the printed page).
- Unit stats and special-rule text reach the app only when the user uploads a list at runtime.
- CI fixtures are **synthetic**: invented names, stats and text, in the export layout.
- Owner's note (2026-11-24): Para Bellum's rules are public, so faction **mechanics as data** (unit names, built-in Strain effects, values) may live in the code, e.g. `src/engine/factions/spires.ts`. Keep the PDFs themselves and verbatim rule text out of the repo.

## Never make up rules

- If the PDFs don't settle something, log it in `docs/ambiguities.md` with the page reference, pick the most literal reading, mark it in code with `// RULE-AMBIGUITY: AMB-NN`, and carry on.
- Every implemented rule has a page reference in a code comment and in `docs/rules-digest.md`.
- Test names include the page, for example `seizing: monster stands count as 3 (core p.106)`.

## Architecture rules (summary; detail in PLAN.md)

- `src/engine/` is pure, deterministic TypeScript with no React and no DOM.
  - `validate(state, action) -> ok | reasons[]`
  - `apply(state, action, rng) -> { state, events[] }`
- State is immutable, and every dice roll is logged with its seed and index.
- Distances are inches (floats). Base sizes in mm live only in `src/engine/geometry/bases.ts`, converted at 25.4 mm per inch. Geometry tests use a 0.01″ tolerance.
- Special rules live in a registry, `src/engine/rules/special/`. An unknown rule is shown with its list text and flagged **manual**. It never crashes the app and is never silently ignored.
- Humans and the AI are both `PlayerController`s using the same validate and apply path. The AI ignores manual rules for its own units and logs that it did.
- Manual override tools are a core feature, and every use is logged as an override.

## Working conventions

- Use conventional commits, keep `CHANGELOG.md` up to date, and run the full test suite before every commit.
- Don't start the next milestone while tests are failing.
