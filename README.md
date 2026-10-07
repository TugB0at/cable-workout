# Cable Workout Log

A private, single-page web app for training on a REP Arcadia functional trainer (upgraded stacks, Performance and Pro Series attachment packages). Every exercise works both arms or both legs at once.

- **Today**: the exercises planned for this weekday, your last numbers, and how many sets you've done.
- **Exercise library**: 19 cable exercises, each matched to an Arcadia attachment. Each has an animated diagram that shows where to set the pulley (the yellow block on the tower), where you stand, and the path your hands or ankle travel. The detail view adds setup steps, movement steps, cues, common mistakes, and a field for your own machine's pin setting.
- **Demo links**: each exercise links to a YouTube search so you can watch a real person do it.
- **Attachment drawings**: each exercise shows a drawing of the attachment to clip on, and the Exercises tab lists every attachment you own with the exercises that use it.
- **Plan**: an editable weekly plan with sets and rep ranges per exercise.
- **Progress**: workouts per week, a 16-week activity grid, a strength chart per exercise (heaviest set and estimated 1-rep max), and recent history.
- **Progression hints**: once you hit the top of your rep range on every set, the app tells you to add weight.

## Running it

It's one file with no build step. Open `index.html` in a browser. Your data is saved in that browser's local storage. Use **Progress → Export backup** now and then.

When it's published as a claude.ai artifact, the log is saved to your Claude account instead (private to you), so it follows you across devices.
