# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zymphotography/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zymphotography/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: ranks pre-token protocols by implied value from a sealed DefiLlama snapshot (758 protocols, 40 on the watchlist), with concrete farm plans for each and an offline dashboard. The value model derives implied value from each protocol's own figures — TVL, 7-day growth, time running with no token, and chain breadth — never from a hardcoded list of names. The board covers all 40 watchlist protocols plus 158 early ones found below the floor.

## Run it

```sh
node --experimental-strip-types main.ts --input input/snapshot.json --output output
```

The program reads the sealed snapshot, writes the ranked board to `output/board.json`, the dashboard data beside the page, copies `dashboard/` and `screenshots/` to `output/`, and writes `output/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=fptfxdyj&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
