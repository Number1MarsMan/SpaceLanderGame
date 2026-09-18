# Spacecraft Landing

A browser-based lunar-lander game, built as a project to learn more about **vibecoding** and **prompt refinement** — exploring how far a game can be pushed through iterative, conversational development with an AI coding assistant, rather than hand-writing every line.

Play it live: https://number1marsman.github.io/SpaceLanderGame/

## About the project

This started as a simple three-level throttle-and-angle lander game and grew — level by level, prompt by prompt — into a fuller experience with crash physics, a scaling/responsive stage, and a full ship/thrust/map customizer. Each feature came from refining a prompt, seeing what came back, and asking for the next adjustment, which made it a good hands-on way to learn how to steer an AI collaborator toward a specific creative and technical result.

## How to play

Guide your lander down onto the green landing pad. Land too fast, too tilted, or off the pad, and you'll crash.

- **Level 1** — Throttle only, straight down.
- **Level 2** — Throttle + angle control, so you'll need to steer sideways onto the pad.
- **Level 3** — Adds a limited fuel supply and a randomized ship mass each run.

Before starting, you can also open **Customize Ship & Scene** from the main menu to pick a ship design, an engine thrust color, a map (each with its own gravity), and optional scene decorations like craters, planets, nebula clouds, shooting stars, and a drifting asteroid field.

## Controls

| Key | Action |
| --- | --- |
| `Space` | Engine on / off |
| `↑` | Increase throttle |
| `↓` | Decrease throttle |
| `←` | Rotate left (Level 2+) |
| `→` | Rotate right (Level 2+) |
| `R` | Restart the current level |
| `P` | Pause |

## Running it locally

No build step or dependencies — it's just HTML, CSS, and vanilla JavaScript. Open `index.html` directly in a browser, or serve the folder with any static file server, e.g.:

```bash
python3 -m http.server 4173
```

then visit `http://localhost:4173`.

Hope you enjoy playing the game!
