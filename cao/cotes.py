"""Cotes de référence de la réplique physique (mm), avec leur source.

SOURCE :
  « table »   : js/table.js (cotes du jeu, relevées sur des tables VPX réelles) — via cao/geometrie.json
  « WPC »     : plans cotés de la caisse Williams WPC « standard body », Pinball Makers
                (https://pinballmakers.com/wiki/index.php?title=Files_Section : Wpc-cabinet-2/3, Wpc-backbox-1)
  « MPF »     : Mission Pinball Framework, page « Pop bumpers » (perçages)
  « choix »   : choix de conception de ce projet (pièces imprimées, visserie)
  « PM »      : gabarits de perçage Pinball Makers (Pop-bumper-template.stl, Slingshot-template.stl), mesurés dans FreeCAD
  « DWG »     : plans de perçage DWG Pinball Makers (A-15205, banque de 5, 500-5849…), lus avec LibreDWG 0.14
                (dwg2dxf, relevé assets/brut/analyse_dxf.py ; plans en pouces sauf la banque de 5, en mm)
  « PW »      : PinWiki « Pinball Leg Guide » et relevés publiés sur VPForums / Pinside (pieds, boulons, vérins),
                fiches Marco Specialties (boulons 4322-01125-40, vérins LL2/LL3, platine 01-11400-1)
  « HYP »     : hypothèse à CONFIRMER sur la pièce achetée avant de percer (affichée en orange sur les plans)
"""

SOURCES = {
    "table": "js/table.js (cotes du jeu)",
    "WPC": "Plans WPC standard body, Pinball Makers (Wpc-cabinet-2/3, Wpc-backbox-1)",
    "MPF": "Mission Pinball Framework — Pop bumpers",
    "choix": "Choix de conception du projet",
    "PM": "Gabarits de perçage Pinball Makers (STL), mesurés",
    "DWG": "Plans de perçage Pinball Makers (DWG), relevés",
    "PW": "PinWiki Pinball Leg Guide, VPForums, Pinside, Marco Specialties (pieds)",
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
    "encoche_cables": c((160.0, 40.0), "choix", "encoche au centre du bord arrière du plateau pour les câbles du fronton"),
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
    "flipper_bague": c(12.7, "DWG", "bague de flipper : trou Ø 1/2\" traversant (plan A-15205 ; avant-trou Ø 1/8\" au centre)"),
    "flipper_zone": c({"dims": (128.6, 97.6), "centre": (38.9, 9.9)}, "DWG",
                      "platine A-15205 sous le plateau : 5,06 × 3,84\" ; centre décalé de (38,9 vers la pointe ; 9,9 vers l'avant) depuis l'axe ; "
                      "8 vis (avant-trous Ø 1/16\") percées avec la platine en gabarit ; platine supposée parallèle aux bords du plateau"),
    "bumper_centre": c(17.0, "PM", "gabarit : Ø 16,3 + 2 encoches de clavette à 45° (r 14) ; mèche Forstner 17 mm (MPF), encoches à la lime"),
    "bumper_tiges": c(9.0, "PM", "2 trous des tiges de l'anneau (gabarit : Ø 9)"),
    "bumper_entraxe_tiges": c(35.0, "PM", "entraxe des tiges (gabarit : 35,0)"),
    "bumper_vis": c({"d": 3.0, "pos": [(-25.5, 10.67), (25.5, 10.67), (0.0, 28.67)]}, "PM",
                    "3 avant-trous des vis de la base, (dx ; dy) depuis le centre, dy vers l'arrière du plateau ; empreinte Ø 69"),
    "bumper_zone": c((95, 70), "HYP", "bobine + culasse sous le plateau"),
    "drop_lumiere": c((23.5, 9.0), "DWG", "lumière par cible : cible 22,5 × 8,1 (plan banque de 5, mm) + 0,5 mm de jeu par côté ; pas 31,75 mm"),
    "drop_zone": c((171.5, 89.0), "DWG", "banque de 5 cibles tombantes (plan en mm) : platine 171,5 × 89 sous le plateau"),
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
    "evacuation": c((70.0, 34.0), "choix", "trou oblong d'évacuation devant la lèvre du tablier (sous les pointes des flippers : 34 de profondeur)"),
    "montee_bac": c(31.0, "choix", "trou de montée de la bille du bac vers le couloir de lancement"),
    "lanceur_lumiere": c((30.0, 12.0), "choix", "lumière du doigt de l'autolanceur"),
    "ir_rampe": c("LED IR 940 nm + phototransistor Ø 5 mm", "choix", "barrière infrarouge en travers de la rampe (sortie)"),
    "cible_axe": c(3.0, "choix", "axe acier Ø 3 des faces de cibles fixes (pivot), retour par le levier du KW11"),
}

# ------------------------------------------------------------------ caoutchoucs (achetés) : leur face extérieure = contour de rebond du jeu
CAOUTCHOUCS = {
    "z": c(13.5, "table", "hauteur des anneaux : centre de la bille (rayon 13,5)"),
    "poteau": c({"gorge_d": 5.0, "cord": 2.5}, "HYP",
                "poteaux d'entrée des couloirs (rebond du jeu : rayon 5) : mini-anneau noir 1/8\" ID dans une gorge Ø 5 "
                "du poteau Ø 10 ; il affleure le poteau, sinon le couloir de 34 mm deviendrait trop étroit pour la bille"),
    "sling": c({"gorge_d": 8.0, "cord": 4.0}, "HYP",
               "anneau blanc du lance-pierre tendu autour des 3 poteaux, dans une gorge de 1 mm ; poteaux reculés pour que "
               "la face extérieure du caoutchouc tombe sur la face de rebond du jeu"),
    "palette": c({"cord": 4.0, "largeur": 12.7}, "HYP",
                  "caoutchouc rouge de palette 3\" : bande plate de 1/2\" de large (12,7 mm, Bally/Williams/Stern ; 3/8\" "
                  "chez Gottlieb), anneau de 1-1/2\" ID, épaisseur ≈ 5/32\" (HYP), dans la gorge de la palette"),
    "tailles": c([0.25, 0.3125, 0.375, 0.4375, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0], "PW",
                 "diamètres intérieurs courants des anneaux de flipper (pouces)"),
    "tension": c(0.88, "choix", "un anneau se monte tendu d'environ 12 % : ID ≈ 0,88 × périmètre / π"),
}

# ------------------------------------------------------------------ cibles
CIBLES = {
    "drop": c({"l": 22.5, "e": 8.1, "h_dessus": 33.0, "r_haut": 6.0, "h_dessous": 50.0}, "HYP",
              "lame de cible tombante : section 22,5 × 8,1 (plan DWG de la banque de 5) ; dépasse de 33 mm, coins hauts R 6 "
              "(cotes de hauteur à relever sur la banque achetée)"),
    "banque": c({"h": 95.0, "bobine": (38.0, 60.0), "ep": 2.0}, "HYP",
                "châssis de la banque sous le plateau (platine 171,5 × 89 du plan DWG) ; hauteur et bobine de remise à relever"),
    "fixe": c({"axe_d": 3.0, "jeu": 1.0, "face_ep": 4.0, "paroi": 3.0, "profondeur": 30.0, "recul_axe": 5.0}, "choix",
              "cible fixe imprimée : face pendulaire sur un axe acier Ø 3 en haut, le levier du KW11 la rappelle en avant ; "
              "une bille qui frappe la face la fait basculer et ferme le KW11"),
}

# ------------------------------------------------------------------ lampes
LAMPES = {
    "insert_jeu": c(0.0, "choix", "Ø insert = 2 × rayon de lampe du jeu (standards flipper 16/19/22/25 mm) ; acrylique coulé collé à fleur"),
    "led": c("WS2812B sur support imprimé sous l'insert", "choix"),
}

# ------------------------------------------------------------------ rampe
RAMPE = {
    "larg_int": c(39.0, "choix", "largeur intérieure = bille 27 + 2 × 6"),
    "ep": c(3.0, "choix", "fond et flancs imprimés (PETG)"),
    "h_flanc": c(25.0, "choix", "hauteur des flancs au-dessus du fond"),
    "flanc_haut": c({"s0": 120.0, "s1": 360.0, "raccord": 25.0, "capot": 36.0, "ep_capot": 2.0}, "choix",
                    "dans le S (deux arcs de rayon 70 mm), flancs relevés à 36 mm au-dessus du fond de s0 à s1 et fermés "
                    "par un capot en polycarbonate 2 mm (9 mm au-dessus de la bille) : au sommet de la montée, la bille "
                    "rapide décolle et, dans les virages, grimpe le flanc extérieur ; sans capot elle volait par-dessus "
                    "les flancs de 25 mm, puis, flancs relevés jusqu'à la vitre, la touchait"),
    "z_haut": c(48.0, "choix", "fond de rampe au-dessus du plateau sur l'arrondi (passe au-dessus des parois de 32 mm)"),
    "pente_entree": c(25.0, "choix", "pente de la montée (°) : 36 mm au moins au-dessus du toit du bouchon, que la bille passe dessous"),
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
    "pieds": c({"l": 723.9, "entraxe_trous": 57.15, "trou_bas": 127.0, "d_trou": 10.0}, "PW",
               "pieds WPC 28-1/2\" (Williams 1989-1999) ; 2 trous 3/8\" à 2-1/4\" d'entraxe, le trou du bas à 5\" du haut du pied"),
    "pied_section": c({"aile_haut": 76.0, "aile_bas": 50.0, "ep": 2.7, "droit": 230.0}, "HYP",
                      "cornière d'acier pliée (équerre) : ailes ≈ 3\" en haut, droites sur la zone boulonnée, puis effilées "
                      "vers ≈ 2\" en bas ; tôle ≈ 12 ga. Cotes non publiées : à mesurer sur les pieds achetés"),
    "pied_boulons": c({"filet": "3/8\"-16", "l": 63.5, "tete": 15.9}, "PW",
                      "2 boulons par pied, tête bombée 5/8\", 3/8\"-16 × 2-1/2\", passés EN DIAGONALE dans l'angle de la caisse"),
    "pied_platine": c({"h": 127.0, "ailes": 40.0, "ep": 3.0, "retrait": 40.0}, "HYP",
                      "platine d'angle intérieure Williams 01-11400-1 (écrous PEM) : cotes non publiées ; "
                      "retrait = distance de sa face diagonale à l'arête extérieure de la caisse"),
    "verin": c({"tige": 76.2, "d": 9.5, "patin": 44.5, "h_patin": 10.0, "contre_ecrou": 15.9, "saillie": 25.0}, "PW",
               "vérin 3/8\"-16, tige 3\" (arrière) ou 2\" (avant), patin Ø 1-3/4\", contre-écrou 5/8\" ; "
               "saillie sous le pied : choix (caisse de niveau, la pente est dans la caisse)"),
    "pied_finition": c("acier thermolaqué noir satiné", "choix", "les pieds WPC d'origine étaient chromés ; noir « Pac-Black » sur quelques jeux"),
    "z_plateau_avant": c(330.0, "choix", "hauteur du dessus du plateau à l'avant, au-dessus du bas de caisse"),
    "vitre": c(4.0, "choix", "verre trempé 4 mm dans les rainures des flancs"),
    "charniere": c({"ep": 3.0, "r_pivot": 25.0, "boulon": 12.7, "patte": (100.0, 25.0), "y_patte": 4.0, "vis": 3,
                    "jeu_baguette": 0.5}, "choix",
                   "charnières du fronton (paire G/D) À L'EXTÉRIEUR des flancs : plaque d'acier chromée qui pivote sur le "
                   "boulon de charnière (trou Ø 13 du plan WPC), juste en dehors de l'aile de la baguette ; patte repliée "
                   "vissée sous le débord du fond du fronton (3 boulons, écrous dans le fronton). Sur les WPC elles sont "
                   "dans la caisse, mais avec ce pivot la plaque balaierait le bout de la vitre en rabattant le fronton"),
    "barre": c({"l": 566.7, "p": 70.0, "h": 32.0, "ep": 1.5, "r_av": 13.0, "r_ar": 5.0, "r_bout": 14.0, "jupe_ar": 14.0,
                "debord_av": 10.0, "sous_dessus": 10.0}, "PW",
               "barre de verrouillage WPC standard D-12615 : 22-5/16\", inox brossé ; profil (bombé avant, jupes, bouts "
               "arrondis) relevé sur photos, à mesurer sur la pièce achetée"),
    "baguette": c({"dessus": 25.0, "retour": 20.0, "ep": 1.5, "pointe": 8.0, "effile": (30.0, 110.0), "r_bout": 6.0}, "PW",
                  "baguettes latérales WPC A-12359-3 (47-3/16\", inox) : cornière qui coiffe le dessus du flanc, aile "
                  "extérieure effilée vers l'avant sous la barre ; section relevée sur photos"),
    "lanceur": c({"tige": 9.5, "embout": (14.0, 12.0), "boitier": (19.0, 25.0), "trou": 24.0, "collerette": (30.0, 46.0, 3.0),
                  "nez": (24.0, 6.0), "ressort_ext": (21.0, 1.4, 39.0), "ressort_int": (13.0, 1.0), "pommeau": (32.0, 10.0),
                  "platine": 38.0, "sortie": 62.0}, "PW",
                  "lanceur à ressort Williams B-12445 : tige 3/8\", boîtier chromé, ressorts extérieur et intérieur, "
                  "pommeau champignon noir, embout caoutchouc ; platine de fixation intérieure (Ø en mm, longueurs le long de l'axe)"),
}
