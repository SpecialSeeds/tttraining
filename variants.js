// Equipment swaps, keyed by the plan exercise id they replace.
//
// The Equipment switch in the app picks which version of each exercise you see:
//   Machines  uses the "machine" swap when one exists, otherwise the plan as written
//   Mixed     the plan as written
//   Free      uses the "free" swap when one exists, otherwise the plan as written
// Exercises with no swap (dead bug, side plank, Russian twists...) show in every mode.
// You can also tap "Swap" on any exercise to change it for just that session.
//
// Each swap inherits every field from the plan exercise and overrides what it lists.
// Give each swap its own id: logs, load suggestions and history are kept per id,
// so a leg press never borrows its numbers from back squat.
//
// This file is public (not encrypted). It holds exercise names only, no logs.
window.VARIANTS = {
  // Monday
  'back-squat': {
    machine: { id: 'leg-press', name: 'Leg press', weight: null, inc: 10, load: 'a weight at RPE 7' },
  },
  'rdl': {
    machine: { id: 'seated-leg-curl', name: 'Seated leg curl', weight: null, inc: 10, rest: 90, load: 'a weight at RPE 7', why: 'Hamstring strength for loading into the forehand' },
  },
  'hip-abduction': {
    free: { id: 'banded-lateral-walk', name: 'Banded lateral walk', perSide: true, weighted: false, weight: null, inc: 0, rest: 60, load: 'a mini band' },
  },
  'standing-calf': {
    free: { id: 'db-calf-raise', name: 'Dumbbell calf raise', weight: null, inc: 5, load: 'dumbbells at RPE 7' },
  },

  // Tuesday
  'single-arm-row': {
    machine: { id: 'seated-cable-row', name: 'Seated cable row', perSide: false, weight: null, inc: 5, load: 'a weight at RPE 7' },
  },
  'lat-pulldown': {
    free: { id: 'pull-up', name: 'Pull up (assisted if needed)', target: 8, weighted: false, weight: null, inc: 0, load: 'bodyweight' },
  },
  'face-pull': {
    free: { id: 'rear-delt-fly', name: 'Bent over rear delt fly', weight: null, inc: 2.5, load: 'light dumbbells' },
  },
  'lateral-raise': {
    machine: { id: 'machine-lateral-raise', name: 'Machine lateral raise', weight: null, inc: 5, load: 'a weight at RPE 7' },
  },
  'band-er': {
    machine: { id: 'cable-er', name: 'Cable external rotation', weighted: true, weight: null, inc: 2.5, load: 'the lightest cable weight' },
  },

  // Wednesday
  'med-ball-throw': {
    machine: { id: 'cable-rotation-fast', name: 'Explosive cable rotation', weight: null, inc: 0, load: 'a light cable weight, move fast' },
  },
  'woodchop': {
    free: { id: 'db-woodchop', name: 'Dumbbell woodchop, high to low', weight: null, inc: 5, load: 'a moderate dumbbell' },
  },
  'pallof-press': {
    free: { id: 'band-pallof-press', name: 'Band Pallof press', weighted: false, weight: null, inc: 0, load: 'a medium band' },
  },

  // Thursday
  'bulgarian-split-squat': {
    machine: { id: 'single-leg-press', name: 'Single leg press', weight: null, inc: 10, load: 'a weight at RPE 7' },
  },
  'lateral-lunge': {
    machine: { id: 'hip-adduction', name: 'Hip adduction', perSide: false, weight: null, inc: 10, load: 'a weight at RPE 7' },
  },
  'single-leg-rdl': {
    machine: { id: 'cable-single-leg-rdl', name: 'Cable single leg RDL', weight: null, inc: 5, load: 'a light cable weight' },
  },
  'seated-calf': {
    free: { id: 'seated-db-calf', name: 'Seated dumbbell calf raise', weight: null, inc: 5, load: 'dumbbells on the knees' },
  },

  // Friday
  'db-bench': {
    machine: { id: 'chest-press-machine', name: 'Chest press machine', weight: null, inc: 10, load: 'a weight at RPE 7' },
  },
  'landmine-press': {
    machine: { id: 'cable-press-kneeling', name: 'Half kneeling cable press', weight: null, inc: 5, load: 'a moderate cable weight' },
  },
  'bicep-curl': {
    machine: { id: 'cable-curl', name: 'Cable curl, 3 s lowering', weight: null, inc: 5, load: 'a weight at RPE 7' },
  },
  'wrist-curl': {
    machine: { id: 'cable-wrist-curl', name: 'Cable wrist curl', weight: null, inc: 2.5, load: 'a light cable weight' },
  },
  'reverse-wrist-curl': {
    machine: { id: 'cable-reverse-wrist-curl', name: 'Cable reverse wrist curl', weight: null, inc: 2.5, load: 'a light cable weight' },
  },

  // Saturday
  'goblet-squat': {
    machine: { id: 'leg-press-light', name: 'Leg press, light', weight: null, inc: 10, load: 'a light weight' },
  },
  'light-row': {
    machine: { id: 'seated-cable-row-light', name: 'Seated cable row, light', perSide: false, weight: null, inc: 0, load: 'a light weight' },
  },
};
