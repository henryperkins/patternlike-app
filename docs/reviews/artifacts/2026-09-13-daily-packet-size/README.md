# Modelled V5 Daily packet size

Supporting arithmetic for finding **C1** in
[2026-09-13-daily-reading-context-and-quality-exploration.md](../../2026-09-13-daily-reading-context-and-quality-exploration.md).

`packet-size.py` transcribes two constant tables from the repository — `ORB_DEFAULTS`
in `apps/calc-stub/src/engine.ts` and `TRANSIT_ORBS` in `apps/calc-stub/src/cycle-policy.ts` —
and computes how many facts one exact-birth-time packet carries.

```
python3 packet-size.py
```

Output at source revision `00f361e21f5df3d9be4119136c45931559bf643f`:

| Lane | Modelled count |
| --- | --- |
| 1 `cycle_instance` | 20.6 |
| 2 `house_placement` | 10 |
| 3 `anchor_position` + `lunar_phase` | 11 |
| 4 `natal_position` | 13 |
| 4 `natal_aspect` | 14.7 |
| **total** | **~69** |

## What this is not

This is a **uniform-longitude model**, not a measurement. It assumes every body's
ecliptic longitude is independently uniform on [0, 360). Real charts violate that:
Mercury stays within ~28° of the Sun and Venus within ~48°, which raises the
conjunction count above the model. Ingresses, collective exact aspects, and
`transit_natal_contact` facts are episodic and excluded rather than averaged.

The figure is therefore a floor for the exact-birth-time case, and it says nothing
about any real reader's packet. An unknown-birth-time chart is materially smaller:
angles, houses, and time-sensitive Moon facts are suppressed at the source.

Nothing here was derived from production data, and no chart was calculated.
