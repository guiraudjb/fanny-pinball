' ---------------------------------------------------------------- règles : ORBITES
'   Lancement : à fond, tour complet de l'orbite (redescend à gauche : DEPART) ; dosé, la bille tombe par l'ouverture du haut dans les bumpers.
'   Tirs majeurs : orbite gauche (monte à gauche, ressort à droite), orbite droite (l'inverse), rampe.
'   Un tir majeur moins de 4 s après le précédent : COMBO (x2 … x5) ; la valeur du tir est multipliée.
'   COMBO x5 : SUPER COMBO (50 000), EXTRA BALL allumée à la rampe.
'   O-R-B-E (cibles debout) : bonus x2 … x5 ; deux fois sur la bille : MULTIBALL (2 billes) allumé à la rampe.
'   Multiball : chaque orbite = JACKPOT (20 000, +5 000). Tourniquet : 100 × niveau (orbites réussies, 5 max).
Const COMBO_MS = 4000, ORBITE_MS = 2500
Dim lettres(3), orbeFaits, mbAllume, combo, dernierTir, niveau, jackpot, tG, tD

Sub R_Partie() : jackpot = 20000 : End Sub

Sub R_Bille()
  Dim i
  For i = 0 To 3 : lettres(i) = False : Next
  orbeFaits = 0 : mbAllume = False : combo = 0 : dernierTir = -10000 : niveau = 1 : tG = -10000 : tD = -10000
End Sub

Sub R_FinMultiball() : Say "FIN DU MULTIBALL", 1500 : End Sub
Function R_Info()
  If maintenant - dernierTir < COMBO_MS And combo > 1 Then R_Info = "COMBO X" & combo Else R_Info = ""
End Function
Function R_Etat() : R_Etat = "combo=" & combo & " niveau=" & niveau & " orbe=" & orbeFaits & " mb=" & mbAllume & " jackpot=" & jackpot & " extra=" & extraLit & " mult=" & mult : End Function
Sub R_Palette(sens) : End Sub

Sub R_Lampes()
  Dim i, enCombo
  enCombo = (maintenant - dernierTir < COMBO_MS)
  For i = 0 To 3 : lampe(LP_co + i) = B2E(lettres(i)) : Next
  For i = 1 To 5
    If enCombo And combo >= i Then lampe(LP_combo1 + i - 1) = 1
  Next
  If enCombo Then lampe(LP_orbg) = 2 : lampe(LP_orbd) = 2 : lampe(LP_rampe) = 2
  If multiball Then lampe(LP_orbg) = 2 : lampe(LP_orbd) = 2
  If mbAllume Or extraLit Then lampe(LP_rampe) = 2
  If multiball Then lampe(LP_mb) = 1 Else lampe(LP_mb) = 2 * B2E(mbAllume)
  lampe(LP_spin) = B2E(niveau > 1)
  lampe(LP_extra) = B2E(extraBalls > 0)
  For i = 2 To 5 : lampe(LP_x2 + i - 2) = B2E(mult >= i) : Next
  If maintenant < ballSaveUntil Then lampe(LP_sauve) = 2
End Sub

Sub Regle(nom)
  Select Case nom
    Case "Bumper1", "Bumper2", "Bumper3" : Ajouter 100, 0 : Son "bumper"
    Case "LanceG", "LanceD" : Ajouter 10, 0 : Son "lance_pierre"
    Case "SortieG", "SortieD" : Ajouter 1000, 1000 : Son "couloir"
    Case "RetourG", "RetourD" : Ajouter 500, 500 : Son "couloir"
    Case "CibleO" : Orbe 0
    Case "CibleR" : Orbe 1
    Case "CibleB" : Orbe 2
    Case "CibleE" : Orbe 3
    Case "Tourniquet" : Ajouter 100 * niveau, 10 : Son "tourniquet"
    Case "OrbiteG"
      If maintenant - tD < ORBITE_MS Then
        tD = -10000 : TirMajeur "ORBITE DROITE"
      ElseIf maintenant - lanceTime < 3000 Then
        Ajouter 2000, 0 : Say "LANCEMENT", 1200       ' lancement à fond : tour complet, la bille redescend à gauche
      Else
        tG = maintenant
      End If
    Case "OrbiteD"
      If maintenant - tG < ORBITE_MS Then tG = -10000 : TirMajeur "ORBITE GAUCHE" Else tD = maintenant
    Case "CapteurRampe" : Son "rampe" : TirMajeur "RAMPE"
  End Select
End Sub

Sub TirMajeur(quoi)
  Dim v
  If maintenant - dernierTir < COMBO_MS Then
    If combo < 5 Then combo = combo + 1
    Son "combo"
  Else
    combo = 1
  End If
  dernierTir = maintenant
  If quoi = "RAMPE" Then
    v = 7500 * combo
    If mbAllume And Not multiball Then mbAllume = False : Say "MULTIBALL", 2500 : LancerMultiball 2 : Ajouter v, 5000 : Exit Sub
    If extraLit Then DonnerExtra
  Else
    If niveau < 5 Then niveau = niveau + 1
    v = 5000 * combo
    If multiball Then
      v = v + jackpot : Say "JACKPOT " & jackpot, 2500 : Son "jackpot" : jackpot = jackpot + 5000
      Ajouter v, 5000 : Exit Sub
    End If
  End If
  Ajouter v, 5000
  If combo >= 5 Then
    combo = 1
    Ajouter 50000, 10000 : Say "SUPER COMBO", 2500 : Son "jackpot"
    AllumerExtra
  ElseIf combo > 1 Then
    Say quoi & " COMBO X" & combo, 1800
  Else
    Say quoi, 1200
  End If
End Sub

Sub Orbe(i)
  Ajouter 1000, 1000 : Son "cible"
  lettres(i) = True
  If lettres(0) And lettres(1) And lettres(2) And lettres(3) Then
    lettres(0) = False : lettres(1) = False : lettres(2) = False : lettres(3) = False
    Son "banque" : MultBonus : orbeFaits = orbeFaits + 1
    If orbeFaits Mod 2 = 0 And Not multiball Then mbAllume = True : Say "MULTIBALL A LA RAMPE", 2500
  End If
End Sub

Dim SCENARIO : SCENARIO = Array("Bumper1", "OrbiteG", "OrbiteD", "CapteurRampe", "OrbiteD", "OrbiteG", "CapteurRampe", _
  "OrbiteG", "OrbiteD", "Tourniquet", "CibleO", "CibleR", "CibleB", "CibleE", "CibleO", "CibleR", "CibleB", "CibleE", _
  "CapteurRampe", "OrbiteG", "OrbiteD", "CapteurRampe", "SortieD")
