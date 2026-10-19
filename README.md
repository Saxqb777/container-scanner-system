# Seal Register

Drop a container photo and its seal photo. The app reads both numbers, finds the container in the base Excel sheet, and writes the seal number into the seal column of that row. Anything that doesn't add up is stopped before it is written.

## How it works

1. **Upload the base sheet** (.xlsx). The app finds the heading row and the Container and Seal columns by name. If it can't, you pick them once.
2. **Drop photos**, one set or many. Put each container photo before its seal photo.
3. Claude reads each photo. The container number is checked against the ISO 6346 check digit.
4. Every set is checked against the sheet and shows **Ready**, **Already in sheet**, **Check numbers** or **Problem**.
5. **Write** shows a final list of row, container and seal. Only Ready sets are written.
6. **Download filled Excel** gives back your original file with the seal column filled in. Only the cells the app filled are changed. Pivot tables, dropdowns, formulas and formatting stay as they were, and Excel recalculates formulas when the file opens.

## What it blocks

| Check | Result |
| --- | --- |
| Number unreadable, or photo is neither a container nor a seal | Problem |
| Container check digit wrong (usually a misread) | Problem |
| Container not in the sheet | Problem |
| Container listed more than once in the sheet | Problem |
| Seal cell already has a different number | Problem, never overwritten |
| Seal number already on another container | Problem |
| Seal number already in another seal column, such as "Revised Seal" | Problem |
| Same container or seal twice in one batch | Problem |
| Photo read with low confidence | Check numbers (a person confirms) |
| Photos not in container then seal order | Check numbers, with a seal photo picker |
| Base sheet has the same seal on two rows | Upload refused |

The database enforces the last rules too: a seal is only written if the cell is still empty, and one seal can't sit on two containers.

Every write and undo is kept in the Activity log. The newest write on a container can be undone.

## Stack

- Next.js on Vercel
- Neon Postgres (sheet rows, seals, activity log, and the original .xlsx)
- Claude (`claude-opus-5-5`) reads the photos
- ExcelJS reads the sheet; the download edits only the seal cells inside the original file

## Setup

Environment variables (see `.env.example`):

| Name | What |
| --- | --- |
| `DATABASE_URL` | Neon connection string |
| `ANTHROPIC_API_KEY` | Claude API key |
| `APP_PASSWORD` | Shared login password |
| `SESSION_SECRET` | Random string, 32+ characters |
| `CLAUDE_MODEL` | Optional model override |

Create the tables once:

```sh
DATABASE_URL=... npm run db:setup
```

Run locally:

```sh
npm install
npm run dev
```

Tests:

```sh
npm test
```

## Notes

- Only .xlsx is supported. Old .xls files need Save As .xlsx first.
- Uploading a new base sheet switches to it. The old one stays in the database but is no longer used, so download it first if you need it.
- Photos are shrunk in the browser before upload and are not stored.
- Seals made only of digits (no leading zero) are written as numbers. Anything else is written as text.
- Other columns on the heading row with "seal" in the name (for example "Revised Seal") are never written to, but their seals count as used.
