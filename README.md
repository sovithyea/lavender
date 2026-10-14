# Lavender: RePL practical flight trainer

A local drone sim for practising the CASA RePL multi-rotor VLOS practical test. The sim runs in a browser on your Mac, and your iPhone is the remote control. Nothing runs in the cloud and no accounts are needed.

## Setup

Requires Node 22.18 or newer, which runs TypeScript directly.

```sh
npm install && npm run dev
```

The terminal prints the simulator URL, the phone URL and a QR code.

1. On the Mac, open http://localhost:5173/sim/ (the QR code is shown there too).
2. On the iPhone, on the same Wi-Fi, scan the QR code to open the controller.
3. For full screen, tap Share, then **Add to Home Screen**, and open it from the home-screen icon. Hold the phone in landscape.
4. Set **Settings > Display & Brightness > Auto-Lock** to Never while you practise. Safari can only keep the screen awake over HTTPS, and this runs over plain HTTP on your LAN.

## Flying (default: Mode 2, stabilised)

- Left stick: up/down = climb/descend, left/right = yaw.
- Right stick: up/down = forward/back, left/right = roll left/right.
- Both sticks spring back to centre. Centred sticks brake to a stop and hold position and altitude.
- Each stick's centre is wherever your thumb lands, so touching never makes the drone jump.
- Change the stick mode (1–4) with the ⚙︎ button. The phone remembers it.
- If the phone disconnects or stops sending for more than 300 ms, the sticks go neutral, the drone holds position, and the sim shows **CONTROLLER LOST**.
- Mac keys: `R` resets the drone, `P` or `Space` pauses.

## Training (on the Mac)

Press **T** (or the **Training** button) for eight exercises based on the RePL practical, from easiest to hardest:
take-off and hover, nose-in hover, side-on hovers, box pattern, precision landing, figure eight, orbit, and attitude mode in a crosswind.

- Glowing markers show where to go: a **ring** to hold in (an arrow shows which way the nose should point), **hoops** to fly through, and an **H pad** to land on. The current target is amber, and turns green when you're inside it.
- The card at the bottom gives one tip at a time from where you stand ("Move to your left", "Climb", "Yaw right"), plus a hold timer.
- Your phone buzzes as you complete each step.
- At the end you get a score out of 100 (80% accuracy, 20% speed), up to three stars, a score for each step and advice on your weakest one.
- The menu shows your best score, stars and recent attempts for each exercise, and marks the next one to work on. Scores are saved in that browser.

Keys: **R** restarts the exercise (the phone's Reset button does too), **Esc** quits, **Enter** retries from the results.

## Settings panel (on the Mac)

The **Settings** panel at the top right of the sim:

- **Preset**: "Agile" or "Heavy". Picking one reloads its numbers from `src/shared/config.ts` and keeps your flight mode.
- **Flight mode**: *Stabilised* brakes and holds position when you let go. *Attitude* only holds height: the sticks tilt the drone, and with the sticks centred it drifts with the wind, like ATTI mode with no GPS.
- **Start orientation**: nose out, in, left, right or random. Changing it resets the drone.
- **Location**: a farm paddock (fence, hay bales, tree line), a town park (soccer goals, houses) or a beach (sea in front, palms behind). The bales and goals are real sizes, to help you judge distance.
- **5 m distance grid**: off by default because it looks unreal; turn it on to judge distance.
- **Wind**: speed, and the bearing it blows *from*. 0° is from beyond the drone toward you; 90° is from your right.
- **Sound**: rotor buzz that rises with thrust and fades with distance, plus wind or surf. Browsers only play sound after you click the sim page once (a "Click for sound" button shows until you do).
- **Zoom in on distant drone**: narrows the view as the drone flies away so you can still see which way it's facing. Turn it off to practise judging distance as you would on the day.
- **Tuning**: every flight number, live.

The HUD shows the current mode (STAB/ATTI) and wind. Your settings are saved in that browser and survive a reload.

The presets are placeholder feels for you to tune by hand. They are not real aircraft data. To keep a tuning for good, copy the numbers into `src/shared/config.ts`.

## Tests

```sh
npm test          # physics + stick mapping
npm run typecheck
```
