# Expected fact counts in one V5 Daily packet, derived from the orb tables in
# apps/calc-stub/src/engine.ts (natal) and apps/calc-stub/src/cycle-policy.ts
# (transit). Uniform-longitude model: an upper/lower bound sanity check, NOT a
# measurement of real charts.

# --- natal aspects: engine.ts ORB_DEFAULTS ---
NATAL_ORBS = {"conjunction": 8, "sextile": 4, "square": 6, "trine": 6, "opposition": 8}
# 13 launch bodies minus ascendant/midheaven = 11 aspectable
ASPECTABLE = 11
pairs = ASPECTABLE * (ASPECTABLE - 1) // 2
# folded separation in [0,180]; conj and opp are one-sided at the ends
arc = (NATAL_ORBS["conjunction"] + NATAL_ORBS["opposition"]
       + 2 * (NATAL_ORBS["sextile"] + NATAL_ORBS["square"] + NATAL_ORBS["trine"]))
p_natal = arc / 180
print(f"natal: {pairs} pairs x {p_natal:.3f} = {pairs * p_natal:.1f} aspects")
print(f"natal positions (exact birth time): 13")

# --- active transit cycles: cycle-policy.ts TRANSIT_ORBS ---
TRANSIT_ORBS = {
    "luminary": {"conjunction": 6, "sextile": 3, "square": 5, "trine": 5, "opposition": 6},
    "personal": {"conjunction": 5, "sextile": 2.5, "square": 4, "trine": 4, "opposition": 5},
    "social":   {"conjunction": 4, "sextile": 2, "square": 3, "trine": 3, "opposition": 4},
    "outer":    {"conjunction": 3, "sextile": 1.5, "square": 2, "trine": 2, "opposition": 3},
    "node":     {"conjunction": 3, "sextile": 1.5, "square": 2, "trine": 2, "opposition": 3},
}
ORB_CLASS = {"moon": "luminary", "sun": "luminary", "mercury": "personal",
             "venus": "personal", "mars": "personal", "jupiter": "social",
             "saturn": "social", "uranus": "outer", "neptune": "outer",
             "pluto": "outer", "true_node": "node"}
NATAL_TARGETS = 13  # all launch bodies incl. angles, exact birth time

total = 0.0
for body, cls in ORB_CLASS.items():
    o = TRANSIT_ORBS[cls]
    # full 360 circle: conj 1 point, opp 1 point, sextile/square/trine 2 points each
    in_orb_deg = 2 * o["conjunction"] + 2 * o["opposition"] + \
                 4 * (o["sextile"] + o["square"] + o["trine"])
    p = in_orb_deg / 360
    total += p * NATAL_TARGETS
    print(f"  {body:<10} {cls:<9} P(in orb of one target)={p:.3f}  x{NATAL_TARGETS} targets = {p*NATAL_TARGETS:.2f}")
print(f"cycles (lane 1): {total:.1f}")

sky = 10 + 1  # 10 anchor_position + 1 lunar_phase, DAILY_SKY_BODIES
houses = 10   # house_placement, one per daily-sky body, exact birth time only
print(f"daily sky (lane 3): {sky} + occasional ingress/collective aspect")
print(f"house placements (lane 2): {houses}")
print()
print(f"TOTAL (exact birth time, uniform model): "
      f"{total:.0f} + {houses} + {sky} + 13 + {pairs*p_natal:.0f} "
      f"= {total + houses + sky + 13 + pairs*p_natal:.0f} facts")
