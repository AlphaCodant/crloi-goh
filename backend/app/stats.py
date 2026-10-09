"""Calcul des indicateurs à partir des statuts datés des sites et des BRQ."""
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

STATUTS = {
    "actif": "Actif",
    "tentative_reprise": "Tentative de reprise",
    "recolonise": "Recolonisé",
    "demantele": "Démantelé",
    "tenu": "Tenu (non recolonisé)",
}
STATUTS_ACTIFS = {"actif", "recolonise"}
SAISIES = {
    "motopompes": "Motopompes",
    "tapis": "Tapis de lavage",
    "tuyaux_m": "Tuyaux (m)",
    "motos": "Motos",
    "tricycles": "Tricycles",
    "velos": "Vélos",
    "treuils": "Treuils",
    "detecteurs": "Détecteurs",
    "groupes": "Groupes électrogènes",
    "engins_lourds": "Engins lourds",
    "sacs_minerai": "Sacs de minerai",
}
CIBLES = {"neutralisation": 0.70, "recolonisation_3m": 0.10}


def statut_at(events: list, d: date) -> Optional[str]:
    """events triés par date croissante : statut en vigueur à la date d (None si inconnu)."""
    s = None
    for e in events:
        if e.date <= d:
            s = e.statut
        else:
            break
    return s


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def kpis(sites: list, events_by_site: dict, visites: list, brq_dates: set, cours_eau: list, d: date) -> dict:
    counts = defaultdict(int)
    known = 0
    for s in sites:
        st = statut_at(events_by_site.get(s.id, []), d)
        if st is None:
            continue
        known += 1
        counts[st] += 1
    actifs = sum(counts[k] for k in STATUTS_ACTIFS)
    neutralises = known - actifs

    # Taux de recolonisation à 3 mois : sites démantelés depuis au moins 90 jours,
    # repris (recolonisé ou de nouveau actif) dans les 90 jours suivant le démantèlement.
    eligibles = repris = 0
    for s in sites:
        evs = [e for e in events_by_site.get(s.id, []) if e.date <= d]
        dem = [e for e in evs if e.statut == "demantele" and e.date <= d - timedelta(days=90)]
        if not dem:
            continue
        t0 = dem[-1].date
        eligibles += 1
        if any(e.statut in STATUTS_ACTIFS and t0 < e.date <= t0 + timedelta(days=90) for e in evs):
            repris += 1

    d30 = d - timedelta(days=30)
    tentatives_30j = sum(1 for v in visites if d30 < v.date <= d and v.constat == "tentative_reprise")
    lineaire = sum((c.lineaire_impacte_km or c.longueur_km or 0) for c in cours_eau if c.intensite in ("tres_impacte", "impacte"))
    superficie = sum((s.superficie_ha or 0) for s in sites if statut_at(events_by_site.get(s.id, []), d) is not None)
    return {
        "date": d.isoformat(),
        "sites_recenses": known,
        "par_statut": {k: counts.get(k, 0) for k in STATUTS},
        "sites_actifs": actifs,
        "taux_neutralisation": round(neutralises / known, 3) if known else None,
        "cible_neutralisation": CIBLES["neutralisation"],
        "taux_recolonisation_3m": round(repris / eligibles, 3) if eligibles else None,
        "recolonisation_eligibles": eligibles,
        "cible_recolonisation_3m": CIBLES["recolonisation_3m"],
        "tentatives_reprise_30j": tentatives_30j,
        "superficie_ha": round(superficie, 2),
        "lineaire_impacte_km": round(lineaire, 2),
        "brq_7j": sum(1 for x in brq_dates if d - timedelta(days=7) < x <= d),
    }


def series(sites: list, events_by_site: dict, visites: list, brq_dates: set, start: date, end: date) -> list:
    out = []
    w = monday(start)
    while w <= end:
        we = min(w + timedelta(days=6), end)
        in_week = [v for v in visites if w <= v.date <= we]
        saisies = defaultdict(float)
        for v in in_week:
            for k, n in (v.saisies or {}).items():
                saisies[k] += n or 0
        counts = defaultdict(int)
        for s in sites:
            st = statut_at(events_by_site.get(s.id, []), we)
            if st:
                counts[st] += 1
        out.append({
            "semaine": w.isoformat(),
            "fin": we.isoformat(),
            "visites": len(in_week),
            "sites_visites": len({v.site_id for v in in_week if v.site_id}),
            "tentatives_reprise": sum(1 for v in in_week if v.constat == "tentative_reprise"),
            "interpelles": sum(v.interpelles or 0 for v in in_week),
            "saisies": {k: saisies.get(k, 0) for k in SAISIES},
            "saisies_total": sum(v for k, v in saisies.items() if k != "tuyaux_m"),
            "jours_brq": sum(1 for x in brq_dates if w <= x <= we),
            "jours_semaine": (we - w).days + 1,
            "par_statut": {k: counts.get(k, 0) for k in STATUTS},
        })
        w += timedelta(days=7)
    return out
