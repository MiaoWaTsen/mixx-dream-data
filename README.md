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
