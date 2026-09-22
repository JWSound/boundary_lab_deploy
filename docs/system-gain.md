# System gain

The Scene tab contains a shared System gain control (-60 to +60 dB), editable
with the slider or numeric entry. Gain is relative to each package's reference
excitation and is saved in the project. It participates in undo/redo.

New projects use +32 dB system gain. New channels start at -24 dB, and newly
inserted speakers start at 0 dB object level. Channel and object sliders retain
their -24 to +12 dB ranges. Total drive gain is system + channel + object level;
new defaults therefore give +8 dB, or approximately 7.11 V for a 2.83 V reference.
The voltage illustration in the Scene tab assumes a 2.83 V reference and shows
the value before channel/object trims; it is not a package-specific voltage measurement.

System gain scales the actual complex excitation used by pattern, boundary,
and coupled calculations, including planes, microphones, sweeps, and coupled
electrical/excursion responses. Muting, polarity, and delay keep their existing
meaning. Changing gain invalidates solved results and requires a new boundary
or coupled solve; it does not merely shift the displayed SPL. Amplifier clipping,
limiting, and power compression are not modeled.

Project schema 9 stores `system_gain_db`. Versions 5–8 load with 0 dB system
gain and preserve their existing trims. Projects predating channels receive a
0 dB channel. The built-in example retains its original excitation levels.
Older Deploy versions cannot open schema 9 projects.
