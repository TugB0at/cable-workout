# Cable Workout Log

A private, single-page web app for training on a REP Arcadia functional trainer (upgraded stacks, Performance and Pro Series attachment packages). Every exercise works both arms or both legs at once.

- **Today**: the exercises planned for this weekday, your last numbers, and how many sets you've done.
- **Exercise library**: 19 cable exercises, each matched to an Arcadia attachment. Each has an animated diagram that shows where to set the pulley (the yellow block on the tower), where you stand, and the path your hands or ankle travel. The detail view adds setup steps, movement steps, cues, common mistakes, and a field for your own machine's pin setting.
- **Demo links**: each exercise links to a YouTube search so you can watch a real person do it.
- **Attachment drawings**: each exercise shows a drawing of the attachment to clip on, and the Exercises tab lists every attachment you own with the exercises that use it.
- **On your phone**: bottom tab bar, full-screen exercise view, a rest timer that buzzes when rest is over, the screen stays on while you train, and a "Next exercise" button to move through the workout.
- **Plan**: an editable weekly plan with sets and rep ranges per exercise.
- **Progress**: workouts per week, a 16-week activity grid, a strength chart per exercise (heaviest set and estimated 1-rep max), and recent history.
- **Progression hints**: once you hit the top of your rep range on every set, the app tells you to add weight.

## Install it on Android

1. Open the app's GitHub Pages address in Chrome on your phone.
2. Tap **Install** when Chrome offers it, or **⋮ → Add to Home screen → Install**.

It opens full screen from its own icon and works offline. Workouts are saved on the phone.
Use **Progress → Export backup** now and then, and before switching phones.

## Running it

It's a static site with no build step: `index.html`, `manifest.webmanifest`, `sw.js` and the icons.
Any static host works. Opening `index.html` straight from disk also works (without offline support).

## Privacy

The repository holds only code. Workout logs never leave the device (or your Claude account,
when used as a claude.ai artifact).
