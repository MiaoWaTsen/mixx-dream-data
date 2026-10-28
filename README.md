# mixx-dream-data

Public NMIXX comeback schedule read by the MIXX-DREAM fan game.

`comebacks.json` lists each comeback with ISO dates (KST):

| Field | Meaning |
| --- | --- |
| `teaserStart` | First teaser / schedule reveal (`null` if unknown) |
| `release` | Album and music video release day |
| `promoEnd` | Last day of the in-game event (end of music show promotions) |
| `promoEndEstimated` | `true` when `promoEnd` is a guess (release + 3 weeks) |

The game fetches the raw file when online and falls back to a bundled copy offline.
Bump `updated` whenever the file changes.

## realdata.json (automatic)

NMIXX's real tour dates (`tours`) and music show wins (`wins`), scraped from Wikipedia by `scrape.mjs`
twice a day (GitHub Actions → `realdata`). The game turns a concert day into a special 世界巡演 show and
celebrates each win. If Wikipedia is wrong or late, edit `realdata-overrides.json` and run the workflow.
