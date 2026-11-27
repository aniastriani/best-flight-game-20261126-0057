# Ridge Runner — Flight over the Merapi Valley

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/aniastriani/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/aniastriani/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

Fly the Cendrawasih bush plane through ten glowing rings over the Merapi
valley — past the volcano, down the river, over the rice terraces — then
bring her home to the airstrip. A complete flight game in plain static
files: a pseudo-3D valley, a chase view with a lit instrument panel
(altimeter, airspeed, attitude, compass, throttle, stall and gear lamps),
a HUD with altitude, speed, heading, rings and time, engine and wind sound
synthesised in WebAudio, and a real flight model with throttle, pitch,
bank-to-turn, stall and terrain collision.

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

Arrows or WASD pitch and bank, Shift / Ctrl work the throttle, the mouse
steers while held down, R restarts, P pauses, M mutes. Take off from the
strip, thread all ten rings, land on the strip to finish. The four
screenshots under `screenshots/` are real renders of the game's own code
(`game/index.html?shot=start|play|ring|end&seed=1`).

## Run it

```sh
node main.ts
```

`main.ts` (Node 22, standard library only) copies `game/` and
`screenshots/` into `$MAKEFUN_OUTPUT_DIR` (or `/output`) and writes
`dossier.json`, the summary the judge reads. Two runs on the same tree
produce the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=nr75efcw&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
