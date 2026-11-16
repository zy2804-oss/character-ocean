# Character Ocean

Character Ocean is a browser-based aquarium built for the *Designing for Feeling* module. Watching the fish glide slowly across the screen is meant to feel calm and companionable. A ripple adds a moment of play, and the tank settles again when left alone.

## Open the aquarium

Download or clone this repository and open [`dist/index.html`](dist/index.html) in a browser. Keep all three files in the same directory. The site works offline and needs no installation for this preview.

| File | Role |
| --- | --- |
| [`dist/index.html`](dist/index.html) | Page structure, controls, and the aquarium canvas |
| [`dist/styles.css`](dist/styles.css) | Responsive layout, colors, and embedded fonts |
| [`dist/app.js`](dist/app.js) | JavaScript for the fish simulation, drawing, and controls |

## Interaction

- The aquarium opens in Day mode on your first visit. Choose Day, Night, or Deep Water. Deep Water uses angled light shafts and suspended particles.
- Switch among DOTS, GEO, ASCII, and HANZI. HANZI draws fish with characters from the *Classic of Clarity and Stillness*.
- Select marine life and adjust the swim speed in Ocean Settings.
- Click the water to create a ripple at that point, or choose **Make a ripple** to trigger one near a group of fish. Nearby small fish dart away and larger fish curve around the disturbance. Repeated clicks renew the disturbance. After a quiet interval the fish return to their usual movement.
- Switch between the music player demo and the 25-minute focus timer. The music player demo provides playback controls and a simulated progress bar.

## Development

The editable HTML, CSS, and TypeScript live in [`src/`](src/). The build compiles TypeScript to browser-ready JavaScript in `dist/`. Update the source files and rebuild to regenerate the three preview files.

Requires Node.js 22 or newer.

```sh
npm ci
npm run check
npm run build
npm run dev
```

Open <http://127.0.0.1:4173> for local preview.

## Credits

This project adapts [character-ocean by jiezi1234](https://github.com/jiezi1234/character-ocean), which in turn adapts animation code from [ascii-sharks by stackedlol](https://github.com/stackedlol/ascii-sharks). Codex assisted with implementing and debugging the aquarium changes.

See [LICENSE.md](LICENSE.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the scope of the frontend license, upstream animation attribution, and font notices.
