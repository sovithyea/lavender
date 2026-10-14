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

## Tuning

All flight numbers live in `src/shared/config.ts`. The two presets ("Agile" and "Heavy") are placeholder feels for you to tune by hand. They are not real aircraft data.

## Tests

```sh
npm test          # physics + stick mapping
npm run typecheck
```
