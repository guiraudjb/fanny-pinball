"""Cotes de référence de la réplique physique (mm), avec leur source.

SOURCE :
  « table »   : js/table.js (cotes du jeu, relevées sur des tables VPX réelles) — via cao/geometrie.json
  « WPC »     : plans cotés de la caisse Williams WPC « standard body », Pinball Makers
                (https://pinballmakers.com/wiki/index.php?title=Files_Section : Wpc-cabinet-2/3, Wpc-backbox-1)
  « MPF »     : Mission Pinball Framework, page « Pop bumpers » (perçages)
  « choix »   : choix de conception de ce projet (pièces imprimées, visserie)
  « PM »      : gabarits de perçage Pinball Makers (Pop-bumper-template.stl, Slingshot-template.stl), mesurés dans FreeCAD
  « HYP »     : hypothèse à CONFIRMER sur la pièce achetée avant de percer (affichée en orange sur les plans)
"""

SOURCES = {
    "table": "js/table.js (cotes du jeu)",
    "WPC": "Plans WPC standard body, Pinball Makers (Wpc-cabinet-2/3, Wpc-backbox-1)",
    "MPF": "Mission Pinball Framework — Pop bumpers",
    "choix": "Choix de conception du projet",
    "PM": "Gabarits de perçage Pinball Makers (STL), mesurés",
    "HYP": "Hypothèse — à confirmer sur la pièce achetée",
}


def c(v, src, note=""):
    return {"v": v, "src": src, "note": note}


# ------------------------------------------------------------------ plateau
PLATEAU = {
    "ep": c(12.0, "choix", "contreplaqué bouleau 12 mm (les mécanismes du commerce visent 12,7 mm = 1/2\")"),
    "pente_deg": c(6.5, "choix", "pente classique des flippers (6 à 7°)"),
    "h_paroi": c(32.0, "choix", "hauteur des parois et guides imprimés au-dessus du plateau (bille 27 mm)"),
    "ep_paroi": c(8.0, "choix", "épaisseur mini d'une paroi imprimée"),
}

# ------------------------------------------------------------------ visserie et fixations
VISSERIE = {
    "insert_m3": c({"trou": 4.0, "prof": 6.0}, "choix", "insert laiton à chaud M3 (Ø ext. 4,6 × 5,7) dans les pièces imprimées"),
    "vis_m3_dessous": c({"trou_plateau": 3.5, "vis": "M3 × 20 tête cylindrique + rondelle", "lamage": None}, "choix",
                        "les pièces imprimées sont tenues PAR DESSOUS : vis M3 à travers le plateau dans un insert"),
    "pas_fixation": c(90.0, "choix", "écart maxi entre deux fixations d'une paroi imprimée"),
    "vis_bois_meca": c("vis à bois 3,5 × 13 tête ronde", "choix", "platines achetées vissées sous le plateau (pénétration ≤ 10 mm)"),
    "passe_fil": c(8.0, "choix", "trou de passage des fils d'un contact posé sur le plateau"),
}

# ------------------------------------------------------------------ mécanismes achetés (perçages du plateau)
MECA = {
    "flipper_bague": c(13.0, "HYP", "bague de flipper (type Bally/Williams 03-7568) : Ø à relever, puis percer avec la platine en gabarit"),
    "flipper_zone": c((180, 110), "HYP", "encombrement de la platine sous le plateau"),
    "bumper_centre": c(17.0, "PM", "gabarit : Ø 16,3 + 2 encoches de clavette à 45° (r 14) ; mèche Forstner 17 mm (MPF), encoches à la lime"),
    "bumper_tiges": c(9.0, "PM", "2 trous des tiges de l'anneau (gabarit : Ø 9)"),
    "bumper_entraxe_tiges": c(35.0, "PM", "entraxe des tiges (gabarit : 35,0)"),
    "bumper_vis": c({"d": 3.0, "pos": [(-25.5, 10.67), (25.5, 10.67), (0.0, 28.67)]}, "PM",
                    "3 avant-trous des vis de la base, (dx ; dy) depuis le centre, dy vers l'arrière du plateau ; empreinte Ø 69"),
    "bumper_zone": c((95, 70), "HYP", "bobine + culasse sous le plateau"),
    "drop_lumiere": c((26.0, 8.0), "HYP", "lumière par cible (cible 24 mm + jeu) ; banque de 5 au pas de 28 mm"),
    "drop_zone": c((170, 75), "HYP", "banque de 5 cibles tombantes sous le plateau"),
    "sling_lumiere": c((25.1, 12.7), "PM", "lumière du bras (gabarit 500-5849 : oblong 25,1 × 12,7, presque perpendiculaire à la face)"),
    "sling_gabarit": c({"poteaux": [(14.0, 14.03), (47.81, 109.14)], "bras": [(19.95, 67.53), (41.64, 54.97)],
                        "passages": [(32.63, 101.93), (40.81, 84.73), (11.44, 51.36), (23.80, 36.86)], "d_passage": 12.7, "d_poteau": 6.1},
                       "PM", "Slingshot-template.stl : poteaux Ø 6,1 aux bouts de la face, 4 passages Ø 12,7 (contacts à lames), repère du gabarit"),
    "sling_zone": c((120, 60), "HYP", "ensemble lance-pierre (type 500-5849) sous le plateau"),
}

# ------------------------------------------------------------------ détection (conçue ici : micro-rupteur KW11 + pièces imprimées)
DETECTION = {
    "kw11": c({"l": 20.0, "h": 10.3, "e": 6.4, "trous": 2.3, "entraxe": 9.5}, "HYP",
              "micro-rupteur KW11-3Z (V-156) : cotes courantes, à vérifier sur le lot acheté"),
    "rollover_lumiere": c((36.0, 4.0), "choix", "lumière du fil de rollover (couloirs T-O-U-R)"),
    "rollover_fil": c(1.5, "choix", "corde à piano Ø 1,5 cintrée en U, saillie 6 mm, soudée au levier du KW11"),
    "shooter_lumiere": c((20.0, 6.0), "choix", "levier du KW11 sous la bille au repos (couloir de lancement)"),
    "cercle_trou": c(40.0, "choix", "trou de la cuvette du Cercle (cuvette imprimée Ø int. 32, profondeur 18)"),
    "evacuation": c((70.0, 40.0), "choix", "trou oblong d'évacuation sous le tablier"),
    "montee_bac": c(31.0, "choix", "trou de montée de la bille du bac vers le couloir de lancement"),
    "lanceur_lumiere": c((30.0, 12.0), "choix", "lumière du doigt de l'autolanceur"),
    "ir_rampe": c("LED IR 940 nm + phototransistor Ø 5 mm", "choix", "barrière infrarouge en travers de la rampe (sortie)"),
    "cible_axe": c(3.0, "choix", "axe acier Ø 3 des faces de cibles fixes (pivot), retour par le levier du KW11"),
}

# ------------------------------------------------------------------ lampes
LAMPES = {
    "insert_jeu": c(8.0, "choix", "Ø insert = 2 × rayon de lampe du jeu + 8 mm ; acrylique coulé collé à fleur"),
    "led": c("WS2812B sur support imprimé sous l'insert", "choix"),
}

# ------------------------------------------------------------------ rampe
RAMPE = {
    "larg_int": c(39.0, "choix", "largeur intérieure = bille 27 + 2 × 6"),
    "ep": c(3.0, "choix", "fond et flancs imprimés (PETG)"),
    "h_flanc": c(25.0, "choix", "hauteur des flancs au-dessus du fond"),
    "z_haut": c(62.0, "choix", "fond de rampe au-dessus du plateau sur l'arrondi (passe au-dessus des parois de 32 mm)"),
    "pente_entree": c(14.0, "choix", "pente de la montée (°)"),
    "pas_supports": c(140.0, "choix", "écart des poteaux de rampe"),
    "troncon_max": c(200.0, "choix", "longueur maxi d'un tronçon imprimé"),
}

# ------------------------------------------------------------------ caisse (WPC standard body)
CAISSE = {
    "ep": c(19.0, "WPC", "contreplaqué 19 mm (3/4\")"),
    "largeur": c(558.8, "WPC", "largeur hors tout de la caisse (22\")"),
    "longueur": c(1308.1, "WPC", "longueur des flancs"),
    "h_avant": c(401.84, "WPC", "hauteur du flanc à l'avant"),
    "h_arriere": c(609.6, "WPC", "hauteur du flanc à l'arrière"),
    "plat_fronton": c(181.0, "WPC", "plat horizontal à l'arrière du flanc, assise du fronton"),
    "flipper_bouton": c({"x_avant": 58.8, "z": 368.3, "d": 28.0, "lamage": None}, "WPC",
                        "trou des boutons de flipper sur les flancs (Ø lu « 23/28 » sur le plan ; bouton d'arcade 28 mm)"),
    "trous_flanc": c([(241.3, 508.0, 13.0), (490.01, 355.6, 10.0), (584.2, 317.87, 10.0)], "WPC",
                     "trous du flanc gauche (x depuis l'arrière, z depuis le bas, Ø) : charnière/fixation du fronton, supports"),
    "encoche_flanc": c({"x_avant": 295.28, "h": 82.55}, "WPC", "encoche verticale en bas du flanc"),
    "facade": c({"l": 558.8, "h": 401.84, "biseau_deg": 79.76}, "WPC", "panneau avant, haut biseauté"),
    "porte": c({"l": 311.23, "h": 256.78, "r": 17.75, "z_bas": 87.38, "x_gauche": 123.8}, "WPC",
               "découpe de la porte de monnayeur (façade)"),
    "start": c({"x": 57.15, "z_haut": 98.84, "d": 25.0, "lamage": 35.5}, "WPC", "bouton start (façade, depuis le bord gauche / le haut)"),
    "arriere": c({"l": 558.8, "h": 609.6}, "WPC", "panneau arrière"),
    "arriere_oblongs": c({"l": 157.0, "h": 52.0, "z": 335.6, "x_gauche": 86.0}, "WPC", "2 oblongs R26 (aération / passage)"),
    "arriere_ventil": c({"d": 86.0, "x": 163.0, "z": 87.0, "vis": 6.0, "entraxe": 80.0}, "WPC", "trou de ventilateur + 4 vis"),
    "fronton": c({"l": 730.25, "h": 723.9, "p_haut": 250.83, "p_bas": 161.93, "l_int": 692.15}, "WPC", "fronton (backbox)"),
    "pieds": c({"l": 813.0, "boulons": "3/8\"-16 × 2-1/2\"", "vérin": "3/8\"-16"}, "HYP", "pieds standard 32\" achetés avec leurs boulons et vérins"),
    "z_plateau_avant": c(330.0, "choix", "hauteur du dessus du plateau à l'avant, au-dessus du bas de caisse"),
    "vitre": c(4.0, "choix", "verre trempé 4 mm dans les rainures des flancs"),
}
