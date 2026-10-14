# Lavender: RePL practical flight trainer

A local drone sim for practising the CASA RePL multi-rotor VLOS practical test. The sim runs in a browser on your Mac, and your iPhone is the remote control. Nothing runs in the cloud and no accounts are needed.

## Setup

Requires Node 22.18 or newer, which runs TypeScript directly.

```sh
npm install && npm run dev
```

The terminal prints the simulator URL, the phone URL and a QR code.

1. On the Mac, open http://localhost:5173/sim/ (the QR code is shown there too). If the Mac changes network, reload this page for a fresh QR code.
2. On the iPhone, on the same Wi-Fi, scan the QR code to open the controller. If you type the address instead, include `http://`.
3. For full screen, tap Share, then **Add to Home Screen**, and open it from the home-screen icon. Hold the phone in landscape.
4. Set **Settings > Display & Brightness > Auto-Lock** to Never while you practise. Safari can only keep the screen awake over HTTPS, and this runs over plain HTTP on your LAN.

Anyone on your Wi-Fi who opens the link can fly, and every connected phone controls every open sim page.

## Flying (default: Mode 2, stabilised)

- Left stick: up/down = climb/descend, left/right = yaw.
- Right stick: up/down = forward/back, left/right = roll left/right.
- Both sticks spring back to centre. Centred sticks brake to a stop and hold position and altitude.
- The sticks are fixed in place, like a real remote: put your thumb on the centre of each square. Touching off-centre moves the drone straight away.
- If the phone disconnects or stops sending for more than 300 ms, the sticks go neutral, the drone holds position, and the sim shows **CONTROLLER LOST**.

Phone buttons: **Pause**, **Reset**, 🎥 next camera, 🎯 training, ⚙︎ stick mode (1–4) and start orientation. The phone remembers its settings.

Mac keys:

| Key | Does |
|---|---|
| `1`–`5` or `C` | Camera: pilot, chase, top-down, FPV, free orbit (drag to look around) |
| `T` | Training menu |
| `R` | Reset the drone, or restart the exercise |
| `P` / `Space` | Pause (in a replay, `Space` plays and pauses) |
| `Esc` | Quit the exercise, close the replay or close the menu |
| `Enter` | Try again, from the results |

## Lessons

New to the sticks? Start with the **Lessons** at the top of the training menu (`T`, or 🎯 on the phone). Each step tells you what to do and waits until you've done it. A diagram shows which stick to push (amber ring) next to where your sticks are (dot), in Mode 2.

1. **First flight:** climb, let go, yaw, forward and back, sideways, land.
2. **Orientation:** fly with the nose facing you and to the side, when the sticks feel reversed.
3. **Attitude mode:** no GPS hold and a crosswind; feel the drift and learn to catch it.

`N` skips a step, `Esc` quits, and `R` (or the phone's Reset) restarts the lesson. Finished lessons get a tick, saved in that browser.

## Flight path trail

A line follows the drone, bright where it is now and fading where it was, so you can see the shape you flew. It's clearest from the top-down camera (`3`). It clears when you reset or start an exercise, and you can turn it off in Settings.

## Training

Press **T** on the Mac or 🎯 on the phone. There are eight exercises based on the RePL practical, easiest first: take-off and hover, nose-in hover, side-on hovers, box pattern, precision landing, figure eight, orbit, and attitude mode in a gusty crosswind.

- **Guided** mode shows the path, the next three targets, green feedback and live tips ("Move to your left", "Climb", "Yaw right"). **Test** mode shows only the next target and gives no tips, like the real practical.
- Markers: a **ring** to hold in (an arrow shows which way the nose should point), **hoops** to fly through in order, an **H pad** to land on, and orange-and-white **poles** to fly round.
- The card at the bottom shows the step, a hold timer and an "off line" meter. Past the amber mark means you're outside the tolerance. Your phone shows the step and tip too, and buzzes as you complete each step.
- **Score** out of 100: 70% accuracy, 15% speed against a par time and 15% smoothness on the sticks, minus 10 for each time you leave the 60 m flying area or go above 30 m. Accuracy on a leg measures how straight and level you flew it, not just whether you reached the hoop. The weights and limits are in `src/shared/config.ts`.
- **History:** every finished attempt is saved as a file in `data/attempts/`. The menu shows your best score, stars and a bar for each recent attempt per exercise, and marks the next exercise to work on.
- **Replay:** press ▶ Replay on the results or on any recent attempt. The drone flies the attempt again, and every camera works. Below it, a chart shows your error over time: green inside the tolerance, red outside, one shaded band per step. Click the chart or drag the slider to jump to a moment.

### Adding or editing a manoeuvre

The exercises live in `config/maneuvers.json`. It's re-read each time you open the training menu, so you don't need to restart. If something in it is wrong, the menu lists each problem with its exact place, for example `maneuvers[3] ("box").steps[2].gate: expected [x, y, z] numbers`.

Coordinates are metres from where you stand: `[x right, y up, z away from you]`. The drone starts on the pad at `[0, 0, 10]`.

```jsonc
{
  "id": "slalom",                         // unique, used for history files
  "name": "Slalom", "skill": "Coordination", "par": 45,   // par = a good time in seconds
  "brief": "Weave through the three hoops and come back.",
  "start": { "heading": 0 },              // optional: 0 nose away, 90 right, 180 facing you, 270 left
  "flightMode": "attitude",               // optional: force attitude mode
  "wind": { "speed": 3, "from": 90, "gusts": 1 },          // optional: overrides the settings panel
  "tolerance": { "lateral": 1.5, "vertical": 1, "headingDeg": 20 },  // optional defaults for every step
  "poles": [[0, 25]],                     // optional [x, z] markers
  "steps": [
    { "hold": [0, 3, 10], "seconds": 3, "text": "Take off and climb to 3 m" },
    { "gate": [-5, 3, 20], "text": "Left hoop" },                     // fly through; "radius" to resize
    { "hold": [0, 3, 25], "seconds": 5, "yaw": 180, "text": "Face me and hold", "radius": 1, "height": 0.75 },
    { "arc": { "center": [0, 25], "radius": 6, "from": 180, "sweep": 360, "y": 3, "gates": 6 }, "text": "Circle the pole" },
    { "land": [0, 0, 10], "radius": 1, "text": "Land on the pad" }    // landing points have y = 0
  ]
}
```

An `arc` makes a run of hoops round a centre. `from` is where the first one sits, as a bearing from the centre (0 = far side, 90 = your right). `sweep` is how far round to go: positive is clockwise from above, negative anticlockwise. `hold`, `gate` and `land` all take an optional `radius`, and `hold` also takes `height` (the ± height tolerance).

## Settings panel (on the Mac)

- **Preset**: "Agile" or "Heavy". Picking one reloads its numbers from `src/shared/config.ts` and keeps your flight mode.
- **Flight mode**: *Stabilised* brakes and holds position when you let go. *Attitude* only holds height: the sticks tilt the drone, and with the sticks centred it drifts with the wind, like ATTI mode with no GPS.
- **Start orientation**: nose out, in, left, right or random. Changing it resets the drone. You can also set it from the phone.
- **Location**: a farm paddock (fence, hay bales, tree line), a town park (soccer goals, houses) or a beach (sea in front, palms behind). The bales and goals are real sizes, to help you judge distance.
- **5 m distance grid**: off by default because it looks unreal; turn it on to judge distance.
- **Zoom in on distant drone**: in pilot view, narrows the view as the drone flies away so you can still see which way it's facing. Turn it off to practise judging distance as you will on the day.
- **Wind**: speed, the bearing it blows *from* (0° is from beyond the drone toward you, 90° from your right), and gusts that come and go on top.
- **Sound**: rotor buzz that rises with thrust and fades with distance, plus wind or surf. Browsers only play sound after you click the sim page once (a "Click for sound" button shows until you do).
- **Tuning**: every flight number, live. **Export tuning (JSON)** downloads the current numbers, ready to paste into a preset in `src/shared/config.ts`.

Your settings are saved in that browser and survive a reload. The presets are placeholder feels for you to tune by hand. They are not real aircraft data.

## Tests

```sh
npm test            # physics, sticks, maneuvers.json, scoring, and a virtual pilot flying every exercise
npm run typecheck
```
