# Filter bank calculation contract

Project schema 10 enables channel and speaker-object filter banks. The editor UI
is a separate follow-up; the existing EQ dialog remains informational. Versions
5-9 still load with their original gain behavior. Empty banks are unity. Older
Deploy versions reject schema 10 projects.

Each `equalizer` has `filters` and optional `bypassed` (default false). Each filter
has a bank-local unique `id`, `type`, boolean `enabled`, `frequencyHz`, `gainDb`,
and `q`. Supported types: `peq`, `low-shelf`, `high-shelf`, `allpass`, `lowpass`,
and `highpass`. Disabled and bypassed definitions are still validated.

- Frequency: 1 to 100000 Hz; gain: -60 to +60 dB; Q: 0.05 to 100.
- Maximum 64 filters per bank, independently for channel and speaker.
- Low/high-pass filters additionally accept `family` (`butterworth` default,
  or `linkwitz-riley`) and integer `order` (default 2). Butterworth orders 1-8;
  Linkwitz-Riley orders 2, 4, 6, 8. Family/order are rejected on other types.
- Crossover Q is determined by family/order; stored q and gainDb do not affect
  crossovers. gainDb is also unused for all-pass. All-pass is second order.
- Shelves use Q, not a digital shelf-slope parameter.

These are ideal analog frequency responses, evaluated using s = j f/f0 with
exp(+i omega t). They do not assume a hardware sample rate or emulate a particular
DSP device. With A = 10^(gainDb/40), the normalized transfer functions are:

```
PEQ:        (s^2 + A*s/Q + 1) / (s^2 + s/(A*Q) + 1)
All-pass:   (s^2 - s/Q + 1) / (s^2 + s/Q + 1)
Low shelf:  A*(s^2 + sqrt(A)*s/Q + A) / (A*s^2 + sqrt(A)*s/Q + 1)
High shelf: A*(A*s^2 + sqrt(A)*s/Q + 1) / (s^2 + sqrt(A)*s/Q + A)
```

Butterworth uses normalized stable analog sections. Linkwitz-Riley cascades two
Butterworth responses of half the requested order. There is no automatic polarity
inversion of a crossover branch; polarity remains an explicit user control.

Effective drive is system/channel/object level times channel-bank response times
speaker-bank response times polarity and exp(-j*2*pi*f*delay). Package reference
processing remains embedded in the package; these banks are additional processing.
The application sends the speaker bank as `equalizer` and the assigned channel
bank as `channelEqualizer` on processed sources. The latter is a runtime field,
not a new editable speaker setting. Python validates both banks independently.

Pattern maps and microphone sweeps evaluate responses once per source/frequency.
All five Python preparation paths use the same drive evaluator, including exact
coupled excitation weights, ROM drives, and boundary traces. BEAT receives existing
complex inputs, so no engine API or dependency change is required. Filters affect
pressure, current, voltage, and excursion through the solved excitation. There is
no post-hoc SPL correction or clipping/limiting model.

Processed banks participate in the existing renderer and worker solution keys.
Filter edits invalidate solved fields/sweeps; moving observation planes still
reuses the solved boundary. Geometry and staged ROM assets remain reusable.

`tests/filter_response_vectors.json` contains independent pole-product crossover
reference values and analytic PEQ/shelf/all-pass points consumed by Python and
TypeScript. Additional tests cover reciprocal PEQ, endpoint behavior, bypass,
phase-sensitive interference, all preparation paths, persistence, and history.
Run `pytest`, `npm run test:filters`, and `npm run test:pattern` for those checks.
